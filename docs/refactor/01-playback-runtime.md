# 01 · 单一播放运行时迁移

最后更新：`2026-07-15`
状态：已完成

## 目标

把多个本地播放实现收敛为一条可验证的媒体路径：

```text
IndexedDB 分段 Opus
 -> SegmentedOpusEngine
 -> 共享 AudioContext 输出总线
 -> WebRTC RTP Opus
 -> 监听端 audio.srcObject
```

## 已落地内容

- `PlaybackMediaSession` 和 `PlaybackStartRequest` 提供中性会话与动作模型
- `SegmentedOpusEngine.sync()` 使用 single-flight，最新请求覆盖等待中的旧请求
- `timelineGeneration` 丢弃过期 IndexedDB 读取和解码结果
- unit 读取、解码、调度去重，调度窗口固定为 20 秒
- 启动缓冲 4 秒，目标前向缓冲 12 秒，调度提前量 80ms
- source Gain 20ms fade，欠载使用共享播放门静音
- limiter 前后采集 peak、RMS 和最大瞬时跃变
- 本地音量独立于广播音量，并使用 20ms AudioParam ramp
- listener 仅在媒体会话或远端 Track identity 变化时重新绑定
- waiting/stalled 只重试 `play()`，不清空 `srcObject`
- room exit 才释放共享 destination 和输出 Track

## 删除和保留

已删除旧播放引擎、旧编排器、旧源控制、旧时间窗和旧诊断字段。上传阶段的 PCM accumulator、FLAC parser、metadata/frame index 和个人本地资产处理继续保留；房间资产下载和成员间资产传输不再存在。

## 验收重点

- 成员、presence、普通快照和音量变化不重建媒体会话
- 暂停、缺片和解码等待不调用 `replaceTrack(null)`
- 切歌和 seek 没有重叠音或硬切 click
- destination 与 output Track identity 在单个房间媒体会话内保持稳定
- 旧命名和旧 schema 不出现在运行时代码或协议中
