# Music Room

Music Room 是一个以 Web 为首发平台的音乐房项目。  
它的目标不是把音频流量压到服务端，而是让服务端只负责房间、游客身份、歌单、播放状态和 WebSocket/WebRTC 信令；音频文件尽量保留在客户端，通过客户端之间的实时音频和 P2P 缓存能力完成共享聆听。

当前仓库已经不是纯规划骨架，而是一套可运行的 MVP：
- 支持游客昵称、建房、加房、房间恢复
- 支持本地音频导入、共享播放队列、房主播放控制
- 支持房主向成员发送 WebRTC 实时音频
- 支持歌单保存与重新导入房间
- 支持 IndexedDB 本地缓存与 DataChannel 分片缓存辅助链路
- 支持 PostgreSQL / Redis / Docker / Linux Docker 部署

## 当前状态

当前版本定位是 `可运行的多人音乐房 MVP`，而不是全部能力已经产品化完成的正式版。

已落地：
- Monorepo、前后端可运行骨架
- 游客身份和基于 `x-session-token` 的会话校验
- 房间创建、房间码加入、离开房间、删除房间、最近房间恢复
- 本地音频导入、曲库注册、共享队列、房主播放控制
- 房主向成员发送 WebRTC 实时音频
- 底部播放器、播放进度、右侧队列抽屉
- 歌单保存、重命名、删除、重新导入房间
- Redis 房间快照广播与最近活跃房间恢复
- IndexedDB 整曲缓存、分片缓存、刷新后恢复
- Docker 本地部署与 Linux Docker 部署模板

仍在持续完善：
- 更强的 WebRTC 容错与 TURN 生产调优
- 更完整的前端交互测试和 E2E
- 更细的观测、告警、运维面板
- 更完善的协作歌单与公共房间体验

详细进度见：
- [status.md](/e:/code/music_room/docs/engineering/status.md)
- [roadmap.md](/e:/code/music_room/docs/engineering/roadmap.md)

## 核心能力

### 房间与身份
- 游客身份创建与恢复
- 输入昵称后创建公开房间
- 通过房间码加入已有房间
- 大厅展示公开房间列表
- 房主离开后自动转移房主权
- 房主可删除房间

### 播放与同步
- 房主控制播放、暂停、上一首、下一首、拖动进度
- 底部播放器展示当前歌曲、进度条、音量和播放状态
- 成员端同步房间权威播放状态
- 房主通过 WebRTC 实时音频流向成员发送当前音频
- 成员优先收听房主实时音频，而不是等待整首下载完再播

### 曲库、队列、歌单
- 本地音频导入并注册为房间曲目
- 曲目可直接入队或由房主立即播放
- 播放队列支持房主直接点播和拖拽改序
- 歌单支持从当前队列保存、重命名、删除、导回房间

### 客户端缓存与 P2P 辅助
- IndexedDB 整曲缓存
- DataChannel 分片缓存与可用性广播
- 刷新页面后本地缓存恢复
- 分片 hash 校验和整曲 hash 校验

## 技术栈

- `apps/web`: Next.js 15 + React 19 + TypeScript
- `apps/server`: NestJS + Prisma + PostgreSQL + Redis + Socket.IO
- `packages/shared`: 前后端共享 schema / 类型 / 事件协议
- `Monorepo`: pnpm workspace + Turborepo
- `Realtime`: Socket.IO + WebRTC
- `Client Cache`: IndexedDB

## 快速开始

### 环境要求

- Node.js `22.x`
- pnpm `10.x`
- 可选：PostgreSQL、Redis
- 可选：Docker / Docker Compose

### 本地开发

1. 复制环境变量文件

```bash
cp .env.example .env
```

2. 安装依赖

```bash
npx pnpm install
```

3. 启动开发环境

```bash
npx pnpm dev
```

启动后默认地址：
- Web: `http://localhost:3000`
- Server Health: `http://localhost:3001/health`

### 常用命令

```bash
npx pnpm typecheck
npx pnpm test
npx pnpm build
```

按应用单独执行：

```bash
npx pnpm --filter @music-room/web dev
npx pnpm --filter @music-room/server dev
```

## 环境变量

最常用的一组如下，完整示例见 [`.env.example`](/e:/code/music_room/.env.example)。

