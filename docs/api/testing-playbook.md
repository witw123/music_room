# 测试场景手册

最后更新：`2026-07-23`
当前版本：`0.2.8`

## 使用方式

- 先读 [REST API](./rest.md) 和 [WebSocket 事件](./websocket-events.md)
- 本文按主流程组织场景，不重复字段定义
- 每组房间场景默认至少准备两个用户：`host` 和 `member`
- 音频文件必须由拥有者在自己的浏览器中导入；测试成员不会从房间下载音频资产

## 1. 注册并登录

### 步骤

1. `POST /v1/auth/register`
2. 记录返回的 `token`
3. `GET /v1/auth/me`
4. `POST /v1/auth/logout`
5. `POST /v1/auth/login`

### 断言

- 注册返回 `AuthSession`
- `GET /v1/auth/me` 返回一致的用户信息
- 注销返回 `{ ok: true }`
- `username` 为小写，`nickname` 保持原值，`token` 非空

### 异常

- 重复注册：`409`
- 密码少于 6 位：`400`
- 连续错误登录限流：`429`

## 2. 创建房间并订阅实时通道

1. `POST /v1/rooms`
2. 保存 `roomId`、`joinCode`
3. 建立 Socket.IO 连接
4. 发送 `room.subscribe`

断言：建房返回 `RoomSnapshot`，ack 返回 `ok: true`，随后收到 `room.snapshot`；`room.hostId` 等于房主 ID，`bootstrap.roomId` 与快照一致。

## 3. 第二个成员加入并建立媒体连接

1. `member` 调 `POST /v1/rooms/join-by-code`
2. `member` 建立 Socket.IO 连接并发送 `room.subscribe`
3. 两个客户端监听 `room.snapshot`、`room.presence.patch` 和 `peer.signal`
4. 等待控制连接和媒体连接进入稳定状态

断言：成员列表包含双方，`presenceRevision` 增加，成员 `peerId` 生效；没有音频资产下载事件，媒体连接只由当前曲目拥有者发布。

## 4. 上传曲目并同步曲库

1. 房主在浏览器选择本地音频文件
2. 浏览器生成原始资产和分段 Opus 播放资产并写入 IndexedDB
3. `POST /v1/rooms/{roomId}/tracks` 注册曲目元数据和资产清单
4. 观察 `room.snapshot` 和 `room.library.patch`

断言：

- `sourceType === "local_upload"`
- `ownerSessionId === host.userId`
- `originalAsset` 和 `playbackAsset` 清单存在且校验通过
- Server 和成员只收到元数据/清单，不收到文件本体
- 同一上传者重复上传同一 `fileHash` 时按覆盖规则处理

## 5. 加歌、重排、删除队列

1. `POST /v1/rooms/{roomId}/queue`
2. 再加入第二首歌
3. `PATCH /v1/rooms/{roomId}/queue/reorder`
4. `DELETE /v1/rooms/{roomId}/queue/{queueItemId}`

断言：每次成功返回 `{ queue, playback }`，并触发 `room.snapshot` 与 `room.queue.patch`；`queue[*].position` 连续递增，删除当前播放项时 `playback` 同步变化。

## 6. 播放、暂停、seek、next、prev

1. 使用最新 `playback.playbackRevision` 调 `PATCH /v1/rooms/{roomId}/playback` `action=play`
2. 依次测试 `seek`、`pause`、`next`、`prev`
3. 在成员端观察 `audio.srcObject`、`remoteTrackId` 和 `currentTime`
4. 在房主端观察 `bufferedAheadMs`、`scheduledAheadMs`、limiter peak/RMS 和 underrun

断言：

- 每次成功返回最新 `PlaybackSnapshot` 并广播 `room.playback.patch`
- `expectedVersion` 必须等于当前 `playbackRevision`
- 播放控制不应在同一媒体会话内替换 output/remote Track
- 暂停、短暂缺片和解码等待不调用 `replaceTrack(null)`
- `waiting`/`stalled` 恢复只重试 `audio.play()`，不清空 `srcObject`
- 过期版本：`409`；高频 seek：`429`；Redis 不可用：`503`

## 7. 保存歌单并重新导入房间

1. `POST /v1/playlists/from-room`
2. `GET /v1/playlists`
3. `POST /v1/playlists/{playlistId}/import-to-room`

断言：保存返回 `Playlist`，导回返回 `{ queue, playback }` 并触发 `room.snapshot` / `room.queue.patch`；导回只使用当前房间曲库中存在的曲目。

## 8. 成员变化不应重建媒体会话

1. 在播放中让第三个成员加入/离开
2. 触发 presence 心跳和普通房间快照刷新
3. 改变房主本地音量
4. 观察 `mediaSessionKey`、`outputTrackId`、`remoteTrackId` 和 `audio.srcObject`

断言：这些操作不改变媒体会话和 Track identity，不造成可听中断；广播音量不受监听端本地音量影响。

## 9. 断线重连、媒体恢复和房间删除

1. 断开成员 Socket，观察 `reconnecting`
2. 在 `25s` 内重新连接并发送 `room.subscribe`
3. 断开/恢复媒体连接，观察 ICE restart 或媒体恢复
4. 使用不同 `peerId` 建立重复 session，验证旧连接收到 `room.session.replaced`
5. 最后由房主 `DELETE /v1/rooms/{roomId}`

断言：

- 新订阅返回新的 `recoveryGeneration`
- 旧 generation 的 signal 被丢弃
- 媒体恢复尽量保留当前 output Track；只有 media session 真正变化才替换 Track
- 房间删除广播 `room.deleted` 和 `room.snapshot.missing`
- 曲目拥有者离线时不从其他成员寻找替代音频源

## 10. 长时间双浏览器媒体验收

使用两个 Chromium context 连续播放至少 30 分钟，并穿插成员变化、暂停/恢复、切歌、seek、快速音量变化和模拟 RTP 丢包。

必须验证：

- `currentTime` 持续推进
- `remoteTrackId` 在非重连期间不变化
- `audio.srcObject` 不被反复清空
- `bufferedAheadMs` / `scheduledAheadMs` 不持续降到零
- limiter 后 peak 不超过 0dBFS
- 没有持续高频噪声、突发尖峰、click/pop 或持续增长的 underrun
