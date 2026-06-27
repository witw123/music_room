# WebSocket 事件

最后更新：`2026-04-17`
当前版本：`0.2.7`

## 连接规范

- 协议：Socket.IO
- 服务端基址：`http://localhost:3001`
- path：`/ws/socket.io`
- 推荐客户端配置：

```ts
io("http://localhost:3001", {
  path: "/ws/socket.io",
  auth: {
    sessionToken: "<x-session-token>"
  }
});
```

- 鉴权来源：
  - 优先 `handshake.auth.sessionToken`
  - 回退 `x-session-token` header
- 订阅前置：
  - 必须先通过 REST 登录，拿到 `AuthSession.token`
  - `room.subscribe` 必须携带合法 `sessionId`
  - `peerId` 由客户端本地生成并保持稳定

## 当前契约原则

- `room.snapshot` 是房间状态的权威基线
- `room.playback.patch`、`room.queue.patch`、`room.presence.patch`、`room.library.patch` 只做增量优化
- 客户端在 patch 与本地状态冲突时，应以更高版本的完整快照为准
- `room.subscribe` 的 ack 只提供 bootstrap 信息，不替代随后的 `room.snapshot`
- WsException 错误优先返回 `{ "code": string, "message": string, "details"?: unknown }`，错误码与 REST 共享

## 连接与恢复语义

- duplicate session replacement：
  - 同一 `roomId + sessionId` 被另一个 socket 订阅时，旧连接会被替换
  - 如果 `peerId` 不同，旧连接会收到 `room.session.replaced`
  - 如果 `peerId` 相同，视为无缝重连，旧连接不会保留房间态
- reconnect grace period：
  - 断线后先进入 `reconnecting`
  - 宽限期当前为 `25s`
  - 超时仍未恢复则转 `offline`
- `peer.signal` 缓存：
  - 目标 peer 不在线时，信令会按 `roomId + peerId` 暂存
  - 当前 TTL 为 `10s`
  - peer 重新订阅后会自动回放未过期信令

## Client -> Server

### `room.subscribe`

- 方向：Client -> Server
- ack：有
- payload：

```json
{
  "roomId": "room_xxx",
  "sessionId": "user_xxx",
  "peerId": "peer_member_1"
}
```

- 触发时机：进入房间后建立 realtime 绑定
- 成功 ack：

```json
{
  "ok": true,
  "serverNow": "2026-04-17T10:10:00.000Z",
  "recoveryGeneration": 3,
  "bootstrap": {
    "roomId": "room_xxx",
    "roomRevision": 8,
    "presenceRevision": 5,
    "playback": {
      "status": "paused",
      "currentTrackId": null,
      "currentQueueItemId": null,
      "sourceSessionId": "user_host",
      "sourcePeerId": "peer_host",
      "sourceTrackId": null,
      "positionMs": 0,
      "startedAt": null,
      "queueVersion": 3,
      "playbackRevision": 3,
      "mediaEpoch": 1
    },
    "members": [
      {
        "id": "user_xxx",
        "peerId": "peer_member_1",
        "presenceState": "online",
        "role": "member"
      }
    ]
  }
}
```

- 失败路径：
  - 缺少 `sessionId` 或 `peerId`：WsException
  - token 与 `sessionId` 不匹配：`UNAUTHORIZED`
  - Redis / Realtime 不可用：`REALTIME_UNAVAILABLE`
  - 房间不存在：服务端会先 emit `room.snapshot.missing`，ack 返回 `{ "ok": false }`
- 广播语义：
  - 订阅成功后服务端会异步向当前客户端 emit `room.snapshot`
  - 若有缓存的 `piece.availability` 和待回放 `peer.signal`，也会补发
- 测试断言：
  - ack 中 `bootstrap.playback` 与随后 `room.snapshot.room.playback` 一致
  - 收到的 `recoveryGeneration` 应参与后续 media/data 恢复链路

### `room.presence`

- 方向：Client -> Server
- ack：返回 `{ ok: true }`
- payload：

```json
{
  "roomId": "room_xxx",
  "sessionId": "user_xxx",
  "peerId": "peer_member_1"
}
```

- 触发时机：心跳续租当前在线状态
- 广播语义：
  - 若服务端判断状态有变化，会触发 `room.snapshot` + `room.presence.patch`
  - 单纯续租且无变化时，不额外广播
