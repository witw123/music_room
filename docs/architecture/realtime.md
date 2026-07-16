# 实时链路

最后更新：`2026-07-15`

## 角色划分

### Socket.IO / WebSocket

负责：

- 房间订阅与退订
- 房间快照和 patch 广播
- presence 心跳和成员状态
- WebRTC offer/answer/candidate 信令转发
- 房间聊天消息

Socket.IO 不传输音频文件、播放资产或缓存分片。

### WebRTC 控制连接

每个房间 peer 使用 `music-room-control` DataChannel 做控制和连接健康协调。它不是媒体源，也不是资产传输通道。

### WebRTC 媒体连接

媒体连接独立于控制 DataChannel。源端将共享 AudioContext 的 `MediaStreamAudioDestinationNode` 发布为一个 RTP Opus 音频 Track；监听端只绑定一个远端 `MediaStream` 到一个 audio 元素。

## 当前事件层

当前 Socket.IO 事件包括：

- `room.subscribe`
- `room.presence`
- `room.unsubscribe`
- `room.snapshot`
- `room.snapshot.missing`
- `room.deleted`
- `room.session.replaced`
- `room.playback.patch`
- `room.queue.patch`
- `room.presence.patch`
- `room.library.patch`
- `peer.signal`
- `room.chat`

不存在用于分片可用性、缓存同步或资产下载的房间事件。

## 快照与 patch 的关系

- `room.snapshot` 是共享房间状态的权威基线
- `RoomSnapshot.room.roomRevision` 单调递增，用来判断整包房间状态是否比当前更新
- 成员、在线态、host、队列、曲库变化都会伴随新的 `room.snapshot`
- `room.playback.patch`、`room.queue.patch`、`room.presence.patch`、`room.library.patch` 只做增量优化，不承担唯一正确性
- 新订阅者收到的第一份共享状态必须是已经应用本次在线态后的权威 `room.snapshot`

快照或 presence 更新只更新客户端状态和运行时 ref，不应因为对象引用变化而重建播放媒体会话。

## 在线与断线策略

- 客户端定期发送 `room.presence`
- 服务端在线 TTL 当前为 `60s`
- Socket 断开后存在 `25s` 重连宽限期
- 宽限期内同一成员重新订阅，在线态可以恢复为 `online`
- 同一 `roomId + sessionId` 被不同 `peerId` 重复订阅时，旧连接会收到 `room.session.replaced`
- 目标 peer 不在线时，`peer.signal` 会做短时缓存并在其重新订阅后回放
- 当前媒体源（曲目拥有者）离线时，服务端暂停播放并清空 startAt/sourcePeerId；不会切换到未拥有资产的成员。播放控制仅房主可写。

## 当前诊断意义

诊断页按层区分问题：

- Socket.IO 和控制 DataChannel 都失败：优先看认证、信令、TURN、NAT 和防火墙
- 控制连接正常、媒体连接失败：优先看媒体协商、ICE、自动播放和远端 Track 绑定
- 媒体连接正常但卡顿或有噪声：优先看 AudioContext、缓冲 ahead、underrun、limiter peak/RMS、RTP jitter 和丢包

恢复过程中应保留当前输出总线和 Track identity；只有媒体会话确实变化时才释放并创建新的 Track。
