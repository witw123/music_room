# 共享数据模型

## 核心对象

- `GuestSession`: 游客身份与临时访问凭证
- `Room`: 房间基本信息、成员列表与播放快照
- `RoomMember`: 房间内成员与角色
- `TrackMeta`: 曲目元数据与本地文件标识
- `Playlist`: 可收藏、可协作的歌单
- `QueueItem`: 房间共享队列中的单首条目
- `PlaybackSnapshot`: 当前播放状态快照
- `PeerSignalMessage`: WebRTC 协商消息
- `TrackPieceInfo`: 单个 chunk 的标识和归属
- `TrackAvailability`: 某个 peer 对某曲目的 chunk 拥有声明

## 建模原则

- 共享类型只定义一次，放在 `packages/shared`
- REST DTO 与 WebSocket payload 尽量复用相同 schema
- 所有时间字段使用 ISO 字符串
- 所有客户端持有的曲目都必须绑定哈希