- 测试断言：错误的 `sessionId` 或 `peerId` 应收到 WsException

### `room.unsubscribe`

- 方向：Client -> Server
- ack：返回 `{ ok: true }`
- payload：

```json
{
  "roomId": "room_xxx"
}
```

- 触发时机：主动离开 realtime 通道
- 与断线的区别：
  - `room.unsubscribe` 立即清理当前 socket 的房间绑定
  - 若它是该 session 的活跃 socket，会直接把 presence 置为 `offline`
  - 断线则先进入 `reconnecting`
- 广播语义：
  - 可能触发 `room.snapshot`
  - 可能触发 `room.presence.patch`
  - 若该 peer 曾公告过缓存，还会触发 `piece.availability.clear`
- 测试断言：主动退订后不应再收到该房间广播

### `room.media.clock`

- 方向：Client -> Server
- ack：无正式契约
- payload：见 [shared-models.md](./shared-models.md) 中 `RoomMediaClockPayload`
- 触发时机：媒体发布端同步当前 media clock
- 广播语义：广播给房间内所有连接，包含发送者自身
- 测试断言：`sourcePeerId` 必须等于当前 socket 绑定的 `peerId`

### `piece.availability`

- 方向：Client -> Server
- ack：无正式契约
- payload：见 `TrackAvailabilityAnnouncement`
- 触发时机：某 peer 宣告自己对某曲目有哪些分片可用
- 广播语义：
  - 同实例内：广播给房间其他成员，不回给发送者
  - 跨实例：通过 Redis 分发到其他节点
- 测试断言：`ownerPeerId` 必须等于当前 socket 的 `peerId`

### `peer.signal`

- 方向：Client -> Server
- ack：无正式契约
- payload：见 `PeerSignalMessage`
- 触发时机：DataChannel / Media 协商 offer、answer、candidate
- 广播语义：
  - 定向发给 `toPeerId`
  - 不回给发送者
  - 目标 peer 不在线时可被暂存并在其重连后回放
- 测试断言：`fromPeerId` 必须等于当前 socket 的 `peerId`

### `room.chat`

- 方向：Client -> Server
- ack：无正式契约
- payload：

```json
{
  "roomId": "room_xxx",
  "senderId": "user_xxx",
  "senderName": "Tester",
  "content": "hello",
  "timestamp": 1713348600000
}
```

- 触发时机：发送聊天消息
- 广播语义：广播给房间其他成员，不回给发送者
- 测试断言：当前服务端不对聊天内容做额外校验或持久化

## Server -> Client

### `room.snapshot`

- 方向：Server -> Client
- payload：`RoomSnapshot`
- 触发时机：
  - 订阅成功后的首个完整快照
  - 房间拓扑、队列、曲库、歌单等需要全量刷新时
- 广播语义：广播给房间内全部订阅者；首帧也会单发给新订阅者
- 测试断言：
  - `room.roomRevision` 应单调递增
  - 客户端应把它当作权威状态

### `room.snapshot.missing`

- 方向：Server -> Client
- payload：

```json
{
  "roomId": "room_xxx"
}
```

- 触发时机：
  - 订阅房间不存在
  - 房间被删除
- 广播语义：可对单一订阅者发送，也可广播给整个房间
- 测试断言：收到后应终止当前房间会话

### `room.deleted`

- 方向：Server -> Client
- payload：

```json
{
  "roomId": "room_xxx",
  "trackIds": ["track_1", "track_2"]
}
```

- 触发时机：房主成功删除房间
- 广播语义：广播给整个房间
- 测试断言：`trackIds` 应覆盖被删房间中的全部曲目

### `room.session.replaced`

- 方向：Server -> Client
- payload：

```json
{
  "roomId": "room_xxx",
  "reason": "duplicate-session"
}
```

- 触发时机：同一 `roomId + sessionId` 被另一个新 socket 替换，且 `peerId` 不同
- 广播语义：仅发给被替换的旧连接
- 测试断言：收到该事件后旧连接应清空房间态并停止发房间事件

### `room.playback.patch`

- 方向：Server -> Client
- payload：`RoomPlaybackPatchPayload`
- 触发时机：播放控制成功
- 广播语义：广播给整个房间
- 测试断言：`playback.playbackRevision` 应等于最新权威版本

### `room.queue.patch`

