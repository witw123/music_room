# Music Room

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black.svg)](https://nextjs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-11-red.svg)](https://nestjs.com/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Music Room 是一个以 Web 为首发平台的音乐房项目。
它的目标不是把音频流量压到服务端，而是让服务端只负责房间、游客身份、歌单、播放状态和 WebSocket/WebRTC 信令；音频文件尽量保留在客户端，通过客户端之间的实时音频和 P2P 缓存能力完成共享聆听。

当前版本定位是 `可运行的多人音乐房 MVP`，而不是全部能力已经产品化完成的正式版。

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

**前端 (apps/web)**
- Next.js 15 + React 19 + TypeScript
- Tailwind CSS
- Zustand (状态管理)
- Socket.io Client (WebSocket)
- Dexie (IndexedDB 分片缓存)
- music-metadata-browser (音频元数据解析)

**后端 (apps/server)**
- NestJS 11
- Prisma 6 (PostgreSQL ORM)
- Redis (Pub/Sub)
- Socket.io (WebSocket 网关)

**工程基础设施**
- Monorepo: pnpm workspace + Turborepo
- Realtime: Socket.IO + WebRTC

## 快速开始

### 环境要求
- Node.js `22.x`
- pnpm `10.x`
- 可选：PostgreSQL、Redis（不配置则自动降级到内存模式）
- 可选：Docker / Docker Compose

### 启动
```bash
cp .env.example .env
pnpm install
pnpm dev
```

启动后默认地址：
- Web: `http://localhost:3000`
- Server: `http://localhost:3001`
- Health: `http://localhost:3001/health`

### 常用命令
```bash
pnpm dev          # 启动所有服务
pnpm build        # 构建
pnpm lint         # 检查
pnpm typecheck    # 类型检查
pnpm test         # 测试

# 单应用操作
pnpm --filter @music-room/web dev
pnpm --filter @music-room/server dev
pnpm --filter @music-room/server db:push  # 推送 Prisma schema
```

## 环境变量

完整示例见 [`.env.example`](.env.example)。

核心变量：
- `DATABASE_URL` — PostgreSQL（可选，不配置则内存模式）
- `REDIS_URL` — Redis（可选，不配置则降级）
- `JWT_SECRET` — 生产环境必填
- `NEXT_PUBLIC_API_BASE_URL` / `NEXT_PUBLIC_WS_URL` — 客户端访问地址
- `CORS_ORIGINS` — 白名单逗号分隔

## 部署

**本地 Docker**
```bash
cp .env.example .env
docker compose up --build -d
```

**Linux 生产部署**
```bash
cp deploy/linux/.env.production.example deploy/linux/.env.production
# 修改关键配置
pnpm deploy:linux
```

生产链包含: nginx, web, server, postgres, redis, coturn。

详见 [docs/deployment/deployment.md](docs/deployment/deployment.md)

## 数据持久化

| 配置 | 行为 |
|------|------|
| 无 DATABASE_URL | 内存模式（开发/演示） |
| 有 DATABASE_URL | PostgreSQL 持久化（会话、房间、队列、播放状态、歌单） |
| 有 REDIS_URL | Redis 广播、最近活跃房间恢复、房间注册表 |

## 仓库结构

```
music-room/
├── apps/
│   ├── web/              Next.js 前端
│   └── server/           NestJS 后端
├── packages/
│   ├── shared/           TypeScript 类型契约
│   ├── ui/               共享 UI 组件
│   └── config-*          ESLint / TypeScript 配置
├── docs/
│   ├── product/          产品文档
│   ├── architecture/     架构设计
│   ├── api/              REST / WebSocket 协议
│   ├── engineering/       开发规范、测试、状态
│   └── deployment/        部署与运维
├── deploy/linux/         Linux Docker 部署模板
└── scripts/              部署脚本
```

## 贡献指南

### 分支命名
- `feat/<简短描述>`
- `fix/<简短描述>`
- `docs/<简短描述>`
- `refactor/<简短描述>`

### 质量检查（PR 前必跑）
```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

### Prisma Schema 变更
```bash
pnpm --filter @music-room/server db:push        # 推送本地
pnpm --filter @music-room/server prisma:generate # 生成客户端
pnpm --filter @music-room/server db:migrate:deploy # 迁移
```

### 代码约定
- 共享类型放 `packages/shared/src/`，禁止 web/server 各自复制 DTO
- 领域目录用单数: `room`, `playlist`, `playback`
- WebSocket 事件名: `domain.action` (如 `room.subscribe`)
- 状态边界: 房间→`room`，播放→`player`，P2P→`p2p`
- 禁止 `any`，必须有明确理由

### PR 规范
- 小而专注的 PR 优于大型重构
- 引用相关 issue (如 "Fixes #123")
- 说明 *why* 而非仅 *what*
- 大型架构变更应先讨论后实现

## 架构原则

### 控制面 vs 媒体面
- **WebSocket**: 房间生命周期、快照、队列/播放广播、成员在线态、WebRTC 信令
- **WebRTC DataChannel**: 音频分片分发、分片可用性广播

服务端**不**直接处理音频媒体。

### 权威模型
- 房主拥有权威播放状态
- 服务端广播快照，成员仅执行校准
- 成员不自行协调播放时序

## 已知边界

- 优先支持 `2-8 人` 实时同听场景
- WebRTC 依赖浏览器能力，生产环境建议启用 TURN
- 大厅公开房间列表为前端轮询，非 WebSocket 广播
- DataChannel 分片缓存为辅助链路，非实时同听主链路

## 版本历史

### [0.1.0] - 2026-03-30
> 首个 MVP 版本，可运行的多人音乐房

**已落地:**
- Monorepo (pnpm workspace + Turborepo)
- Next.js 15 + React 19 前端
- NestJS 11 + Socket.IO 后端
- `packages/shared` TypeScript 契约
- 游客会话 (`POST /v1/guest-sessions`)
- `x-session-token` 会话认证
- 房间 CRUD、按房间码加入、离开、删除、最近房间恢复
- 本地音频导入、元数据解析、共享队列
- 房主播放控制 (play/pause/seek/next)
- WebRTC 实时音频 (host → members)
- 歌单 CRUD、保存、导入房间
- Redis 房间快照广播
- IndexedDB 整曲/分片缓存
- Docker / Linux Docker 部署模板
- Jest + Vitest 测试
- `typecheck` / `build` / `test` 全量通过

**尚未实现:**
- 更细粒度的播放时钟同步
- 完整错误码体系
- 完整 WebRTC 分片调度
- NAT/TURN 兜底策略
- 协作歌单
- 观测指标和错误追踪 (Sentry)
- 前端组件测试和 E2E
- nginx TLS 配置
- CI/CD 流水线

详见 [docs/engineering/status.md](docs/engineering/status.md) 和 [docs/engineering/roadmap.md](docs/engineering/roadmap.md)

## 文档导航

- 产品目标：[vision.md](docs/product/vision.md)
- 房间流程：[room-flow.md](docs/product/room-flow.md)
- 架构总览：[overview.md](docs/architecture/overview.md)
- 实时与信令：[realtime.md](docs/architecture/realtime.md)
- P2P 分发：[p2p-distribution.md](docs/architecture/p2p-distribution.md)
- 播放同步：[playback-sync.md](docs/architecture/playback-sync.md)
- REST 接口：[rest.md](docs/api/rest.md)
- WebSocket 事件：[websocket-events.md](docs/api/websocket-events.md)
- 开发规范：[conventions.md](docs/engineering/conventions.md)
- 本地环境：[setup.md](docs/engineering/setup.md)
- 测试策略：[testing.md](docs/engineering/testing.md)
- 项目状态：[status.md](docs/engineering/status.md)
- 部署说明：[deployment.md](docs/deployment/deployment.md)
- 已知问题：[optimization.md](docs/engineering/optimization.md)

## 推荐阅读顺序

1. 本 README
2. [status.md](docs/engineering/status.md)
3. [overview.md](docs/architecture/overview.md)
4. [rest.md](docs/api/rest.md)
5. [websocket-events.md](docs/api/websocket-events.md)
