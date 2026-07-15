# 播放同步

最后更新：`2026-07-15`

## 权威模型

服务端保存并广播 `PlaybackSnapshot`。客户端使用以下字段建立同一条媒体时间线：

- `status`
- `currentTrackId`
- `currentQueueItemId`
- `positionMs`
- `startAt`
- `playbackRevision`
- `mediaEpoch`
- `sourceSessionId`
- `sourcePeerId`

`playbackRevision` 变化表示需要重新定位时间线，`mediaEpoch` 变化表示媒体拓扑发生变化。普通房间快照刷新不改变媒体会话身份。

## 唯一播放链路

源端从 IndexedDB 读取播放资产的分段 Opus 数据，由 `SegmentedOpusEngine` 解码并按房间时钟调度。所有分段经过同一个共享 AudioContext 图：

```text
AudioBufferSource -> sourceGain -> limiter -> playbackGate
  -> 本地音量 Gain -> context.destination
  -> broadcastDestination -> WebRTC RTP Opus
```

输出总线固定保留 `MediaStream` 和 `MediaStreamTrack`。暂停、缺片、解码等待和短暂欠载只把 `playbackGate` 平滑降到静音，恢复时再平滑升起。

监听端只绑定同一个远端 `MediaStream`。`remoteTrackId` 或媒体会话 key 真正变化时才重新绑定 `audio.srcObject`；`waiting`、`stalled` 恢复只重新调用 `play()`。

## 会话身份

`mediaSessionKey` 只由以下字段组成：

```text
trackId | playbackAssetId | mediaEpoch | playbackRevision |
startAt | sourcePeerId | remoteTrackId
```

音量使用 AudioParam ramp，不影响广播分支。limiter 前后的 peak、RMS 和最大瞬时跃变用于诊断爆音、削波和异常噪声。

## 调度参数

| 参数 | 值 |
|---|---:|
| schedule lead | 80ms |
| startup buffer | 4000ms |
| target buffered ahead | 12000ms |
| schedule ahead | 20000ms |
| underrun guard | 1000ms |
| fade duration | 20ms |
| sync interval | 100ms |

## 诊断

共享 `segmentedPlaybackStatus` 只描述分段 Opus/WebRTC 会话：资产、会话 key、源 peer、AudioContext、输出/远端 Track、缓冲、欠载、解码峰值/RMS、解码错误和媒体恢复状态。
