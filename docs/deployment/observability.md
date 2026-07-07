# 可观测性

最后更新：`2026-07-07`
当前版本：`0.2.8`

## 当前状态

项目当前已经有基础排障能力，但还没有形成完整的 metrics / tracing / error reporting 体系。

现阶段真正可用的观测入口主要有三类：

- 服务端日志
- 健康检查接口
- 房间内“成员与诊断”面板

## 已有观测入口

### 1. 服务端日志

当前服务端已经在这些链路上输出较明确的运行信息：

- 认证接受 / 拒绝 / 限流
- 播放控制接受 / 拒绝 / 版本冲突 / 限流
- TURN 配置降级告警

当前更适合把日志当成排障事实源；告警源需要依赖后续统一监控建设。

### 2. 健康检查

当前接口：

- `GET /health`
- `GET /health/readiness`
- `GET /metrics`

`/health/readiness` 当前会直接反映：

- Prisma 是否可用
- Redis 是否可用
- Redis 当前模式

`/metrics` 当前输出 Prometheus 文本格式，至少包含：

- `music_room_ws_connections`
- `music_room_active_rooms`
- `music_room_realtime_failures_total`
- `music_room_playback_conflicts_total`
- `music_room_ice_failures_total`
- `music_room_prisma_available`
- `music_room_redis_available`

### 3. 房间诊断面板

前端房间页中的“成员与诊断”已经是当前最有价值的运行时排障入口。它可以直接观察：

- Data channel 连接状态
- ICE 状态
- `offer / answer / candidate` 收发
- 当前播放源：
  - `progressive-local`
  - `full-local`
- 本地缓冲、调度策略、恢复阶段
- 最近错误和最近事件流

## 当前缺口

下面这些能力目前仍未形成完整统一方案：

- 前后端统一 tracing
- Sentry 或等价错误聚合
- 告警阈值与通知链路
- 构建、发布、运行时指标的统一看板

## 当前建议的观测重点

在现阶段，最值得先补齐的是：

1. Redis / Prisma / Server 进程可用性监控
2. Realtime 失败率和播放控制失败率
3. WebSocket 在线连接数、房间数、活跃成员数
4. `room.snapshot.missing`、`Playback state version conflict`、`Realtime sync unavailable` 的聚合统计
5. TURN / ICE 失败占比和媒体连接失败占比

## 排障优先顺序

### 房间或播放异常

先看：

1. 房间内“成员与诊断”
2. `/health/readiness`
3. Server 日志

### 多人缓存分片或 P2P 不通

优先判断：

- 是 data channel 建连失败
- 还是 provider 没有分片可用性公告
- 还是分片传输正常但本地缓存追不上

不要先从播放器 UI 样式或单个组件入手。

## 当前结论

可观测性目前属于“够排障，不够体系化”的阶段。项目已经有运行期事实来源，但距离正式生产级的统一 metrics / tracing / alerting 还差一轮工程建设。
