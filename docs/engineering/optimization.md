# 工程优化重点

最后更新：`2026-09-13`
当前版本：`0.3.2`

这份文档只记录当前单一 Segmented Opus/WebRTC 链路仍有现实意义的优化方向。旧的 P2P 资产缓存、分片下载调度和 progressive 播放优化已不再适用。

## 当前结论

项目已经从“先把链路跑通”进入“围绕稳态、测试和可运维性继续加固”的阶段。优化优先级如下：

1. Realtime 与媒体恢复稳态
2. 浏览器级长时间测试
3. 音频质量和可观测性
4. 部署与发布可靠性

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

1. 先补媒体会话 identity 和 source owner 离线回归
2. 再补弱网、TURN、ICE restart 和长时间双浏览器测试
3. 再接入 limiter/underrun/RTP 指标告警
4. 最后处理产品层的歌单入口和权限细化


