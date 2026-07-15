# 项目状态

最后更新：`2026-07-15`
当前版本：`0.2.8`

## 当前主链路

- 账号、房间、队列和播放控制可用
- WebRTC DataChannel 负责资产分片传输
- IndexedDB 保存播放资产分段 Opus
- `SegmentedOpusEngine` 使用固定 AudioContext 输出总线
- 源端通过 MediaStreamAudioDestinationNode 发布 RTP Opus
- 监听端只使用一个 `audio.srcObject`
- 诊断协议使用 `segmentedPlaybackStatus`

## 稳定性措施

- sync single-flight 和 timeline generation 防止旧异步结果污染新时间线
- unit 读取、解码和调度去重
- 20ms source fade、欠载静音门和 limiter 降低 click/pop 与削波风险
- 本地音量和监听端恢复均采用平滑操作
- 房间快照、成员变化、presence 和音量变化不会重建媒体会话

## 已完成

- 旧播放引擎、旧播放编排、旧播放源控制和旧 fallback 已移除
- FLAC 解析、metadata、frame index 和上传阶段 PCM 工具仍保留
- 原始资产缓存和手动下载与播放链路解耦
- shared 诊断 schema 已切换为中性分段播放模型

## 后续风险

- 仍需在 CI 中持续运行双 Chromium context 的长时间 WebRTC 播放回归
- 需要采集真实设备上的 limiter peak、RMS、瞬时跃变和欠载恢复数据
- TURN 配置异常时跨网络媒体仍可能进入 reconnecting，但不应改变播放链路
