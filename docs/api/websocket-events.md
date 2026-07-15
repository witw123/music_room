# WebSocket 事件

最后更新：`2026-07-15`
当前版本：`0.2.8`

## 连接规范

- 协议：Socket.IO
- 服务端基址：`http://localhost:3001`
- path：`/ws/socket.io`
- 鉴权：优先 `handshake.auth.sessionToken`，也接受 `x-session-token` header
- 前置：先通过 REST 登录拿到 `AuthSession.token`
- `room.subscribe` 需要有效 `roomId`、`sessionId` 和稳定的本地 `peerId`

```ts
io("http://localhost:3001", {
  path: "/ws/socket.io",
  auth: { sessionToken: "<x-session-token>" }
});
```

Socket.IO 只负责房间状态、presence、聊天和 WebRTC 协商信令，不传输音频文件、播放资产或缓存分片。

## 当前契约原则

- `room.snapshot` 是房间状态的权威基线
- `room.playback.patch`、`room.queue.patch`、`room.presence.patch`、`room.library.patch` 只做增量优化
- patch 与本地状态冲突时，以版本更高的完整快照为准
- `room.subscribe` ack 提供 bootstrap 信息，但不替代随后的 `room.snapshot`
- WsException 错误优先返回 `{ "code": string, "message": string, "details"?: unknown }`

## 连接与恢复语义

- 同一 `roomId + sessionId` 被不同 `peerId` 再次订阅时，旧连接收到 `room.session.replaced`
- Socket 断线后先进入 `reconnecting`，当前重连宽限期为 `25s`，超时转为 `offline`
- 目标 peer 不在线时，`peer.signal` 按 `roomId + peerId` 暂存，当前 TTL 为 `10s`
- peer 重新订阅后回放未过期信令
- source owner 离线时，服务端暂停当前播放，不从其他成员寻找替代音频资产

## Client -> Server

### `room.subscribe`

进入房间后建立 realtime 绑定。payload 至少包含：

```json
{
  "roomId": "room_xxx",
  "sessionId": "user_xxx",
  "peerId": "peer_member_1"
}
```

ack 成功时包含 `ok`、`serverNow`、`recoveryGeneration` 和 `bootstrap`：

```json
{
  "ok": true,
  "serverNow": "2026-07-15T10:10:00.000Z",
  "recoveryGeneration": 3,
  "bootstrap": {
    "roomId": "room_xxx",
    "roomRevision": 8,
    "presenceRevision": 5,
    "playback": {
      "status": "paused",
      "currentTrackId": null,
      "currentQueueItemId": null,
      "playbackAssetId": null,
      "sourceSessionId": "user_host",
      "sourcePeerId": "peer_host",
      "sourceTrackId": null,
      "positionMs": 0,
      "startedAt": null,
      "queueVersion": 3,
      "playbackRevision": 3,
      "mediaEpoch": 1
    },
    "members": []
  }
}
```

失败包括缺少身份字段、token 不匹配、`REALTIME_UNAVAILABLE` 和房间不存在。成功订阅后会异步收到 `room.snapshot`。

### `room.presence`

用于续租当前在线状态：

```json
{
  "roomId": "room_xxx",
  "sessionId": "user_xxx",
  "peerId": "peer_member_1"
}
```

状态发生变化时服务端发送 `room.snapshot` 和 `room.presence.patch`；单纯续租且状态未变时不额外广播。

### `room.unsubscribe`

```json
{ "roomId": "room_xxx" }
```

主动退订会立即清理当前 socket 的房间绑定；与断线不同，它会直接结束当前 presence。不会触发任何资产缓存清理事件。

### `peer.signal`

通过 Socket.IO 定向转发 WebRTC `offer`、`answer`、`candidate`。`fromPeerId` 必须匹配当前 socket，`toPeerId` 指定目标 peer。`linkKind` 为 `data` 或 `media`，分别对应控制连接和独立媒体连接。

### `room.chat`

发送房间聊天消息。payload 为 `roomId`、`content` 和可选 `timestamp`；服务端补充发送者身份后转发给其他成员，不持久化。

## Server -> Client

### `room.snapshot`

完整 `RoomSnapshot`。订阅后的首帧以及房间拓扑、队列、曲库、歌单需要全量刷新时发送。`room.roomRevision` 应单调递增。

### `room.snapshot.missing`

```json
{ "roomId": "room_xxx" }
```

房间不存在或已被删除时发送；客户端应结束当前房间会话。

### `room.deleted`

```json
{
  "roomId": "room_xxx",
  "trackIds": ["track_1", "track_2"]
}
```

房主成功删除房间后广播，`trackIds` 覆盖该房间的全部曲目。

### `room.session.replaced`

```json
{
  "roomId": "room_xxx",
  "reason": "duplicate-session"
}
```

旧会话被不同 peer 的新连接替换时，仅发给旧连接。

### `room.playback.patch`

播放控制成功后广播 `RoomPlaybackPatchPayload`。客户端以其中最新的 `playbackRevision` 更新播放时间线。

### `room.queue.patch`

加歌、删歌、重排或从歌单导回队列时广播 `RoomQueuePatchPayload`。`queue` 与 `playback` 一起更新。

### `room.presence.patch`

成员上线、离线、重连、退订、加入或离房时广播 `RoomPresencePatchPayload`，包含最新成员列表和播放状态。

### `room.library.patch`

注册或删除曲目时广播 `RoomLibraryPatchPayload`，包含最新曲库、队列和播放状态。

### `peer.signal`

定向发送或回放未过期的 WebRTC 协商信令。媒体音频不通过此事件传输。

### `room.chat`

房间其他成员的聊天消息。不跨重连恢复。

## 关键时序

### 登录 -> 建房/入房 -> 订阅 -> 首次快照

1. `POST /v1/auth/login`
2. `POST /v1/rooms` 或 `POST /v1/rooms/{roomId}/join`
3. 建立 Socket.IO 连接并携带 `sessionToken`
4. 发送 `room.subscribe`
5. 收到 ack
6. 收到 `room.snapshot`
7. 客户端根据 `playback` 和成员 peer 状态开始 WebRTC 控制/媒体协商

### 队列与播放控制

1. REST 修改队列或播放状态
2. 服务端校验权限、版本和 Realtime 可用性
3. 广播对应的 `room.snapshot` / patch
4. 客户端按 `playbackRevision` 和 `mediaEpoch` 更新本地运行时

### 断线恢复

1. Socket 断开，成员进入 `reconnecting`
2. 客户端在宽限期内重新建立连接并发送 `room.subscribe`
3. 服务端返回新的 `recoveryGeneration` 和 bootstrap
4. 客户端丢弃旧 generation 的 signal，恢复当前控制/媒体连接
5. 成功后成员回到 `online`；超时则转为 `offline`
