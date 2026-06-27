# REST API

最后更新：`2026-04-17`
当前版本：`0.2.7`

## 使用约定

- Base URL：`http://localhost:3001`
- 认证头：`x-session-token: <token>`
- 除 `GET /health` 和 `GET /health/readiness` 外，当前 REST 接口都要求已登录
- 文档中的对象结构以 [shared-models.md](./shared-models.md) 为准
- REST 错误响应统一为 `{ "code": string, "message": string, "details"?: unknown }`

## 现状说明

- 注册曲目只上传元数据，不上传音频文件本体
- 房间、队列、曲库、歌单接口除了返回 REST 响应外，通常还会触发 Socket.IO 快照或 patch 广播
- 播放控制依赖 Redis 可用；当 Realtime 不可用时，`PATCH /v1/rooms/{roomId}/playback` 会直接失败

## 标准错误码

当前前后端共享错误码定义在 `packages/shared/src/contracts/errors.ts`。稳定上线阶段优先保证这些 code 可被前端识别：

- `REALTIME_UNAVAILABLE`
- `PLAYBACK_VERSION_CONFLICT`
- `ROOM_NOT_FOUND`
- `TRACK_OWNER_OFFLINE`
- `UNAUTHORIZED_ROOM_ACTION`
- `UNAUTHORIZED`
- `RATE_LIMITED`
- `INTERNAL_ERROR`

## 认证

### `POST /v1/auth/register`

- 用途：注册账号并立即返回登录态
- 认证：否
- 限流：
  - 每 IP 每分钟最多 `8` 次
  - 每用户名每分钟最多 `4` 次
- 请求体：

```json
{
  "username": "tester",
  "password": "secret123",
  "nickname": "Tester"
}
```

- 成功响应：`200`

```json
{
  "id": "user_xxx",
  "userId": "user_xxx",
  "username": "tester",
  "nickname": "Tester",
  "token": "session_token",
  "createdAt": "2026-04-17T10:00:00.000Z"
}
```

- 常见失败：
  - `400`：缺少用户名、昵称，或密码长度少于 6
  - `409`：用户名已存在
  - `429`：触发注册限流
  - `503`：账号存储暂时不可用
- 副作用：创建用户并创建会话；非生产环境且数据库不可用时，可能落到 `.tmp/auth-fallback-store.json`
- 测试要点：校验 `username` 被标准化为小写；重复用户名走 `409`；第 5 次同用户名失败请求后继续请求应命中 `429`

### `POST /v1/auth/login`

- 用途：登录并返回登录态
- 认证：否
- 限流：
  - 每 IP 每分钟最多 `12` 次
  - 每用户名每分钟最多 `6` 次
- 请求体：

```json
{
  "username": "tester",
  "password": "secret123"
}
```

- 成功响应：`200`

```json
{
  "id": "user_xxx",
  "userId": "user_xxx",
  "username": "tester",
  "nickname": "Tester",
  "token": "session_token",
  "createdAt": "2026-04-17T10:05:00.000Z"
}
```

- 常见失败：
  - `401`：用户名或密码错误、会话非法
  - `429`：触发登录限流
  - `503`：账号存储暂时不可用
- 副作用：创建新会话；旧会话不会因登录自动失效
- 测试要点：错误密码第 7 次同用户名请求应命中 `429`

### `POST /v1/auth/logout`

- 用途：注销当前会话
- 认证：是
- 请求头：`x-session-token`
- 请求体：无
- 成功响应：`200`

```json
{
  "ok": true
}
```

- 常见失败：
  - 当前实现未把缺失 token 视为错误，缺 token 也会返回 `200`
- 副作用：如果 token 存在且有效，则删除会话
- 测试要点：重复注销同一 token 仍返回 `ok: true`

### `GET /v1/auth/me`

- 用途：读取当前登录态
- 认证：是
- 请求头：`x-session-token`
- 成功响应：`200`

```json
{
  "id": "user_xxx",
  "userId": "user_xxx",
  "username": "tester",
  "nickname": "Tester",
  "token": "session_token",
  "createdAt": "2026-04-17T10:05:00.000Z"
}
```

- 常见失败：
  - `401`：缺失 token、token 无效、会话已过期
- 副作用：无
- 测试要点：会话过期和伪造 token 都应返回 `401`

## 健康检查

### `GET /health`

- 用途：存活检查
- 认证：否
- 成功响应：`200`

```json
{
  "status": "ok",
  "service": "music-room-server"
}
```

- 常见失败：无业务失败分支
- 副作用：无
- 测试要点：服务起来后应稳定返回 `ok`

