# 工程优化重点

最后更新：`2026-09-19`
当前版本：`0.3.3`（含未发布优化）

这份文档只记录当前单一 Segmented Opus/WebRTC 链路仍有现实意义的优化方向。旧的 P2P 资产缓存、分片下载调度和 progressive 播放优化已不再适用。

## 当前结论

当前软件端优先减少实际发生的后台工作，不重复堆叠渲染 memo，也不把所有保活组件直接认定为卡顿来源。近期优先级如下：

1. 隐藏页面的数据刷新与推荐计算生命周期
2. 随页面改动逐步接管服务端缓存，保持播放与本地资产边界
3. 按实际问题处理搜索、封面补全等剩余任务
4. 先明确客户端产品目标，再决定原生播放投入

下方媒体稳态与长时间测试条目保留为后续专项清单，不作为每轮软件优化的必跑门槛。

## 已完成：后台任务与数据缓存（2026-09-19，未发布）

代码检查确认三个活动源：房间目录每 10 秒轮询只检查文档可见性；发现页响应画像变更重新生成推荐；画像及屏蔽记录在页面隐藏后仍响应变更请求数据。这些是可确认的无效工作，尚未通过性能采样证明它们是卡顿主因。

- 保留现有 6 页 LRU 与组件状态，通过路由活动 Context 和文档可见性控制上述任务。
- 房间目录、服务端画像、屏蔽记录接入已安装的 TanStack Query；删除房间 Map 和画像模块级请求缓存。Query 按账号隔离，画像多消费者共享请求。
- 隐藏时禁用相关 Query 并取消没有活动消费者的在途请求；画像变更只使隐藏查询过期，返回时按新鲜度加载。房间轮询仅在可见时运行。
- 发现推荐仍在客户端生成，不搬入服务端数据缓存；隐藏后停止变更驱动的计算，取消推荐依赖的网络请求，返回时使用有效缓存或重新生成。不可取消的本地读取可能完成，但不再继续生成推荐。
- 播放运行时、队列预取、音频资产与听歌上报不受页面可见性控制。
- 验证：4 个新增定向用例覆盖共享查询、隐藏失效后恢复、请求取消与推荐中止；另跑 4 个播放归属用例。不据此声称帧率或耗电已得到量化改善。

尚未统一迁移歌单混合缓存、收藏专辑和平台账号缓存；后续修改这些页面时再逐项接管服务端部分。搜索建议、封面补全及其他隐藏子视图可继续按实际触发情况检查，不做全站停工式重构。

## 客户端壳边界

### 存储实现更新（2026-09-19）

已统一根目录：桌面安装目录、Android `filesDir`、网页显式选择目录。
新增原生受限文件读写，移除自动 OPFS 根目录；这不改变客户端仍加载远程网页、
音频仍由页面播放的事实。存储实现不等于离线启动或原生后台播放器。
设置与歌单读取不自动扫描目录；容量使用索引与定向遍历，扫描增量写入，
清理批量更新且保护仍被引用的资产。详见 `docs/architecture/local-storage.md`。

仍未修改 Tauri / Capacitor 的远程网页配置和 Android 媒体服务。应用级 Web 播放器常驻不等于独立原生播放生命周期。

- 在线共听客户端：沿用 Web 复用，优先启动、返回导航与后台控制的实际体验。
- 日常播放器，要求长期后台播放及离线启动：需要单独确定本地应用资源与独立于页面的播放生命周期，不能靠增加页面保活解决。

## 已完成：UI 渲染层性能（2026-09）

2026-09 完成了一轮针对播放期间全端 UI 重渲染与合成开销的加固（桌面端与移动端复用 Web 前端，收益覆盖三端）：