- 方向：Server -> Client
- payload：`RoomQueuePatchPayload`
- 触发时机：加歌、删歌、重排、从歌单导回队列
- 广播语义：广播给整个房间
- 测试断言：`queue` 顺序与 `position` 一致；如有 `roomRevision`，应不小于上一版本

### `room.presence.patch`

- 方向：Server -> Client
- payload：`RoomPresencePatchPayload`
- 触发时机：成员上线、离线、重连、退订、加入、离房
- 广播语义：广播给整个房间
- 测试断言：`presenceRevision` 单调递增；`members[*].presenceState` 只应为 `online / reconnecting / offline`

### `room.library.patch`

- 方向：Server -> Client
- payload：`RoomLibraryPatchPayload`
- 触发时机：注册曲目、删除曲目
- 广播语义：广播给整个房间
- 测试断言：删除曲目时，相关队列与播放状态也应同步变化

### `room.media.clock`

- 方向：Server -> Client
- payload：`RoomMediaClockPayload`
- 触发时机：发布端发出新的 media clock
- 广播语义：广播给房间全部订阅者，包含原发送者
- 测试断言：`sequence` 应按发送端递增

### `piece.availability`

- 方向：Server -> Client
- payload：`TrackAvailabilityAnnouncement`
- 触发时机：
  - peer 上报新 availability
  - 新成员订阅时补发当前房间缓存的 availability
- 广播语义：
  - 常规广播排除原发送者
  - 新订阅者补发时只发给该订阅者
- 测试断言：同一 `trackId + ownerPeerId` 的新公告应覆盖旧公告

### `piece.availability.clear`

- 方向：Server -> Client
- payload：

```json
{
  "roomId": "room_xxx",
  "ownerPeerId": "peer_member_1",
  "updatedAt": "2026-04-17T10:20:00.000Z"
}
```

- 触发时机：peer 离线、退订、房间删除，或服务端清理该 peer 的 availability
- 广播语义：广播给整个房间
- 测试断言：客户端应删除该 `ownerPeerId` 的所有可用性记录

### `peer.signal`

- 方向：Server -> Client
- payload：`PeerSignalMessage`
- 触发时机：服务端把协商消息转发给目标 peer，或回放暂存消息
- 广播语义：只定向发给 `toPeerId`
- 测试断言：目标 peer 重新订阅后，未过期缓存信令应被回放

### `room.chat`

- 方向：Server -> Client
- payload：`RoomChatPayload`
- 触发时机：房间其他成员发消息
- 广播语义：广播给房间其他成员，不回给发送者
- 测试断言：当前实现不持久化聊天，不跨重连恢复

## 关键时序

### 1. 登录 -> 建房/入房 -> 订阅 -> 首次快照

1. `POST /v1/auth/login`
2. `POST /v1/rooms` 或 `POST /v1/rooms/{roomId}/join`
3. 建立 Socket.IO 连接并携带 `sessionToken`
4. 发送 `room.subscribe`
5. 收到 ack
6. 收到 `room.snapshot`
7. 可能继续收到已缓存的 `piece.availability`

### 2. 队列 / 播放 REST 与 patch 联动

1. REST 改动队列：`POST/DELETE/PATCH /queue`
2. 服务端先更新房间记录
3. 广播 `room.snapshot`
4. 广播 `room.queue.patch`

播放控制不同：

1. `PATCH /playback`
2. 服务端校验 `expectedVersion === playbackRevision`
3. 成功后只广播 `room.playback.patch`

### 3. peer 不在线时的 `peer.signal`

1. A 向 B 发送 `peer.signal`
2. 若 B 当前没有活跃 socket，服务端按 `roomId + peerId` 暂存
3. B 在 TTL 内重新 `room.subscribe`
4. 服务端回放暂存信令给 B

### 4. duplicate session replacement

1. 旧连接已用 `sessionId = user_xxx` 订阅房间
2. 新连接使用同一 `sessionId` 再次 `room.subscribe`
3. 若新旧 `peerId` 不同：
   - 旧连接收到 `room.session.replaced`
   - 房间播放可能被暂停以避免状态污染
   - 新连接成为活跃会话

### 5. 断线 -> `reconnecting` -> `offline`

1. socket 断开
2. 服务端把成员 presence 置为 `reconnecting`
3. 若在 `25s` 内重新订阅，则恢复为 `online`
4. 超时未恢复，服务端把成员 presence 置为 `offline`
5. 如该 peer 有 availability，会触发 `piece.availability.clear`