### `GET /health/readiness`

- 用途：检查 Prisma 和 Redis 就绪状态
- 认证：否
- 成功响应：`200`

```json
{
  "status": "ready",
  "service": "music-room-server",
  "checks": {
    "prisma": "up",
    "redis": "up"
  },
  "metadata": {
    "redisMode": "redis"
  }
}
```

- 常见失败：无业务失败分支；依赖故障时仍返回 `200`，但 `status` 变为 `degraded`
- 副作用：无
- 测试要点：Redis 或 Prisma 不可用时，断言 `checks` 和 `metadata.redisMode`

## 房间

### `POST /v1/rooms`

- 用途：创建房间
- 认证：是
- 请求体：

```json
{
  "visibility": "public"
}
```

- 成功响应：`200`，返回 `RoomSnapshot`
- 常见失败：
  - `401`：登录态无效
- 副作用：
  - 创建房间记录
  - 触发 `room.snapshot`
- 测试要点：校验 `room.hostId`、`joinCode`、初始 `playback.queueVersion = 1`

### `GET /v1/rooms`

- 用途：列出当前用户可访问房间，加上有在线成员的公开房间
- 认证：是
- 成功响应：`200`，返回 `RoomSnapshot[]`
- 常见失败：
  - `401`：登录态无效
- 副作用：无
- 测试要点：列表会对“我可恢复的房间”和“公开房间”去重

### `GET /v1/rooms/recent/active`

- 用途：读取当前用户最近活动房间
- 认证：是
- 成功响应：`200`

```json
null
```

或返回 `RoomSnapshot`

- 常见失败：
  - `401`：登录态无效
- 副作用：无
- 测试要点：无最近房间时返回 `null`，不是 `404`

### `GET /v1/rooms/{roomId}/recover`

- 用途：恢复指定房间
- 认证：是
- 路径参数：`roomId`
- 成功响应：`200`，返回 `RoomSnapshot | null`
- 常见失败：
  - `401`：登录态无效
- 副作用：若可恢复，会刷新最近房间索引
- 测试要点：非房间成员当前返回 `null`，不是 `403/404`

### `GET /v1/rooms/{roomId}`

- 用途：读取房间完整快照
- 认证：是
- 路径参数：`roomId`
- 成功响应：`200`，返回 `RoomSnapshot`
- 常见失败：
  - `401`：登录态无效
  - 其他未包装业务错误：私有房间且非成员时当前实现可能表现为服务端异常
- 副作用：若当前用户是成员，会刷新最近房间索引
- 测试要点：公开房间允许已登录但未加入的用户读取；私有房间按当前实现验证实际返回

### `POST /v1/rooms/join-by-code`

- 用途：按房间码加入房间
- 认证：是
- 请求体：

```json
{
  "joinCode": "ABC123"
}
```

- 成功响应：`200`，返回最新 `RoomSnapshot`
- 常见失败：
  - `401`：登录态无效
  - 其他未包装业务错误：房间码不存在、昵称冲突等
- 副作用：
  - 变更房间成员
  - 触发 `room.snapshot`
  - 触发 `room.presence.patch`
- 测试要点：重复加入不会重复生成成员；昵称冲突应按当前实现报错

### `POST /v1/rooms/{roomId}/join`

- 用途：按房间 ID 加入房间
- 认证：是
- 路径参数：`roomId`
- 请求体：无
- 成功响应：`200`，返回最新 `RoomSnapshot`
- 常见失败：
  - `401`：登录态无效
  - 其他未包装业务错误：房间不存在、昵称冲突
- 副作用：
  - 触发 `room.snapshot`
  - 触发 `room.presence.patch`
- 测试要点：同一用户重复加入应保持幂等

### `POST /v1/rooms/{roomId}/leave`

- 用途：离开房间
- 认证：是
- 路径参数：`roomId`
- 请求体：无
- 成功响应：`200`，返回 `Room`
- 常见失败：
  - `401`：登录态无效
  - 其他未包装业务错误：非成员离房
- 副作用：
  - 清理该用户 realtime presence
  - 普通成员会从列表移除；房主会保留但变为离线
  - 触发 `room.snapshot`
  - 触发 `room.presence.patch`
- 测试要点：房间不会因最后一个成员离线自动销毁；房主离房后仍保留 host 身份

### `DELETE /v1/rooms/{roomId}`

- 用途：删除房间
- 认证：是
- 路径参数：`roomId`
- 成功响应：`200`

```json
{
  "ok": true
}
```

- 常见失败：
  - `401`：登录态无效
  - 其他未包装业务错误：
    - 非房主删除
    - 有曲目上传者离线时删除
