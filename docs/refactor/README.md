# 播放链路迁移记录

最后更新：`2026-07-15`

本目录记录旧播放实现向单一 Segmented Opus/WebRTC 链路的迁移结果。历史方案不再是当前架构，也不提供运行时兼容开关。

## 当前结果

- IndexedDB 分段 Opus 是唯一播放输入
- `SegmentedOpusEngine` 是唯一播放引擎
- 共享 AudioContext、destination 和 RTP Opus Track 由房间媒体会话持有
- 监听端只绑定单一 `audio.srcObject`
- 原始资产解析、上传 PCM、FLAC metadata 和资源缓存保留在非播放模块

## 关键约束

- 房间快照和 presence 更新只更新 ref，不重建媒体 effect
- 同一个媒体会话复用 destination 与 Track
- 欠载和解码等待输出平滑静音
- source 停止先 fade，再延迟断开
- 旧 schema、旧播放字段和旧 fallback 不接受

详见：[当前播放同步模型](../architecture/playback-sync.md) 和 [迁移实施说明](./01-playback-runtime.md)。
