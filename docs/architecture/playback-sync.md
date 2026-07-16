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

曲目的 `playbackAssetId` 指向曲目拥有者本地 IndexedDB 中的分段 Opus 资产。该资产不会通过房间实时通道下载给其他成员。

`playbackRevision` 变化表示需要重新定位时间线，`mediaEpoch` 变化表示媒体拓扑发生变化。普通房间快照刷新不改变媒体会话身份。

## 唯一播放链路

源端从 IndexedDB 读取播放资产的分段 Opus 数据，由 `SegmentedOpusEngine` 解码并按房间时钟调度。所有分段经过同一个共享 AudioContext 图：

```text
AudioBufferSource -> sourceGain -> limiter -> playbackGate
  -> 本地音量 Gain -> context.destination
  -> broadcastDestination -> WebRTC RTP Opus
```

输出总线固定保留 `MediaStream` 和 `MediaStreamTrack`。暂停、缺片、解码等待和短暂欠载只把 `playbackGate` 平滑降到静音，恢复时再平滑升起。

曲终后队列不循环：没有下一首可播放（或剩余曲目 owner 均离线）时暂停在队尾。服务端 watchdog 会在 `positionMs` 越过 `durationMs` 且客户端未切歌时自动推进。

播放控制：房主可写全部动作；当前媒体源 session 可调用 next/prev（曲终自动切歌）。媒体源始终是曲目拥有者（在线时）。

监听端只绑定同一个远端 `MediaStream`。`remoteTrackId` 或媒体会话 key 真正变化时才重新绑定 `audio.srcObject`；`waiting`、`stalled` 恢复只重新调用 `play()`，不清空或重新设置 `srcObject`。

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

共享 `segmentedPlaybackStatus` 只描述分段 Opus/WebRTC 会话：资产、会话 key、源 peer、AudioContext、输出/远端 Track、缓冲、欠载、解码峰值/RMS、解码错误和媒体恢复状态。它不描述资产下载、缓存同步或播放 fallback。
