# 可观测性

最后更新：`2026-07-15`
当前版本：`0.2.8`

## 观测入口

- 服务端日志
- `/health`、`/health/readiness` 和 `/metrics`
- 房间“成员与诊断”面板

## 播放诊断

房间诊断面板和 shared `segmentedPlaybackStatus` 关注同一条媒体链路：

- `playbackAssetId`、`mediaSessionKey`、`sourcePeerId`
- `audioContextState`
- `outputTrackId`、`remoteTrackId`
- `bufferedAheadMs`、`scheduledAheadMs`
- `underrunCount`、`lastUnderrunAt`
- limiter 后 `decodedPeak`、`decodedRms`
- `lastDecodeError` 和 `mediaRecoveryState`

P2P 诊断另外记录 DataChannel、ICE、RTP 码率、jitter、丢包、候选类型和最近事件。资源传输异常与播放输出异常分开判断。

## 排障顺序

1. 查看房间诊断中的 AudioContext、Track identity、缓冲和欠载计数
2. 查看 WebRTC ICE、RTP 码率、jitter 和丢包
3. 查看 DataChannel 资产传输和 IndexedDB 写入
4. 查看 `/health/readiness` 与服务端日志

媒体恢复期间应保持同一个输出 Track；只有媒体会话确实变化时才允许 Track identity 变化。