- 播放进度 `progressMs` 拆分出主播放器 Context，页面级消费者不再以 4Hz 全树重渲染；仅持久播放条通过独立 Progress Context 订阅
- 移除无人消费的 `visualizerSamples` prop 链，修复 BottomPlayer `React.memo` 被每 tick 新数组引用击穿的问题（播放器子树 30fps→0 空转重渲染）；采样数据仍经 `audioVisualizerStore` 供 canvas 消费者使用
- 工作区路由持久化缓存加 LRU 淘汰（上限 6），隐藏页面不再随导航无限累积
- 削减大面积实时 `backdrop-filter`（底部播放条、顶栏、移动端导航栏、房间卡徽章改近实色；`.workspace-surface` 磨砂卡保留）
- 桌面歌词改为 rAF 命令式 DOM 更新：逐字填充用 CSS 变量 `--word-fill`，滚动偏移与时间文本直接写 DOM，透明置顶窗口不再每帧 React reconcile；BroadcastChannel 与 Android 原生桥接节流至 250ms，歌词对齐 memo 化
- Android 桌面歌词 overlay 降至 ~30fps，无歌词时停止重绘
- 缓冲/barrier 时钟 100ms→250ms；分段播放引擎快照内容不变时跳过提交
- `pulseRadialWave` 房间卡动画改 transform 缩放（非 SVG 几何属性）；侧栏移除无效 `will-change: width`

后续可选的低优先级方向：长列表（搜索结果、队列、房间目录）虚拟化、`transition-all` 收敛为具体属性、DiscoverIcons 批量 memo（当前触发源已消除，收益有限）。

## P0：媒体会话稳定性

- 保证普通 `RoomSnapshot`、presence、成员变化和音量变化不重建媒体会话
- 保证 destination、output Track 和 listener `srcObject` 在同一会话内保持 identity
- 验证切歌、seek、source peer 切换只按 session key/media epoch 触发媒体变更
- 持续覆盖 underrun fade-out/fade-in、source fade、limiter 和 AudioParam ramp
- 采集 limiter 前后 peak、RMS、最大瞬时跃变，区分削波、click/pop 和持续噪声
- 对 IndexedDB 读取/解码延迟、旧 generation 丢弃和重复 unit 调度做压力测试

## P0：Realtime 与恢复

- 稳定 `room.subscribe`、`room.presence`、`room.unsubscribe` 的断线边界
- 验证 duplicate session replacement 不污染当前媒体会话
- 验证 `peer.signal` 的 recovery generation、媒体协商和 ICE restart
- source owner 离线暂停语义已落地（清 startAt/sourcePeerId + mediaEpoch）；继续补恢复提示与双浏览器回归
- 验证单实例发布边界以及 Redis 故障时的错误反馈和状态补偿

## P1：真实浏览器测试

需要两个 Chromium context 覆盖：

- 连续播放 30 分钟
- 成员加入/离开、presence 更新和普通房间快照刷新
- 播放、暂停、seek、切歌和快速音量变化
- 缺片、解码延迟、RTP 丢包和媒体连接恢复
- 远端 `srcObject` 不被反复清空
- 非重连期间 `remoteTrackId` 不变化
- `currentTime` 持续推进，limiter 后 peak 不超过 0dBFS

## P1：网络与音频观测

- 服务端聚合 Redis、数据库、信令和 ICE 失败
- 客户端记录 AudioContext 状态、buffer ahead、underrun、RTP bitrate、jitter 和 packet loss
- 将 `sourcePeerId`、`mediaSessionKey`、`outputTrackId` 和 `remoteTrackId` 放入同一诊断上下文
- 发布后执行 `/health`、`/health/readiness`、ICE 配置和双浏览器 smoke check

## 当前建议顺序

1. 用实际导航与网络记录确认隐藏任务是否收敛，优先修复仍持续工作的具体链路
2. 后续修改歌单、收藏和账号页面时，迁移对应服务端缓存并删除旧实现
3. 明确在线共听客户端或日常播放器目标，再安排原生投入
4. 媒体专项回归、弱网长测和指标告警随实际稳定性问题推进
