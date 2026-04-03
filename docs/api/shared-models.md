# 共享模型

最后更新：`2026-04-03`

## 当前核心对象

### `AuthSession`

- 当前登录态对象
- 关键字段：
  - `id`
  - `userId`
  - `username`
  - `nickname`
  - `token`
  - `createdAt`

### `RoomSnapshot`

- 房间完整快照
- 包含：
  - `room`
  - `tracks`
  - `queue`
  - `playlists`

### `PlaybackSnapshot`

- 房间权威播放状态
- 关键字段：
  - `status`
  - `currentTrackId`
  - `currentQueueItemId`
  - `positionMs`
  - `startedAt`
  - `queueVersion`
  - `mediaEpoch`

### `TrackMeta`

- 曲目元数据
- 当前关键字段：
  - `title`
  - `artist`
  - `album`
  - `durationMs`
  - `bitrate`
  - `sizeBytes`
  - `codec`
  - `mimeType`
  - `fileHash`
  - `ownerSessionId`
  - `ownerNickname`

### `QueueItem`

- 共享队列里的单首条目
- 包含：
  - `trackId`
  - `requestedBy`
  - `requestedById`
  - `position`
  - `createdAt`

### `Playlist`

- 歌单数据对象
- 后端能力仍保留，但房间 UI 当前不再默认展示歌单区

### `TrackAvailabilityAnnouncement`

- P2P 分片可用性广播
- 当前关键字段：
  - `trackId`
  - `ownerPeerId`
  - `totalChunks`
  - `chunkSize`
  - `availableChunks`
  - `source`
  - `announcedAt`

### `PeerSignalMessage`

- WebRTC 信令载荷
- 用于 data / media 两类连接的协商

### `PeerDiagnosticsSnapshot`

- 成员诊断面板使用的数据结构
- 当前包含：
  - Data / Media 连接状态
  - ICE 状态
  - signal 统计
  - 远端 track 状态
  - 渐进式播放状态
  - 最近错误和最近事件
