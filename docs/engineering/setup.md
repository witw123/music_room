# 本地开发环境

最后更新：`2026-07-23`
当前版本：`0.2.8`

## 版本要求

- Node.js `22.x`
- pnpm `10.x`
- PostgreSQL `16.x`
- Redis `7.x`
- Docker / Docker Compose（推荐用于本地依赖）

## 当前本地开发基线

仓库当前是 Monorepo，主要模块包括：

- `apps/web`：Next.js Web 前端
- `apps/server`：NestJS API / Socket.IO 服务端
- `packages/shared`：共享协议与类型
- `packages/opus-encode`：浏览器导入流程使用的 Ogg Opus 编码包

本地默认联调地址：

- Web：`http://localhost:3000`
- Server：`http://localhost:3001`
- Health：`http://localhost:3001/health`
- WebSocket：`http://localhost:3001/ws/socket.io`

## 启动步骤

1. 安装依赖：

```bash
pnpm install
```

2. 复制环境变量：

```bash
cp .env.example .env
```

3. 准备 PostgreSQL 与 Redis：

- 可自行安装
- 或使用仓库根目录 `docker-compose.yml`：

```bash
docker compose up -d postgres redis
```

4. 初始化本地数据库：

```bash
pnpm --filter @music-room/server db:push
```

5. 启动开发环境：

```bash
pnpm dev
```

## 常用命令

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
pnpm check:toolchain
pnpm deploy:check
```

## 当前开发期行为

- 认证主路径已经是账号注册 / 登录，不再是旧的游客文档口径
- 非生产环境下，当数据库不可用时，认证服务可能退回 fallback 存储
- 播放控制依赖 Realtime 可用；Redis 不可用时，播放相关接口不会正常工作
- 管理台的结束房间、禁用账号和撤销会话由 `ADMIN_MUTATIONS_ENABLED` 控制；本地开发模板默认开启，设为 `false` 后服务端会拒绝所有管理写操作
- 房间主界面当前默认是：
  - `曲库`
  - `我的歌单`
  - `成员与诊断`
- 共享队列由房间舞台和全局播放器管理，不再是独立的房间 Tab
- provider 默认关闭；启用网易云或 QQ 音乐时，服务端和 Web 构建都要同步设置对应开关
- `pnpm e2e` 使用 `AUTH_FAKE_PERSISTENCE=true` 和 Redis DB `15`，不会复用本地登录数据
