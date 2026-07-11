# 共享模型

最后更新：`2026-07-07`
当前版本：`0.2.9`

## 使用原则

- 本文档只解释测试和联调必须理解的共享对象
- 字段权威来源是 `packages/shared/src/**`
- 这里优先解释对象职责、关键字段和版本语义，不复制源码全部字段

## 核心对象

### `AuthSession`

- 用途：REST 和 WebSocket 共享的登录态对象
- 关键字段：
  - `id` / `userId`：当前实现两者值相同，都是用户 ID
  - `username`
  - `nickname`
  - `token`：写入 `x-session-token` 或 Socket.IO `auth.sessionToken`
  - `createdAt`
- 测试关注点：`token` 是唯一必须持久传递给后续请求的字段

### `RoomSnapshot`

- 用途：房间权威全量状态
- 组成：
  - `room`
  - `tracks`
  - `queue`
  - `playlists`
- 测试关注点：所有 patch 冲突时都应回退到最新 `RoomSnapshot`

### `Room`

- 用途：房间基础元数据和当前播放状态容器
- 关键字段：
  - `id`
  - `hostId`
  - `joinCode`
  - `visibility`: `private | public`
  - `members`
  - `playback`
  - `presenceRevision`
  - `roomRevision`
- 测试关注点：
  - `joinCode` 当前为 6 位大写字母/数字
  - `visibility` 影响非成员是否可读完整房间快照

### `RoomMember`

- 用途：房间成员条目
- 关键字段：
  - `id`
  - `nickname`
  - `role`: `host | member`
  - `joinedAt`
  - `peerId`
  - `presenceState`: `online | reconnecting | offline`
- 测试关注点：
  - 房主离房后仍可能保留在列表里
  - `peerId` 只在 realtime 在线时有效

### `PlaybackSnapshot`

- 用途：房间权威播放状态
- 关键字段：
  - `status`: `playing | paused | buffering`
  - `currentTrackId`
  - `currentQueueItemId`
  - `sourceSessionId`
  - `sourcePeerId`
  - `sourceTrackId`
  - `positionMs`
  - `startedAt`
  - `queueVersion`
  - `playbackRevision`
  - `mediaEpoch`
- 测试关注点：
  - `playbackRevision` 是播放控制并发保护的核心版本
  - `queueVersion` 只表示队列结构版本
  - `mediaEpoch` 标识媒体发布代次，切源或重建 media 协商时会变化

### `TrackMeta`

- 用途：房间曲库中的单首曲目元数据
- 关键字段：
  - `id`
  - `title` / `artist` / `album`
  - `durationMs`
  - `bitrate`
  - `sizeBytes`
  - `codec`
  - `mimeType`
  - `fileHash`
  - `artworkUrl`
  - `ownerSessionId`
  - `ownerNickname`
  - `sourceType`: 当前固定为 `local_upload`
  - `pieceManifest`
  - `relayManifest`
- 测试关注点：
  - 曲目上传只同步元数据
  - `fileHash + ownerSessionId` 当前会触发去重覆盖

### `QueueItem`

- 用途：共享队列中的单个播放条目
- 关键字段：
  - `id`
  - `trackId`
  - `requestedBy`
  - `requestedById`
  - `position`
  - `createdAt`
- 测试关注点：`position` 必须从 `0` 开始连续递增

### `Playlist`

- 用途：用户歌单
- 关键字段：
  - `id`
  - `ownerId`
  - `title`
  - `description`
  - `coverUrl`
  - `tags`
  - `isCollaborative`
  - `trackIds`
  - `createdAt`
  - `updatedAt`
- 测试关注点：
  - 后端仍完整支持歌单
  - 房间主 UI 当前默认不展示歌单区

### `TrackAvailabilityAnnouncement`

- 用途：P2P 分片可用性公告
- 关键字段：
  - `roomId`
  - `trackId`
  - `ownerPeerId`
  - `nickname`
  - `assetKind`: `relay | original`
  - `assetHash`
  - `totalChunks`
  - `chunkSize`
  - `availableChunks`
  - `pieceHashes`
  - `source`: `live_upload | local_cache`
  - `announcedAt`
- 测试关注点：相同 `trackId + ownerPeerId` 的新公告会覆盖旧公告

### `PeerSignalMessage`

- 用途：WebRTC data/media 双通道的协商消息
- 关键字段：
  - `roomId`
  - `fromPeerId`
  - `toPeerId`
  - `channelKind`: `data | media`
  - `mediaEpoch`
  - `transportEpoch`
  - `recoveryGeneration`
  - `type`: `offer | answer | candidate`
  - `payload`
- 测试关注点：
  - `fromPeerId` 必须匹配当前 socket 绑定 peer
  - `recoveryGeneration` 在重连恢复阶段很关键

