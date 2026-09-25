# 项目状态

最后更新：`2026-09-24`
当前版本：`0.3.3`

## 当前主链路

- 账号、房间、队列和播放控制可用
- 用户上传阶段在浏览器本地生成原始资产和分段 Opus 播放资产
- IndexedDB 保存当前用户自己上传或 provider 导入的歌曲及其本地资产
- `SegmentedOpusEngine` 使用固定的共享 AudioContext 输出总线
- 源端通过 `SegmentedOpusEngine` + shared AudioContext + broadcastDestination 发布 RTP Opus（owner 是唯一媒体源）
- 监听端只使用一个 `audio.srcObject`
- `music-room-control` DataChannel 只用于控制和连接健康协调
- 诊断协议使用 `segmentedPlaybackStatus`

## 当前产品面

- `/` 是产品展示页，已完成工程级重构：直观呈现四阶段声学数据流架构、三大房间模式对比与本地一键自建指南
- `/app` 是房间大厅和工作区，顶部通知栏默认极简纯铃铛图标，有未读公告时通过 `100cqw` 驱动单条由右向左平稳循环跑马灯，点击呼出结构清爽的公告中心弹窗
- `/app/search` 支持网易云音乐、QQ 音乐与 B 站（哔哩哔哩）跨平台搜索、分 P 浏览、直接播放与曲库导入
- `/app/playlists`、`/app/favorites`、`/app/profile` 和 `/app/settings` 已接入同一响应式工作区
- `/app/profile` 个人页为「听歌画像 / 房间足迹 / 平台账号」三个 Tab：画像页以口味标签（点击开启对应偏好漫游电台）为第一区块，辅以最常播放、常听歌手与音源分布；头部身份卡展示口味摘要、累计收听统计与播放中的“正在收听”信号
- 屏蔽与负反馈并入画像页底部的折叠入口；纯设置项（通用、播放策略、界面、播放、通知与推送、隐私与数据、账号）在独立路由 `/app/settings`，从个人页头部齿轮进入
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
- 个人页完成身份卡重构：听歌画像 / 房间足迹 / 平台账号三 Tab、口味标签漫游入口、正在收听信号、独立设置路由 `/app/settings`
- UI 渲染性能加固：播放进度拆分独立 Context 订阅、移除播放器 30fps 空转重渲染、工作区路由缓存 LRU 淘汰、削减大面积 backdrop-filter、桌面歌词改为 rAF 命令式渲染并节流跨窗口桥接（详见 optimization.md）
- **B 站（哔哩哔哩）音乐全链路接入**：搜索、分 P 取流、WBI 签名、CDN 探测故障转移、导入本地曲库与 Alist 存储对接
- **全面落实 Anti-AI-Slop 收敛克制设计规范**：全局根除 `--accent-glow` 与发光阴影类；移除卡片/按钮/分段控制器外发光；重构房间舞台几何声波与同心电波曲线；房间编辑菜单与交互弹窗采用 100% 实体高对比表面杜绝透底干扰；修复歌词译文高亮分离
- **产品说明落地页（`/`）工程级重构**：去除营销套话与假拟物组件，展现真实声学链路、房间矩阵与自建指南
- **顶部系统通知与公告中心重构**：默认极简铃铛图标、CSS 容器查询驱动单条从最右侧循环跑马灯与收敛克制公告中心弹窗
- **多人听歌完整解决方案（第一至第四阶段全部落地）**：
  - 第一阶段：统一准入原则构建。房间曲目播放只认源成员分发的本地歌曲资产；彻底移除监听端本地偷跑播放第三方源的单机分支；源成员离线或资产缺失时房间统一暂停；全端上线 8px 微型指示点状态徽标（`TrackDistributionBadge`）。
  - 第二阶段：自动准备资产（Automatic Asset Preparation）。源成员在线时，客户端引擎按优先级（本地文件 -> 本地缓存 -> IndexedDB -> 第三方下载）提取音频源，严格重算真实文件哈希，转码生成分段 Opus 资产写入 IndexedDB，并通过 `POST /rooms/:roomId/tracks/:trackId/asset` 登记至房间曲目；若房间正在等待该曲目，服务端自动启动统一时钟唤醒全房间同步收听；队列前 2 首在后台自动静默预准备。
  - 第三阶段：资产失效检测与异常状态降级（Disruption & Recovery）。建立客户端分段完整性校验（`verifyPlaybackAssetIntegrity`）与源文件丢失/权限失效检测；源成员主动上报不可用（`POST /rooms/:roomId/tracks/:trackId/asset/unavailable`），服务端针对当前播放曲目立即原子化暂停并自增 `mediaEpoch` 与广播通知；队列曲目失效保留元数据不破坏队列；在 `TrackDistributionBadge` 中为源成员提供精准文案（“权限受限”、“资产损坏”、“音频源缺失”）与一键操作（“重试准备”、“选择本地文件”恢复）。
  - 第四阶段：清理旧逻辑与体验打磨（Cleanup & Polish）。清理所有旧残留的第三方临时单机播放分支、冗余参数与过时兼容层；透传 `roomId` 至所有播放器布局与队列抽屉；完成全套单元测试与端到端类型校验。

## 后续风险

- 仍需在 CI 中持续运行双 Chromium context 的长时间 WebRTC 播放回归
- 需要采集真实设备上的 limiter peak、RMS、瞬时跃变和欠载恢复数据
- TURN 配置异常时跨网络媒体仍可能进入 `reconnecting`，但不应改变播放链路设计
- 多人听歌只认源成员分发的本地歌曲资产：源成员离线或资产未就绪时房间统一暂停，严禁各端偷跑播放；源成员上线后自动准备并恢复时钟。有 `player` 权限的成员可控制播放（默认 true）；房主拥有全部权限。服务端 watchdog 会在曲目超时未切歌时自动推进。
- 当前正式部署仍限制为单个 `server` 实例；多实例房间权威和事件顺序尚未完成生产验证
- 外部 provider 受上游登录态、接口、版权和可用音质影响，不是本地曲库的可靠替代



