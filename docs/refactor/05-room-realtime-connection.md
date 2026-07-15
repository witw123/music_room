# 05 · 房间实时连接重构归档

状态：`历史提案，不代表当前实现`

本文件原本讨论房间 Socket.IO 订阅、presence 看门狗和恢复编排的拆分。当前实现已经完成房间实时运行时的稳定化，新增修改应以实际 hook 和测试为准。

当前约束：

- `room.snapshot` 是权威基线，patch 只做增量优化
- presence、成员变化和普通快照刷新不能重建播放媒体会话
- `peer.signal` 只转发 WebRTC 协商，不承载音频资产
- 重连使用 `recoveryGeneration` 丢弃旧代次信令
- source owner 离线时暂停当前媒体源，不切换到不存在的替代资产

当前协议见 [WebSocket 事件](../api/websocket-events.md)，当前播放会话见 [播放同步](../architecture/playback-sync.md)。
