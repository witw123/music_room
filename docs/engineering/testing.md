# 测试策略

最后更新：`2026-04-17`

## 当前状态

- 当前仓库共有 `52` 个 `*.test.ts` / `*.spec.ts` 文件
- 已覆盖：
  - `packages/shared` 协议、模型与事件约束
  - `apps/server` 的认证、房间、队列、播放、实时、信令、Redis 配置等核心模块
  - `apps/web` 的房间运行时、P2P 调度、播放引擎、上传工具、API/客户端桥接，以及部分组件 / Hook
- 仍未覆盖：
  - 浏览器级 E2E 主流程
  - 真实 WebRTC 多端联调
  - IndexedDB / MediaSource / AudioContext 的集成级回归
  - 桌面端 / Android 壳的打包后 smoke test

## 已落地测试

## 1. shared

- 房间、会话、事件和共享模型约束测试

## 2. server

已覆盖：

- 注册、登录、会话查询
- 所有房间成员都可控制播放
- 仅房主或点歌人可删除队列项
- 房主离房后保留离线 host 身份，不自动转移
- 房间无人在线时仍可恢复，只有房主主动删除才销毁
- 歌单重新导回房间队列
- 最近活跃房间恢复
- 房间码加入后的快照广播
- 房间删除后的离房分支
- WebSocket 订阅时立即回推快照
- 缺失房间时回推 `room.snapshot.missing`
- Redis 远端实例快照转发
- Socket 信令网关基础行为
- 播放控制器、队列控制器、实时 ICE 配置服务
- Redis 运行时配置解析

## 待补测试

## 1. 服务端集成测试

- 基于真实 Nest 应用启动的 REST / WebSocket 集成回归
- Prisma、Redis 接入下的端到端房间恢复
- 多实例广播去重和服务重启补偿

## 2. WebSocket 测试

- `room.subscribe`
- `room.unsubscribe`
- `room.snapshot`
- Redis 跨实例广播不重复回放

## 3. 前端测试

- `已完成`
  - P2P 缺块选择、连接监督、可用性汇总、传输健康
  - 分片 hash 校验和整曲重组校验
  - 房间状态归并、重同步和运行时 Hook
  - 播放同步、激活策略、MSE / PCM / FLAC 渐进式播放
  - API 客户端、WebSocket 客户端、客户端入口与底部播放器局部组件
- `未完成`
  - 跨浏览器交互级播放器测试
  - 房间页完整工作流测试
  - 歌单工作流回归
  - 手动缓存下载与 IndexedDB 集成测试

## 4. E2E

- 注册 / 登录
- 创建房间
- 导入曲目
- 加歌、播放、seek
- 保存歌单并导回房间
- 第二位成员通过房间码加入

## 5. P2P 专项测试

- WebRTC 建链成功率
- DataChannel 分片收发
- IndexedDB 缓存命中
- 弱网重试
- Media 实时流和本地缓存切换

## 最近测试优先级

1. 浏览器级 E2E 主流程测试
2. 真实 WebRTC / Media 集成测试
3. 服务端多实例与恢复链路集成测试
4. 缓存工作流与 IndexedDB 集成测试
