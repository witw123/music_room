# 02 · WebRTC Peer 连接重构归档

状态：`历史提案，不代表当前实现`

本文件原本讨论把旧的房间资产分片传输 mesh 拆分为多个协作者。旧资产传输、分片帧和 availability 方案已删除，不能据此实现新的房间功能。

当前有效边界：

- Socket.IO 负责房间状态和 WebRTC offer/answer/candidate 信令
- `music-room-control` DataChannel 只负责控制/健康协调
- 音频通过独立 WebRTC Media RTP Opus Track 发布
- 成员之间不传输原始资产、播放资产或缓存分片

当前连接生命周期见 [WebRTC 媒体与控制](../architecture/p2p-distribution.md) 和 [实时链路](../architecture/realtime.md)。
