# WebRTC 媒体与控制

最后更新：`2026-07-15`

## 当前状态

本页取代早期的“房间 P2P 资产分发”设计。当前实现不在成员之间传输音频文件、播放资产或缓存分片，也不根据其他成员的缓存决定播放源。

## 当前连接模型

```text
Socket.IO
  -> room.snapshot / playback patch / presence / peer.signal

WebRTC control connection
  -> music-room-control DataChannel
  -> 控制和连接健康协调

WebRTC media connection
  -> owner MediaStreamAudioDestinationNode
  -> RTP Opus audio track
  -> listener audio.srcObject
```

`peer.signal` 通过 Socket.IO 定向转发 offer、answer 和 ICE candidate。信令消息使用 `linkKind` 区分控制连接和媒体连接，但两者都不承载音频资产。

## 媒体源规则

- 当前播放曲目的拥有者是唯一媒体源
- 拥有者必须在本地 IndexedDB 具有对应的播放资产
- 拥有者离线或媒体连接彻底失败时，房间进入暂停/恢复状态
- 成员加入、presence 更新、普通快照和音量变化不替换当前 Track
- 只有 source peer 变化、媒体 epoch 变化、切歌、退出房间或媒体连接彻底重建时才创建/释放 Track

## 诊断重点

排查 WebRTC 时查看：

- `dataConnectionState` / `mediaConnectionState`
- `dataIceState` / `mediaIceState`
- candidate type、protocol、RTT、jitter 和 packet loss
- `senderTrackId` / `receiverTrackId`
- `playbackAssetId`、`mediaSessionKey`、`bufferedAheadMs` 和 `underrunCount`

### 历史设计

早期 P2P 分片同步、手动缓存和成员间资产传输方案已删除，不是当前实现，也没有运行时兼容开关。历史讨论请见 `docs/refactor/02-p2p-mesh.md`，其中内容仅用于记录迁移背景。
