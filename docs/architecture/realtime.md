# 实时链路

最后更新：`2026-04-17`

## 角色划分

### WebSocket / Socket.IO

负责：

- 房间订阅与退订
- 房间快照和 patch 广播
- presence 心跳
- WebRTC 信令转发
- 分片可用性广播
- 房间聊天消息

### WebRTC DataChannel

负责：

- 请求歌曲分片
- 返回歌曲分片
- 驱动本地缓存增长

## 当前事件层

服务端当前已经在广播这些关键事件：

- `room.snapshot`
- `room.snapshot.missing`
- `room.deleted`
- `room.session.replaced`
- `room.playback.patch`
- `room.queue.patch`
- `room.presence.patch`
- `room.library.patch`
- `room.media.clock`
- `peer.signal`
- `piece.availability`
- `piece.availability.clear`
- `room.chat`

## 快照与 patch 的关系

- `room.snapshot` 是共享房间状态的权威基线
- `RoomSnapshot.room.roomRevision` 单调递增，用来判断整包房间状态是否比当前更新
- 成员、在线态、host、队列、曲库变化都会伴随新的 `room.snapshot`
- `room.playback.patch`、`room.queue.patch`、`room.presence.patch`、`room.library.patch`
  只做增量优化，不再承担唯一正确性
- 新订阅者收到的第一份共享状态必须是已经应用本次在线态后的权威 `room.snapshot`

## 在线与断线策略

- 客户端定期发送 `room.presence`
- 服务端在线 TTL 当前为 `60s`
- Socket 断开后存在 `25s` 重连宽限期
- 宽限期内同一成员重新订阅，在线态和媒体链路不会立刻被清空
- 同一 `roomId + sessionId` 被不同 `peerId` 重复订阅时，旧连接会收到 `room.session.replaced`
- 目标 peer 不在线时，`peer.signal` 会做短时缓存并在其重新订阅后回放

## 当前诊断意义

当前房间诊断页可以帮助区分问题层级：

- Data / Media 都失败
  - 优先看 TURN、NAT、防火墙
- Data 正常、Media 失败
  - 优先看媒体协商和自动播放
- Media 正常、仍卡顿
  - 优先看本地缓冲、当前播放源和调度策略