```env
JWT_SECRET=your-secret
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001
NEXT_PUBLIC_SOCKET_PATH=/ws/socket.io
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

说明：
- `DATABASE_URL` 未配置时，服务端会降级到内存模式，适合本地开发
- `REDIS_URL` 未配置时，Redis 相关能力会降级
- 生产环境建议同时配置 `STUN/TURN` 相关变量

## 本地 Docker 部署

仓库根目录已经提供 `docker-compose.yml`、`Dockerfile.web`、`Dockerfile.server`。

1. 复制环境变量

```bash
cp .env.example .env
```

2. 启动

```bash
docker compose up --build
```

后台运行：

```bash
docker compose up --build -d
```

日志查看：

```bash
docker compose logs -f
```

停止：

```bash
docker compose down
```

Compose 默认会启动：
- `web`
- `server`
- `postgres`
- `redis`

服务端容器启动时会自动执行 `prisma migrate deploy`。

## Linux Docker 部署

Linux 生产部署模板位于：
- [docker-compose.prod.yml](/e:/code/music_room/deploy/linux/docker-compose.prod.yml)
- [music-room.conf](/e:/code/music_room/deploy/linux/nginx/music-room.conf)
- [.env.production.example](/e:/code/music_room/deploy/linux/.env.production.example)
- [deploy-linux.sh](/e:/code/music_room/scripts/deploy-linux.sh)

基本流程：

1. 拉取代码到 Linux 服务器
2. 复制生产环境变量

```bash
cp deploy/linux/.env.production.example deploy/linux/.env.production
```

3. 修改关键值：
- `APP_DOMAIN`
- `JWT_SECRET`
- `POSTGRES_PASSWORD`
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_WS_URL`
- `NEXT_PUBLIC_SOCKET_PATH`
- TURN 相关变量

4. 部署

```bash
npx pnpm deploy:linux
```

这条生产链默认使用：
- `nginx`
- `web`
- `server`
- `postgres`
- `redis`
- `coturn`

部署说明见：
- [deployment.md](/e:/code/music_room/docs/deployment/deployment.md)

## 数据与持久化

- 未配置 `DATABASE_URL`：以内存模式运行，适合开发和演示
- 配置 `DATABASE_URL` 后：
  - 游客会话
  - 房间快照
  - 房间成员
  - 队列
  - 播放状态
  - 歌单
  会持久化到 PostgreSQL

- 配置 `REDIS_URL` 后：
  - 房间快照广播
  - 最近活跃房间恢复
  - 房间注册表恢复
  会进入运行路径

## 测试与质量检查

项目当前已接入：
- Server Jest 单元测试
- Web Vitest 测试
- Shared Vitest 测试
- 全仓 `typecheck`
- 全仓 `build`

常用命令：

```bash
npx pnpm test
npx pnpm typecheck
npx pnpm build
```

## 仓库结构

```text
apps/
  web/        Next.js 前端
  server/     NestJS API + Socket.IO + Prisma
packages/
  shared/     前后端共享 schema / 类型 / 事件
  config-*/   工程共享配置
docs/
  product/        产品文档
  architecture/   架构设计
  api/            REST / WebSocket 协议
  engineering/    开发、测试、路线图、状态
  deployment/     部署与运维说明
deploy/
  linux/          Linux Docker 部署模板
scripts/
  deploy-check.mjs
  deploy-linux.sh
```

## 已知边界

- 当前产品优先支持 `2-8 人` 的实时同听场景
- 房间实时音频依赖浏览器的 WebRTC 能力，生产环境建议启用 TURN
- 成员端以收听为主，房主控制播放
- 大厅公开房间列表当前走前端轮询，不是大厅级 websocket 广播
- 客户端缓存和 DataChannel 分片链路当前是辅助能力，不是实时同听主链路

## 文档导航

- 产品目标：[vision.md](/e:/code/music_room/docs/product/vision.md)
- 房间流程：[room-flow.md](/e:/code/music_room/docs/product/room-flow.md)
- 架构总览：[overview.md](/e:/code/music_room/docs/architecture/overview.md)
- 实时与信令：[realtime.md](/e:/code/music_room/docs/architecture/realtime.md)
- P2P 分发：[p2p-distribution.md](/e:/code/music_room/docs/architecture/p2p-distribution.md)
- 播放同步：[playback-sync.md](/e:/code/music_room/docs/architecture/playback-sync.md)
- REST 接口：[rest.md](/e:/code/music_room/docs/api/rest.md)
- WebSocket 事件：[websocket-events.md](/e:/code/music_room/docs/api/websocket-events.md)
- 开发规范：[conventions.md](/e:/code/music_room/docs/engineering/conventions.md)
- 本地环境：[setup.md](/e:/code/music_room/docs/engineering/setup.md)
- 测试策略：[testing.md](/e:/code/music_room/docs/engineering/testing.md)
- 项目状态：[status.md](/e:/code/music_room/docs/engineering/status.md)

## 当前建议

如果你是第一次接手这个仓库，推荐阅读顺序：

1. 本 README
2. [status.md](/e:/code/music_room/docs/engineering/status.md)
3. [overview.md](/e:/code/music_room/docs/architecture/overview.md)
4. [rest.md](/e:/code/music_room/docs/api/rest.md)
5. [websocket-events.md](/e:/code/music_room/docs/api/websocket-events.md)

这样可以最快理解当前系统边界、现状和下一步实现方向。