- 副作用：
  - 删除房间关联歌单
  - 触发 `room.deleted`
  - 触发 `room.snapshot.missing`
- 测试要点：校验 `room.deleted.trackIds` 包含删除房间内所有曲目 ID

### `POST /v1/rooms/{roomId}/tracks`

- 用途：注册本地曲目元数据
- 认证：是
- 路径参数：`roomId`
- 请求体示例：

```json
{
  "title": "Song A",
  "artist": "Artist",
  "album": "Album",
  "durationMs": 180000,
  "bitrate": 320000,
  "sizeBytes": 7340032,
  "codec": "mp3",
  "mimeType": "audio/mpeg",
  "fileHash": "sha256:xxxx",
  "artworkUrl": null,
  "sourceType": "local_upload",
  "pieceManifest": {
    "totalChunks": 32,
    "chunkSize": 262144,
    "pieceMimeType": "audio/mpeg"
  },
  "relayManifest": null
}
```

- 成功响应：`200`，返回 `TrackMeta`
- 常见失败：
  - `401`：登录态无效
  - 其他未包装业务错误：非房间成员
- 副作用：
  - 只保存元数据，不上传音频本体
  - 相同 `fileHash + ownerSessionId` 会覆盖旧条目而不是新增重复曲目
  - 触发 `room.snapshot`
  - 触发 `room.library.patch`
- 测试要点：重复上传同文件应复用原条目 ID；`ownerNickname` 默认取当前用户昵称

### `DELETE /v1/rooms/{roomId}/tracks/{trackId}`

- 用途：删除曲库曲目
- 认证：是
- 路径参数：`roomId`、`trackId`
- 成功响应：`200`

```json
{
  "ok": true
}
```

- 常见失败：
  - `401`：登录态无效
  - 其他未包装业务错误：
    - 曲目不存在
    - 非原始上传者删除
- 副作用：
  - 从房间曲库删除曲目
  - 清理队列中的对应条目
  - 删除所有歌单中的对应 `trackId`
  - 若当前正在播放该曲目，会清空播放状态并递增 `playbackRevision`；若只影响队列则递增 `queueVersion`
  - 触发 `room.snapshot`
  - 触发 `room.library.patch`
- 测试要点：删除正在播放曲目后，`currentTrackId` 和 `currentQueueItemId` 应清空

## 队列

### `GET /v1/rooms/{roomId}/queue`

- 用途：读取当前房间队列
- 认证：是
- 路径参数：`roomId`
- 成功响应：`200`，返回 `QueueItem[]`
- 常见失败：
  - `401`：登录态无效
- 副作用：无
- 测试要点：当前控制器只校验登录态，不额外校验成员身份

### `POST /v1/rooms/{roomId}/queue`

- 用途：把曲目加入队列
- 认证：是
- 路径参数：`roomId`
- 请求体：

```json
{
  "trackId": "track_xxx"
}
```

- 成功响应：`200`

```json
{
  "queue": [
    {
      "id": "queue_1",
      "trackId": "track_xxx",
      "requestedBy": "Tester",
      "requestedById": "user_xxx",
      "position": 0,
      "createdAt": "2026-04-17T10:12:00.000Z"
    }
  ],
  "playback": {
    "status": "paused",
    "currentTrackId": null,
    "currentQueueItemId": null,
    "sourceSessionId": "user_host",
    "sourcePeerId": "peer_host",
    "sourceTrackId": null,
    "positionMs": 0,
    "startedAt": null,
    "queueVersion": 2,
    "playbackRevision": 2,
    "mediaEpoch": 0
  }
}
```

- 常见失败：
  - `401`：登录态无效
  - 其他未包装业务错误：非成员、曲目不存在
- 副作用：
  - 不自动开始播放
  - 触发 `room.snapshot`
  - 触发 `room.queue.patch`
- 测试要点：新增队列项的 `requestedBy` 和 `requestedById` 来自当前用户

### `DELETE /v1/rooms/{roomId}/queue/{queueItemId}`

- 用途：删除队列项
- 认证：是
- 路径参数：`roomId`、`queueItemId`
- 成功响应：`200`

```json
{
  "queue": [
    {
      "id": "queue_2",
      "trackId": "track_2",
      "requestedBy": "Tester",
      "requestedById": "user_xxx",
      "position": 0,
      "createdAt": "2026-04-17T10:13:00.000Z"
    }
  ],
  "playback": {
    "status": "playing",
    "currentTrackId": "track_1",
    "currentQueueItemId": "queue_1",
    "sourceSessionId": "user_host",
    "sourcePeerId": "peer_host",
    "sourceTrackId": "track_1",
    "positionMs": 24000,
    "startedAt": "2026-04-17T10:12:30.000Z",
    "queueVersion": 4,
    "playbackRevision": 4,
    "mediaEpoch": 1
  }
}
```

