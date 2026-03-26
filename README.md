# Music Room

Music Room 是一个以 `Web` 为首发平台的音乐房项目。服务端只负责房间、歌单、播放状态和 WebRTC 信令；音频文件由用户本地导入，并通过客户端之间的 P2P 网络分发，尽量避免服务端承担媒体带宽。

## 核心能力

- 共享房间：房主创建房间，成员通过房间码加入。
- 同播与点歌混合：全房间共享一个播放队列，成员可点歌，房主有最终控制权。
- 完整播放器：支持播放、暂停、切歌、拖动和同步校准。
- 强歌单：支持创建、收藏、协作、排序，以及房间队列与歌单互转。
- P2P 音频分发：客户端通过 WebRTC DataChannel 交换分片并在 IndexedDB 中缓存。

## 技术栈

- `apps/web`: Next.js + React + TypeScript + Tailwind CSS + Zustand + TanStack Query
- `apps/server`: NestJS + Prisma + PostgreSQL + Redis + WebSocket Gateway
- `packages/shared`: zod schema、REST DTO、事件协议、常量与错误码
- `Monorepo`: pnpm workspace + Turborepo

## 快速启动

1. 安装 Node.js `22.x` 与 pnpm `10.x`
2. 复制 `.env.example` 为 `.env`
3. 安装依赖：`pnpm install`
4. 启动开发环境：`pnpm dev`

## Docker 部署

1. 确保本机已安装 Docker 与 Docker Compose
2. 在仓库根目录执行：`docker compose up --build`
3. 访问：
   - Web: `http://localhost:3000`
   - Server Health: `http://localhost:3001/health`

容器会同时启动：

- `web`: Next.js 前端
- `server`: NestJS API 与信令服务
- `postgres`: PostgreSQL 16
- `redis`: Redis 7

## 仓库结构

```text
apps/
  web/        Next.js 客户端
  server/     NestJS API 与信令服务
packages/
  shared/     前后端共享协议与 schema
  config-*    工程公共配置
docs/         产品、架构、接口、工程与部署文档
```

## 关键文档

- `docs/product/vision.md`
- `docs/architecture/overview.md`
- `docs/api/shared-models.md`
- `docs/engineering/setup.md`
