# 共享模型

最后更新：`2026-07-15`
当前版本：`0.2.8`

## 使用原则

- 本文档只解释测试和联调必须理解的共享对象
- 字段权威来源是 `packages/shared/src/**`
- 这里解释对象职责、关键字段和版本语义，不复制源码全部字段
- 当前协议不包含房间缓存、资产下载或成员间音频传输模型

## 核心对象

### `AuthSession`

- REST 和 Socket.IO 共用的登录态对象
- `id` / `userId`：当前实现两者值相同，都是用户 ID
- `username`、`nickname`、`createdAt`
- `token`：写入 REST 的 `x-session-token` 或 Socket.IO 的 `auth.sessionToken`

### `RoomSnapshot`

- 房间权威全量状态
- 组成：`room`、`tracks`、`queue`、`playlists`
- patch 与本地状态冲突时，以版本更高的完整快照为准

### `Room` / `RoomMember`

`Room` 关键字段：

- `id`、`hostId`、`joinCode`
- `name`、`description`、`hasPassword`
- `visibility`: `private | public`
- `members`、`playback`
- `presenceRevision`、`roomRevision`

`RoomMember` 关键字段：

- `id`、`nickname`、`role`: `host | member`
- `joinedAt`、`peerId`
- `presenceState`: `online | reconnecting | offline`

`peerId` 只在 realtime peer 在线并成功订阅后有效。

### `PlaybackSnapshot`

房间权威播放状态：

- `status`: `playing | paused | buffering`
- `currentTrackId`、`currentQueueItemId`
- `playbackAssetId`：当前播放资产 ID，可为空
- `startAt`、`startedAt`、`positionMs`
- `sourceSessionId`、`sourcePeerId`、`sourceTrackId`
- `queueVersion`、`playbackRevision`、`mediaEpoch`

语义：

- `playbackRevision` 用于播放控制的并发保护
- `queueVersion` 只表示队列结构版本
- `mediaEpoch` 表示当前媒体发布代次；媒体拓扑彻底变化或重新协商时递增
- `sourcePeerId` 对应当前曲目拥有者的媒体源 peer

### `TrackMeta`

房间曲库中的曲目元数据。服务端同步这些字段，但不接收音频文件本体：

- `id`、`title`、`artist`、`album`
- `durationMs`、`bitrate`、`sizeBytes`
- `codec`、`mimeType`、`fileHash`、`artworkUrl`
- `ownerSessionId`、`ownerNickname`
- `sourceType`: `local_upload` 或 `netease`
- `sourceRef`: 网易云曲目必须携带 `{ provider: "netease", trackId: string }`；本地上传不得携带该字段
- `originalAsset`：可选的本地原始资产清单
- `playbackAsset`：可选的本地分段 Opus 资产清单

`playbackAsset` 当前使用 `opus-music-v2`：48kHz、2 秒分段、`audio/ogg` 容器和单声道 96kbps/立体声 192kbps 配置。资产内容保留在拥有者浏览器的 IndexedDB 中，不通过房间下载。

### 资产清单

`OriginalAssetManifest` 关键字段：`assetId`、`kind: original`、`fileHash`、`mimeType`、`sizeBytes`、`unitCount`、`unitSize`、`merkleRoot`。

`PlaybackAssetManifest` 关键字段：`assetId`、`kind: playback`、`sourceFileHash`、`profileId`、`codec`、`container`、`sampleRate`、`channels`、`bitrate`、`durationMs`、`segmentDurationMs`、`seekPrerollMs`、`unitCount`、`merkleRoot` 和 encoder 信息。

资产清单用于校验本地上传资产和选择播放资产，不是网络传输协议。

### `QueueItem`

- `id`、`trackId`
- `requestedBy`、`requestedById`
- `position`、`createdAt`

`position` 必须从 `0` 开始连续递增。

### `Playlist`