- 常见失败：
  - `401`：登录态无效
  - 其他未包装业务错误：非成员、非房主且非点歌人删除
- 副作用：
  - 触发 `room.snapshot`
  - 触发 `room.queue.patch`
  - 若删除的是当前播放队列项，服务端会尝试切到下一首/上一首，或直接清空播放
- 测试要点：验证房主和点歌人都能删；删除当前播放项时检查 `playback` 变化

### `PATCH /v1/rooms/{roomId}/queue/reorder`

- 用途：重排队列
- 认证：是
- 路径参数：`roomId`
- 请求体：

```json
{
  "queueItemIds": ["queue_2", "queue_1", "queue_3"]
}
```

- 成功响应：`200`

```json
{
  "queue": [
    {
      "id": "queue_2",
      "trackId": "track_2",
      "requestedBy": "Tester",
      "requestedById": "user_xxx",
      "position": 0,
      "createdAt": "2026-04-17T10:13:00.000Z"
    },
    {
      "id": "queue_1",
      "trackId": "track_1",
      "requestedBy": "Host",
      "requestedById": "user_host",
      "position": 1,
      "createdAt": "2026-04-17T10:12:00.000Z"
    }
  ],
  "playback": {
    "status": "paused",
    "currentTrackId": null,
    "currentQueueItemId": null,
    "sourceSessionId": "user_host",
    "sourcePeerId": "peer_host",
    "sourceTrackId": null,
    "positionMs": 0,
    "startedAt": null,
    "queueVersion": 5,
    "playbackRevision": 5,
    "mediaEpoch": 1
  }
}
```

- 常见失败：
  - `401`：登录态无效
  - 其他未包装业务错误：
    - 非成员
    - 非房主
    - `queueItemIds` 与当前队列不一致
- 副作用：
  - 触发 `room.snapshot`
  - 触发 `room.queue.patch`
- 测试要点：重排后每项 `position` 应连续重算

## 播放控制

### `PATCH /v1/rooms/{roomId}/playback`

- 用途：修改房间权威播放状态
- 认证：是
- 路径参数：`roomId`
- 支持动作：`play`、`pause`、`seek`、`next`、`prev`
- 请求体：

```json
{
  "action": "play",
  "queueItemId": "queue_1",
  "expectedVersion": 3
}
```

或：

```json
{
  "action": "seek",
  "positionMs": 90000,
  "expectedVersion": 4
}
```

- 成功响应：`200`，返回 `PlaybackSnapshot`
- 常见失败：
  - `401`：登录态无效
  - `403`：非房间成员
  - `404`：`queueItemId` 或 `trackId` 不存在
  - `409`：
    - 缺失 `expectedVersion`
    - `expectedVersion` 与当前 `playbackRevision` 不一致
    - 播放曲目上传者离线
  - `429`：播放控制限流
  - `503`：Realtime sync unavailable
- 限流：
  - `seek`：每用户每秒 `8` 次；每房间每秒 `24` 次
  - `play/pause/next/prev`：每用户每秒 `4` 次；每房间每秒 `12` 次
- 冲突语义：
  - `expectedVersion` 必填
  - 服务端把它与当前 `playback.playbackRevision` 比较
  - 不一致即拒绝本次控制，客户端应先用最新 `room.snapshot` 或 patch 重放 UI 状态
- Realtime 失败语义：
  - 当前由 `roomService.isRealtimeAvailable()` 判断 Redis 是否可用
  - 不可用时，播放控制直接失败，不做降级写入
- 副作用：
  - 成功后只广播 `room.playback.patch`
  - 不额外触发 `room.snapshot`
- 测试要点：先取最新 `playbackRevision` 再发控制；验证冲突和限流分支

## Realtime / ICE

### `GET /v1/realtime/ice-config`

- 用途：获取当前用户的 ICE 配置
- 认证：是
- 请求头：
  - `x-session-token`
  - `host` 或 `x-forwarded-host`
- 成功响应：`200`

```json
{
  "iceServers": [
    {
      "urls": "stun:stun.l.google.com:19302"
    },
    {
      "urls": [
        "turn:turn.example.com:3478?transport=udp",
        "turn:turn.example.com:3478?transport=tcp",
        "turns:turn.example.com:5349?transport=tcp"
      ],
      "username": "1713350400:user_xxx",
      "credential": "base64-hmac"
    }
  ],
  "ttlSeconds": 3600,
  "source": "ephemeral"
}
```

