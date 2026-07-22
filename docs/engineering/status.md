# 项目状态

最后更新：`2026-07-23`
当前版本：`0.2.8`

## 当前主链路

- 账号、房间、队列和播放控制可用
- 用户上传阶段在浏览器本地生成原始资产和分段 Opus 播放资产
- IndexedDB 保存当前用户自己上传或 provider 导入的歌曲及其本地资产
- `SegmentedOpusEngine` 使用固定的共享 AudioContext 输出总线
- 源端通过 `MediaStreamAudioDestinationNode` 发布 RTP Opus
- 监听端只使用一个 `audio.srcObject`
- `music-room-control` DataChannel 只用于控制和连接健康协调
- 诊断协议使用 `segmentedPlaybackStatus`

## 当前产品面

- `/` 是产品展示页，`/app` 是房间大厅和工作区
- `/app/search` 支持已启用的网易云/QQ 音乐 provider 搜索、专辑和歌单浏览
- `/app/playlists`、`/app/favorites`、`/app/profile` 和 `/app/settings` 已接入同一响应式工作区
- 房间工作区为 `曲库`、`我的歌单`、`成员`；共享队列由房间舞台和全局播放器管理
- 暂离房间会保留实时成员关系，用户可从大厅恢复原房间

## 稳定性措施

- sync single-flight 和 timeline generation 防止旧异步结果污染新时间线
- unit 读取、解码和调度去重
- 20ms source fade、欠载静音门和 limiter 降低 click/pop 与削波风险
- 本地音量和监听端恢复均采用平滑操作
- 房间快照、成员变化、presence 和音量变化不会重建媒体会话
- 暂停、缺片和解码等待不调用 `replaceTrack(null)`
- 只有媒体会话变化时才替换/释放 output Track 或重新绑定远端 `srcObject`
- provider 临时音频导入先写入 IndexedDB，再异步同步到已配置的本地目录
- 本地播放资产 fallback 校验来源文件 hash、首尾分片索引和 payload 长度，避免选择截断资产

## 已完成

- 旧 PCM、MSE、FLAC progressive 播放链路、旧 playback orchestrator、旧 source controller 和旧 fallback 已移除
- FLAC parser、metadata、frame index 和上传阶段 PCM 工具仍保留在非播放模块
- 房间缓存下载、手动缓存、P2P 资产分片传输和 availability 广播已移除
- shared 诊断 schema 已切换为中性分段播放模型
- 房间 UI 已稳定为 `Library / My Playlists / Members`，Queue 由房间舞台和播放器承载
- 成员权限、provider 账号/搜索/导入、收藏专辑、主题设置和暂离房间恢复已接入当前 Web 工作区

## 后续风险

- 仍需在 CI 中持续运行双 Chromium context 的长时间 WebRTC 播放回归
- 需要采集真实设备上的 limiter peak、RMS、瞬时跃变和欠载恢复数据
- TURN 配置异常时跨网络媒体仍可能进入 `reconnecting`，但不应改变播放链路设计
- 曲目拥有者离线时服务端暂停播放；其他成员无法从服务端或其他成员获得该曲目的替代音频源。播放控制仅房主可写；队列 next 不循环并会跳过 owner 离线曲目。服务端 watchdog 会在曲目超时未切歌时自动推进。
- 当前正式部署仍限制为单个 `server` 实例；多实例房间权威和事件顺序尚未完成生产验证
- 外部 provider 受上游登录态、接口、版权和可用音质影响，不是本地曲库的可靠替代
