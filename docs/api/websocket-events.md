# WebSocket 事件

最后更新：`2026-04-03`

## 当前事件概览

### Client -> Server

- `room.subscribe`
- `room.presence`
- `room.unsubscribe`
- `piece.availability`
- `peer.signal`
- `room.chat`

### Server -> Client

- `room.snapshot`
- `room.snapshot.missing`
- `room.deleted`
- `room.playback.patch`
- `room.queue.patch`
- `room.presence.patch`
- `room.library.patch`
- `piece.availability`
- `peer.signal`
- `room.chat`

## 关键事件

### `room.subscribe`

- 方向：Client -> Server
- 作用：订阅房间，绑定 `roomId + sessionId + peerId`
- 成功后会收到当前 `room.snapshot`

### `room.presence`

- 方向：Client -> Server
- 作用：维持在线状态和当前 `peerId`

### `room.unsubscribe`

- 方向：Client -> Server
- 作用：主动退订房间

### `room.snapshot`

- 方向：Server -> Client
- 载荷：`RoomSnapshot`
- 作用：首次同步或需要整包刷新时的完整房间状态

### `room.playback.patch`

- 方向：Server -> Client
- 载荷：
  - `roomId`
  - `playback`
  - `updatedAt`
- 作用：增量更新播放状态

### `room.queue.patch`

- 方向：Server -> Client
- 载荷：
  - `roomId`
  - `queue`
  - `playback`
  - `updatedAt`
- 作用：增量更新共享队列

### `room.presence.patch`

- 方向：Server -> Client
- 作用：增量更新成员在线状态

### `room.library.patch`

- 方向：Server -> Client
- 作用：增量更新曲库和相关队列状态

### `peer.signal`

- 方向：双向
- 作用：WebRTC offer / answer / candidate 信令

### `piece.availability`

- 方向：双向
- 作用：广播某个 peer 当前可供分发的歌曲分片

### `room.chat`

- 方向：双向
- 作用：房间聊天消息

## 当前实现特点

- 房间状态既有 `snapshot` 也有 patch
- WebRTC 的 data 和 media 都通过 `peer.signal` 协商
- 房间断线后存在重连宽限期，不会立即把成员视为离线
