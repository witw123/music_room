# WebSocket 事件协议

最后更新：`2026-03-28`

## 当前状态

- `已实现`
  - `room.subscribe`
  - `room.unsubscribe`
  - `room.snapshot`
  - `room.snapshot.missing`
  - `peer.signal`
- `未实现`
  - `member.joined`
  - `member.left`
  - `queue.update`
  - `playback.update`
  - `track.announce`
  - `piece.availability`

当前实现仍以 `room.snapshot` 全量快照广播为主，后续才会拆分为更细粒度事件。

## 已实现事件

## `room.subscribe`

- 方向：Client -> Server
- 入参：
  - `roomId`
- 作用：
  - 将当前 socket 加入房间广播组
  - 服务端会立即回推当前房间快照

## `room.unsubscribe`

- 方向：Client -> Server
- 入参：
  - `roomId`
- 作用：
  - 将当前 socket 移出房间广播组

## `room.snapshot`

- 方向：Server -> Client
- 载荷：
  - `RoomSnapshot`
- 作用：
  - 广播房间最新快照
  - 新订阅连接也会收到当前快照

## `room.snapshot.missing`

- 方向：Server -> Client
- 载荷：
  - `roomId`
- 作用：
  - 客户端订阅了一个已不存在的房间
  - 便于前端清理本地恢复状态

## `peer.signal`

- 方向：双向
- 载荷：
  - `PeerSignalMessage`
- 作用：
  - 为后续 WebRTC 协商预留信令通道
- 当前限制：
  - 已可收发，但尚未支撑真实 P2P 媒体分发

## 后续会追加的事件

- `member.joined`
- `member.left`
- `queue.update`
- `playback.update`
- `track.announce`
- `piece.availability`