### `RoomSubscribeAckPayload`

- 用途：`room.subscribe` 的 ack
- 关键字段：
  - `ok`
  - `serverNow`
  - `recoveryGeneration`
  - `bootstrap.roomId`
  - `bootstrap.roomRevision`
  - `bootstrap.presenceRevision`
  - `bootstrap.playback`
  - `bootstrap.members`
- 测试关注点：ack 是订阅成功信号，但不替代后续 `room.snapshot`

### `RoomPlaybackPatchPayload`

- 用途：播放状态增量广播
- 关键字段：
  - `roomId`
  - `playback`
  - `updatedAt`
- 测试关注点：播放控制成功后，房间里通常先观测到它

### `RoomQueuePatchPayload`

- 用途：队列增量广播
- 关键字段：
  - `roomId`
  - `queue`
  - `playback`
  - `roomRevision`
  - `updatedAt`
- 测试关注点：队列变更时 `queue` 和 `playback` 一起下发

### `RoomPresencePatchPayload`

- 用途：成员 presence 增量广播
- 关键字段：
  - `roomId`
  - `members`
  - `playback`
  - `presenceRevision`
  - `roomRevision`
  - `updatedAt`
- 测试关注点：presence patch 同时携带当前播放态，避免 UI 脱节

### `RoomLibraryPatchPayload`

- 用途：曲库增量广播
- 关键字段：
  - `roomId`
  - `tracks`
  - `queue`
  - `playback`
  - `roomRevision`
  - `updatedAt`
- 测试关注点：曲目删除时，队列和播放状态也可能同时变化

### `PieceAvailabilityClearPayload`

- 用途：通知某个 peer 的 availability 需要整体清除
- 关键字段：
  - `roomId`
  - `ownerPeerId`
  - `updatedAt`
- 测试关注点：收到后应删除该 peer 的全部 availability 记录

### `RoomChatPayload`

- 用途：房间聊天消息
- 关键字段：
  - `roomId`
  - `senderId`
  - `senderName`
  - `content`
  - `timestamp`
- 测试关注点：当前只做透传，不持久化

## 版本与一致性字段

### `roomRevision`

- 所在对象：`Room`、多个 patch payload
- 作用：房间整体状态版本
- 何时变化：
  - 成员加入 / 离开
  - 队列变化
  - 曲库变化
  - presence 变化
  - 部分会影响播放状态的房间级操作
- 测试策略：完整快照和 patch 冲突时，优先接受更高 `roomRevision`

### `presenceRevision`

- 所在对象：`Room`、`RoomPresencePatchPayload`
- 作用：只追踪成员 presence 拓扑变化
- 何时变化：
  - `online`
  - `reconnecting`
  - `offline`
  - 成员加入 / 离房
- 测试策略：presence 面板和成员列表增量更新时用它判断新旧

### `queueVersion`

- 所在对象：`PlaybackSnapshot`
- 作用：队列结构版本
- 何时变化：
  - 加歌
  - 删歌
  - 重排
  - 删除当前播放条目时引发的队列结构变化

### `playbackRevision`

- 所在对象：`PlaybackSnapshot`
- 作用：播放控制并发保护版本
- 何时变化：
  - 播放、暂停、seek、上一首、下一首
  - source peer 重连或媒体拓扑重建
- 测试策略：
  - 发 `PATCH /playback` 前必须读取最新 `playbackRevision`
  - 服务端比较的是 `expectedVersion === playbackRevision`

### `mediaEpoch`

- 所在对象：`PlaybackSnapshot`、`RoomMediaClockPayload`、`PeerSignalMessage`
- 作用：标识当前媒体发布代次
- 何时变化：
  - 媒体流切换
  - 重新协商 media 通道
  - 发布链路重建
- 测试策略：收到旧 `mediaEpoch` 的 media 事件或 signal 时应按恢复策略丢弃

### `recoveryGeneration`

- 所在对象：`RoomSubscribeAckPayload`、`PeerSignalMessage`
- 作用：标识某个 `roomId + sessionId/peerId` 的恢复代次
- 何时变化：
  - 成功 `room.subscribe`
  - 会话替换或重连恢复
- 测试策略：新代次建立后，旧代次 signal 不应继续污染当前连接

## 项目级测试入口

- Web 页面入口：
  - `/`：官网展示页
  - `/app`：客户端工作区入口
  - `/auth`：登录页
  - `/rooms`：房间页入口
  - `/room/{roomId}`：房间内页面
- Web 运行默认同源
- 桌面壳和 Android 壳共享同一套 REST / Socket 协议，只是客户端形态不同
- 客户端壳测试时需要正确设置 `MUSIC_ROOM_PUBLIC_ORIGIN`
