# Music Room

Music Room 是一个以 Web 为首发平台的音乐房项目。服务端负责游客身份、房间、歌单、播放状态和 WebSocket/WebRTC 信令；音频文件只保留在客户端，目标是尽量通过客户端之间的 P2P 网络分发，而不是占用服务端带宽。

## 当前状态

- 已完成：Monorepo、前后端可运行骨架、房间/队列/播放器/歌单 MVP、Prisma 持久化降级模式、Redis 广播、Docker 部署。
- 已落地：房间恢复、Redis 最近活跃房间索引、Redis 房间注册表恢复、IndexedDB 本地缓存恢复、DataChannel chunk 传输 PoC、chunk hash 校验、当前曲目优先拉取和下一首预取、socket 自动重连重订阅。
- 未完成：完整 WebRTC 分片调度、TURN/NAT 兜底、协作歌单、E2E、观测告警、生产级重连补偿。

详细进度见 [status.md](/e:/code/music_room/docs/engineering/status.md) 和 [roadmap.md](/e:/code/music_room/docs/engineering/roadmap.md)。

## 已实现能力

- 游客身份创建。
- 房主建房、通过房间码加入、离开房间、恢复最近房间。
- 本地音频导入并注册为房间曲目元数据。
- 共享队列：加歌、删歌、切歌。
- 基础播放器：播放、暂停、下一首、seek。
- 房主 transport 权限控制。
- 歌单：从当前队列保存、重命名、删除、重新导入房间。
- WebSocket 房间订阅与 `room.snapshot` 广播。
- Redis 跨实例房间快照广播。
- Redis 最近活跃房间恢复与 `GET /v1/rooms/{roomId}/recover` 定向恢复。
- IndexedDB 整曲缓存、分片缓存、刷新后恢复。
- 分片可用性广播、P2P 状态面板、DataChannel chunk 请求/接收 PoC。
- chunk hash 校验与整曲 hash 校验后再恢复为可播放文件。
- 当前曲目优先拉取与下一首预取。
- socket 自动重连与房间自动重订阅。
- PostgreSQL/Prisma 持久化，可在无数据库时降级为内存模式。
- Docker Compose 本地部署。
- 服务端单测与前端 P2P 纯逻辑测试。

## 近期高优先级

- 完整分片重组、校验、重试和 peer 调度。
- 更稳的 Redis 房间状态恢复与重连补偿。
- 前端组件测试和 E2E 主流程。
- 观测、错误追踪和部署收口。

## 技术栈

- `apps/web`: Next.js 15 + React + TypeScript + Tailwind CSS
- `apps/server`: NestJS + Prisma + PostgreSQL + Redis + Socket.IO Gateway
- `packages/shared`: 共享 schema、类型、事件模型
- `Monorepo`: pnpm workspace + Turborepo

## 本地启动

1. 安装 Node.js `22.x` 和 pnpm `10.x`
2. 复制 `.env.example` 为 `.env`
3. 安装依赖：`npx pnpm install`
4. 启动开发环境：`npx pnpm dev`

启动后默认访问：

- Web: `http://localhost:3000`
- Server Health: `http://localhost:3001/health`

## 质量检查

- 类型检查：`npx pnpm typecheck`
- 构建：`npx pnpm build`
- 测试：`npx pnpm test`

当前这三项均已通过。

## Docker 部署

1. 确保本机已安装 Docker 和 Docker Compose
2. 在仓库根目录执行：`docker compose up --build`
3. 访问：
   - Web: `http://localhost:3000`
   - Server Health: `http://localhost:3001/health`

Compose 会启动：

- `web`: Next.js 前端
- `server`: NestJS API 与 WebSocket 服务
- `postgres`: PostgreSQL 16
- `redis`: Redis 7

服务端容器启动时会先执行 `prisma db push`，再启动 API。

## Linux 服务器部署

仓库已经内置 Linux 服务器部署目录：

- [docker-compose.prod.yml](/e:/code/music_room/deploy/linux/docker-compose.prod.yml)
- [music-room.conf](/e:/code/music_room/deploy/linux/nginx/music-room.conf)
- [.env.production.example](/e:/code/music_room/deploy/linux/.env.production.example)

基本步骤：

1. 把仓库拉到 Linux 服务器
2. 复制 `deploy/linux/.env.production.example` 为 `deploy/linux/.env.production`
3. 修改域名、数据库密码、JWT_SECRET
4. 执行：`npx pnpm deploy:linux`

这条路径默认使用 `Nginx + web + server + postgres + redis` 的生产编排。

## 数据持久化

- 未配置 `DATABASE_URL` 时：以内存模式运行，适合本地开发和演示。
- 配置 `DATABASE_URL` 后：游客会话、房间快照和歌单会持久化到 PostgreSQL。
- 手动同步 schema：`npx pnpm --filter @music-room/server db:push`

## 仓库结构

```text
apps/
  web/        Next.js 客户端
  server/     NestJS API 与 WebSocket 服务
packages/
  shared/     前后端共享 schema 与类型
  config-*/   共享工程配置
docs/
  product/        产品说明
  architecture/   架构设计
  api/            接口与事件协议
  engineering/    开发、测试、路线图、状态
  deployment/     部署与运维说明
```

## 关键文档

- [status.md](/e:/code/music_room/docs/engineering/status.md)
- [roadmap.md](/e:/code/music_room/docs/engineering/roadmap.md)
- [rest.md](/e:/code/music_room/docs/api/rest.md)
- [websocket-events.md](/e:/code/music_room/docs/api/websocket-events.md)
- [overview.md](/e:/code/music_room/docs/architecture/overview.md)
- [deployment.md](/e:/code/music_room/docs/deployment/deployment.md)
