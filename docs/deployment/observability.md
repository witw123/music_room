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

Peer 诊断另外记录控制 DataChannel、媒体 ICE、RTP 码率、jitter、丢包、候选类型和最近事件。控制连接异常与媒体输出异常分开判断。

## 排障顺序

1. 查看房间诊断中的 AudioContext、Track identity、缓冲和欠载计数
2. 查看 WebRTC ICE、RTP 码率、jitter 和丢包
3. 查看 source owner 在线状态、媒体协商和源端 IndexedDB 播放资产读取
4. 查看 `/health/readiness` 与服务端日志

媒体恢复期间应保持同一个输出 Track 和远端 `srcObject`；只有媒体会话确实变化时才允许 Track identity 变化。