- `id`、`ownerId`、`title`、`description`
- `coverUrl`、`tags`、`isCollaborative`
- `trackIds`、`createdAt`、`updatedAt`

后端仍支持歌单，房间主 UI 当前默认聚焦队列、曲库和成员。

### `PeerSignalMessage`

通过 Socket.IO 定向转发的 WebRTC 协商消息：

- `protocolVersion`、`capability`
- `roomId`、`fromPeerId`、`toPeerId`
- `channelKind`: 当前协议固定为 `data`
- `linkKind`: `data | media`，表示 SDP/ICE 目标连接
- `recoveryGeneration`、`sequence`
- `type`: `offer | answer | candidate`
- `payload`

信令本身通过 Socket.IO 传输；`linkKind` 选择控制连接或媒体连接。`music-room-control` DataChannel 只处理控制/健康协调，媒体音频通过独立 WebRTC Media RTP Track 传输。

### `RoomSubscribeAckPayload`

`room.subscribe` 的 ack：

- `ok`
- 可选 `protocolVersion`、`capability`、`errorCode`
- `serverNow`、`recoveryGeneration`
- `bootstrap.roomId`、`bootstrap.roomRevision`、`bootstrap.presenceRevision`
- `bootstrap.playback`、`bootstrap.members`

ack 是订阅成功信号，但不替代后续的 `room.snapshot`。

### Patch payloads

- `RoomPlaybackPatchPayload`: `roomId`、`playback`、`updatedAt`
- `RoomQueuePatchPayload`: `roomId`、`queue`、`playback`、可选 `roomRevision`、`updatedAt`
- `RoomPresencePatchPayload`: `roomId`、`members`、`playback`、`presenceRevision`、可选 `roomRevision`、`updatedAt`
- `RoomLibraryPatchPayload`: `roomId`、`tracks`、`queue`、`playback`、可选 `roomRevision`、`updatedAt`

### `RoomChatPayload`

- `roomId`
- `senderId`、`senderName`
- `content`、`timestamp`

当前只做实时透传，不持久化聊天内容。

### `segmentedPlaybackStatus`

成员诊断中的播放状态只描述当前单一播放链路：

```text
playbackAssetId
mediaSessionKey
sourcePeerId
isSourceOwner
listenerPlaybackState
sourceStartState
audioContextState
outputTrackId
remoteTrackId
bufferedAheadMs
scheduledAheadMs
underrunCount
lastUnderrunAt
decodedPeak
decodedRms
lastDecodeError
mediaRecoveryState
```

该 schema 不包含旧 source、PCM、MSE、progressive、缓存下载或资产传输字段。

## 版本与一致性字段

### `roomRevision`

房间整体状态版本。成员、队列、曲库、presence 等拓扑变化会推进它。快照和 patch 冲突时，优先接受版本更高的完整快照。

### `presenceRevision`

成员在线态和 presence 拓扑版本，覆盖 `online`、`reconnecting`、`offline` 以及成员加入/离房。

### `queueVersion`

队列结构版本，覆盖加歌、删歌、重排和当前播放条目变化。

### `playbackRevision`

播放控制并发保护版本，覆盖播放、暂停、seek、上一首、下一首等控制动作。发送播放 REST 请求前必须读取最新值并作为 `expectedVersion` 使用。

### `mediaEpoch`

媒体发布代次。切换媒体源、重新协商媒体连接或彻底重建发布链路时变化。客户端应丢弃更旧代次的协商或媒体状态。

### `recoveryGeneration`

某个房间会话/peer 的恢复代次。成功订阅、会话替换或重连恢复后更新；旧代次信令不应污染当前连接。

## 项目级测试入口

- `/`：官网展示页
- `/app`：客户端工作区
- `/auth`：登录页
- `/rooms`：房间入口
- `/room/{roomId}`：房间内页面

Web 默认同源，桌面和移动浏览器共享同一套 REST / Socket.IO 协议与响应式网页。
