# 实时链路

最后更新：`2026-04-03`

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

### WebRTC Media

负责：

- 房主向成员发送实时音频流
- 在本地缓存尚未可播时承担秒开和兜底

## 当前事件层

服务端当前已经在广播这些关键事件：

- `room.snapshot`
- `room.snapshot.missing`
- `room.deleted`
- `room.playback.patch`
- `room.queue.patch`
- `room.presence.patch`
- `room.library.patch`
- `peer.signal`
- `piece.availability`
- `room.chat`

## 快照与 patch 的关系

- `room.snapshot` 仍然是最完整的基线状态
- `room.playback.patch`、`room.queue.patch`、`room.presence.patch`、`room.library.patch`
  用于减少整包快照的依赖
- 新订阅者仍会收到当前房间快照

## 在线与断线策略

- 客户端定期发送 `room.presence`
- 服务端在线 TTL 当前为 `20s`
- Socket 断开后存在 `25s` 重连宽限期
- 宽限期内同一成员重新订阅，在线态和媒体链路不会立刻被清空

## 当前诊断意义

当前房间诊断页可以帮助区分问题层级：

- Data / Media 都失败
  - 优先看 TURN、NAT、防火墙
- Data 正常、Media 失败
  - 优先看媒体协商和自动播放
- Media 正常、仍卡顿
  - 优先看本地缓冲、当前播放源和调度策略
