# 测试场景手册

最后更新：`2026-04-17`
当前版本：`0.2.7`

## 使用方式

- 先读 [REST API](./rest.md) 和 [WebSocket 事件](./websocket-events.md)
- 本文按主流程组织场景，不重复字段定义
- 每组场景都默认至少准备两个用户：`host` 和 `member`

## 1. 注册并登录

### 前置条件

- 服务端已启动
- 数据库或 fallback auth 可用

### 步骤

1. `POST /v1/auth/register`
2. 记录返回的 `token`
3. `GET /v1/auth/me`
4. `POST /v1/auth/logout`
5. `POST /v1/auth/login`

### 预期接口响应

- 注册返回 `AuthSession`
- `GET /v1/auth/me` 返回与登录态一致的用户信息
- 注销返回 `{ ok: true }`
- 再次登录返回新的 `AuthSession`

### 关键字段断言

- `username` 为小写
- `nickname` 保持原值
- `token` 为非空字符串

### 异常分支

- 重复注册同用户名：`409`
- 密码少于 6 位：`400`
- 连续错误登录触发限流：`429`

## 2. 创建房间并订阅实时通道

### 前置条件

- 已拿到 `host` 的 `x-session-token`

### 步骤

1. `POST /v1/rooms`
2. 保存返回的 `roomId`、`joinCode`
3. 建立 Socket.IO 连接
4. 发送 `room.subscribe`

### 预期接口响应

- 建房返回 `RoomSnapshot`
- `room.subscribe` ack 返回 `ok: true`
- 随后收到 `room.snapshot`

### 预期事件

- 当前连接收到 `room.snapshot`

### 关键字段断言

- `room.hostId === host.userId`
- `room.playback.queueVersion === 1`
- ack 里的 `bootstrap.roomId` 与快照一致

### 异常分支

- `room.subscribe` 缺 `peerId`：WsException
- token 与 `sessionId` 不匹配：WsException

## 3. 第二个成员通过房间码加入

### 前置条件

- `host` 已完成场景 2
- `member` 已登录

### 步骤

1. `member` 调 `POST /v1/rooms/join-by-code`
2. `member` 建立 Socket.IO 连接并发送 `room.subscribe`
3. `host` 和 `member` 都监听房间事件

### 预期接口响应

- `join-by-code` 返回最新 `RoomSnapshot`

### 预期事件

- `host` 侧收到 `room.snapshot`
- `host` 侧收到 `room.presence.patch`
- `member` 侧收到 `room.snapshot`

### 关键字段断言

- `members` 中包含 `host` 和 `member`
- `presenceRevision` 增加
- `member.peerId` 在成功订阅后生效

### 异常分支

- 错误 `joinCode`
- 重名昵称加入同房间

## 4. 上传曲目元数据并同步曲库

### 前置条件

- `host` 已在房间内并已订阅 realtime

### 步骤

1. `POST /v1/rooms/{roomId}/tracks`
2. 观察 `host` 和 `member` 的房间事件

### 预期接口响应

- 返回 `TrackMeta`

### 预期事件

- `room.snapshot`
- `room.library.patch`

### 关键字段断言

- `sourceType === "local_upload"`
- `ownerSessionId === host.userId`
- `fileHash`、`pieceManifest` 被保留

### 异常分支

- 非房间成员上传
- 同一上传者重复上传同一 `fileHash`，应走覆盖而非重复新增

## 5. 加歌、重排、删除队列

### 前置条件

- 房间中至少有 2 首曲目

### 步骤

1. `POST /v1/rooms/{roomId}/queue`
2. 再加第二首歌
3. `PATCH /v1/rooms/{roomId}/queue/reorder`
4. `DELETE /v1/rooms/{roomId}/queue/{queueItemId}`

### 预期接口响应

- 每次成功都返回 `{ queue, playback }`

### 预期事件

- 每次成功都触发：
  - `room.snapshot`
  - `room.queue.patch`

### 关键字段断言

- `queue[*].position` 连续递增
- `requestedById` 对应当前操作人
- 删除当前播放项时，`playback` 应同步变化

### 异常分支

- 非房主重排
- 非房主且非点歌人删除队列项

## 6. 播放、暂停、seek、next、prev

### 前置条件

- 队列至少有 2 项
- 已知最新 `playback.playbackRevision`

### 步骤

1. `PATCH /v1/rooms/{roomId}/playback` `action=play`
2. `PATCH ... action=seek`
3. `PATCH ... action=pause`
4. `PATCH ... action=next`
5. `PATCH ... action=prev`

### 预期接口响应

- 每次成功都返回最新 `PlaybackSnapshot`

### 预期事件

- 每次成功都触发 `room.playback.patch`

### 关键字段断言

- `expectedVersion` 必须等于当前 `playbackRevision`
- 成功后新的 `playbackRevision` 应递增
- `positionMs` 与动作匹配

### 异常分支

- 使用过期 `expectedVersion`：`409`
- 高频 `seek`：`429`
- Redis 不可用：`503`

## 7. 保存歌单并重新导入房间

### 前置条件

- 当前队列非空

### 步骤

1. `POST /v1/playlists/from-room`
2. `GET /v1/playlists`
3. `POST /v1/playlists/{playlistId}/import-to-room`

### 预期接口响应

- 保存返回 `Playlist`
- 列表中能看到新歌单
- 导回房间返回 `{ queue, playback }`

### 预期事件

- 保存歌单后：`room.snapshot`
- 导回队列后：
  - `room.snapshot`
  - `room.queue.patch`

### 关键字段断言

- 新歌单 `trackIds` 顺序等于房间当前队列顺序
- 导回时只导入当前房间曲库中存在的曲目

### 异常分支

- 非 owner 导入歌单
- 歌单中无任何曲目存在于当前房间

## 8. 断线重连、重复会话替换、房间删除

### 前置条件

- 房间内已有至少一个在线成员和已建立的 Socket.IO 连接

### 步骤

1. 人为断开 `member` 的 socket
2. 观察 `host` 侧 presence 变化
3. 在 `25s` 内重新连接并再次 `room.subscribe`
4. 用同一 `sessionId` 再建立第三条连接，但使用不同 `peerId`
5. 最后由房主 `DELETE /v1/rooms/{roomId}`

### 预期接口响应

- 房间删除返回 `{ ok: true }`

### 预期事件

- 断线后先看到 `room.presence.patch`，成员转 `reconnecting`
- 宽限期内恢复后重新变成 `online`
- 会话替换时旧连接收到 `room.session.replaced`
- 删除房间时全员收到：
  - `room.deleted`
  - `room.snapshot.missing`

### 关键字段断言

- `recoveryGeneration` 在重订阅后更新
- `piece.availability.clear` 会在 peer 被清理时出现
- `room.deleted.trackIds` 覆盖房间内全部曲目

### 异常分支

- 超过宽限期不恢复，应转 `offline`
- 非房主删房
- 有曲目上传者离线时删房