- 常见失败：
  - `401`：登录态无效
  - 当前生产环境下若 TURN 必需但无法生成，可能表现为服务端异常
- `source` 语义：
  - `ephemeral`：服务端基于共享密钥动态下发 TURN
  - `static`：回退到静态环境变量
  - `stun-only`：开发环境下无 TURN 可用时只给 STUN
- 副作用：无
- 测试要点：校验 `source` 与当前部署配置一致

## 歌单

### `GET /v1/playlists`

- 用途：列出当前用户歌单
- 认证：是
- 成功响应：`200`，返回 `Playlist[]`
- 常见失败：
  - `401`：登录态无效
- 副作用：无
- 测试要点：只返回当前用户自己的歌单

### `POST /v1/playlists`

- 用途：创建歌单
- 认证：是
- 请求体：

```json
{
  "title": "Tonight",
  "description": "Late night",
  "trackIds": ["track_1"],
  "tags": ["live"],
  "coverUrl": null,
  "isCollaborative": false
}
```

- 成功响应：`200`，返回 `Playlist`
- 常见失败：
  - `401`：登录态无效
- 副作用：创建歌单；不广播房间事件
- 测试要点：`ownerId` 应固定为当前用户

### `PATCH /v1/playlists/{playlistId}`

- 用途：更新歌单
- 认证：是
- 路径参数：`playlistId`
- 请求体：

```json
{
  "title": "Tonight Updated",
  "description": null,
  "tags": ["focus"],
  "coverUrl": null,
  "trackIds": ["track_1", "track_2"]
}
```

- 成功响应：`200`，返回更新后的 `Playlist`
- 常见失败：
  - `401`：登录态无效
  - 其他未包装业务错误：歌单不存在、非 owner 更新
- 副作用：更新歌单；不广播房间事件
- 测试要点：`updatedAt` 应变化

### `DELETE /v1/playlists/{playlistId}`

- 用途：删除歌单
- 认证：是
- 路径参数：`playlistId`
- 成功响应：`200`

```json
{
  "ok": true
}
```

- 常见失败：
  - `401`：登录态无效
  - 其他未包装业务错误：歌单不存在、非 owner 删除
- 副作用：删除歌单；不广播房间事件
- 测试要点：重复删除按当前实现验证实际错误

### `POST /v1/playlists/{playlistId}/import-to-room`

- 用途：把歌单中的可用曲目导回房间队列
- 认证：是
- 路径参数：`playlistId`
- 请求体：

```json
{
  "roomId": "room_xxx"
}
```

- 成功响应：`200`

```json
{
  "queue": [
    {
      "id": "queue_4",
      "trackId": "track_1",
      "requestedBy": "Tester",
      "requestedById": "user_xxx",
      "position": 0,
      "createdAt": "2026-04-17T10:20:00.000Z"
    },
    {
      "id": "queue_5",
      "trackId": "track_2",
      "requestedBy": "Tester",
      "requestedById": "user_xxx",
      "position": 1,
      "createdAt": "2026-04-17T10:20:01.000Z"
    }
  ],
  "playback": {
    "status": "paused",
    "currentTrackId": null,
    "currentQueueItemId": null,
    "sourceSessionId": "user_host",
    "sourcePeerId": "peer_host",
    "sourceTrackId": null,
    "positionMs": 0,
    "startedAt": null,
    "queueVersion": 8,
    "playbackRevision": 8,
    "mediaEpoch": 1
  }
}
```

- 常见失败：
  - `401`：登录态无效
  - 其他未包装业务错误：
    - 非歌单 owner
    - 房间中没有任何可导入曲目
    - 非房间成员
- 副作用：
  - 向队列追加可用曲目
  - 触发 `room.snapshot`
  - 触发 `room.queue.patch`
- 测试要点：只会导入当前房间曲库中存在的 `trackId`

### `POST /v1/playlists/from-room`

- 用途：把当前房间队列保存成歌单
- 认证：是
- 请求体：

```json
{
  "roomId": "room_xxx",
  "title": "Queue Backup",
  "description": "Saved from room"
}
```

- 成功响应：`200`，返回 `Playlist`
- 常见失败：
  - `401`：登录态无效
  - 其他未包装业务错误：房间不存在
- 副作用：
  - 创建新歌单
  - 触发 `room.snapshot`
- 测试要点：歌单 `trackIds` 顺序应与当前房间队列一致
