# 路线图

最后更新：`2026-04-17`

## Phase 0: Foundation

状态：`已完成`

- [x] Monorepo、pnpm workspace、Turborepo
- [x] Web 前端和 Server 服务端基础工程
- [x] 共享 schema 和类型包
- [x] Docker Compose、本地 PostgreSQL、Redis
- [x] README 和基础工程文档

## Phase 1: MVP 闭环

状态：`已完成`

- [x] 账号注册 / 登录 / 登出
- [x] 房主建房
- [x] 按房间码加入
- [x] 最近活跃房间恢复
- [x] 按房间恢复接口
- [x] 官网 `/` 与客户端入口 `/app` 分流
- [x] 本地曲目导入
- [x] 房间共享队列
- [x] 播放/暂停/下一首/seek
- [x] 房主播放控制权限
- [x] 歌单保存
- [x] 歌单重命名和删除
- [x] 歌单重新导入房间
- [x] WebSocket 房间快照广播
- [x] WebSocket 订阅后立即下发当前快照
- [x] IndexedDB 本地曲目缓存与刷新恢复
- [x] 分片可用性广播和前端 P2P 状态面板
- [x] WebRTC DataChannel chunk 请求/接收 PoC
- [x] chunk hash 校验和整曲 hash 校验
- [x] 当前曲目优先拉取和下一首预取
- [x] socket 自动重连和房间重订阅
- [x] 房间默认工作区收敛为 `共享队列 / 曲库 / 缓存 / 成员`
- [ ] 更细粒度的播放时钟同步
- [ ] 完整的错误码和错误提示体系

## Phase 2: Persistence And Realtime Hardening

状态：`进行中`

- [x] Prisma 持久化接入
- [x] 无数据库降级模式
- [x] Redis 广播接入
- [x] Redis 最近活跃房间索引
- [x] Redis 房间注册表恢复
- [x] 订阅后房间快照即时下发
- [x] 基础重连与房间重订阅
- [x] 房间服务关键测试
- [x] 房间控制器和网关测试
- [x] 房间实时回归测试
- [ ] Redis 房间状态快照加强
- [ ] 服务端重启后的完整房间恢复
- [ ] 多实例下更稳的事件分发
- [ ] 重连恢复与状态补偿

## Phase 3: P2P Media Delivery

状态：`进行中`

- [x] WebRTC DataChannel 建链 PoC
- [x] 分片可用性广播
- [x] 当前曲目优先拉取
- [x] 下一首预取
- [x] IndexedDB 分片缓存基础能力
- [x] 二进制分片通道
- [x] 手动缓存下载与缓存回库
- [x] MP3 渐进式本地播放
- [x] FLAC 渐进式本地播放
- [x] 完整分片重组与 hash 校验
- [x] 成员诊断与传输健康视图
- [ ] 成员互传调度优化
- [ ] 下载失败重试与 peer 切换
- [ ] 弱网与 NAT/TURN 稳态策略

## Phase 4: Product Hardening

状态：`进行中`

- [x] 桌面端迁移到 Tauri 2
- [x] Android 壳与 APK 打包链路
- [x] 客户端打包强制校验 `MUSIC_ROOM_PUBLIC_ORIGIN`
- [x] 部分前端组件 / Hook / 播放引擎测试
- [ ] 协作歌单前端回归
- [ ] 更完整的成员权限模型
- [ ] 操作审计和房间事件历史
- [ ] 观测指标和错误追踪
- [ ] E2E 自动化测试
- [ ] 上线部署手册收口

## 最近两轮必须做的事

1. 把 Redis 从“恢复索引”推进到“更稳的状态恢复 + 重连补偿”。
2. 补 DataChannel / Media 在弱网下的重试、peer 切换和稳态调度。
3. 补浏览器级交互测试和 E2E，覆盖登录、进房、切歌、重连与缓存工作流。
