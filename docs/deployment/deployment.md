# 部署方案

最后更新：`2026-03-29`

## 当前状态

- `已完成`
  - `docker-compose.yml`
  - `docker-compose.prod.yml`
  - `Dockerfile.server`
  - `Dockerfile.web`
  - PostgreSQL 与 Redis 编排
  - 服务端启动前自动执行 `prisma db push`
  - `GET /health`
  - `GET /health/readiness`
  - 根目录部署自检：`npx pnpm deploy:check`
  - Linux 服务器部署目录：`deploy/linux`
  - Linux 一键部署脚本：`npx pnpm deploy:linux`
- `未完成`
  - 正式 TLS 证书自动化
  - Sentry、指标和告警接入
  - CI/CD 发布流水线

## 本地容器部署

在仓库根目录执行：

```bash
docker compose up --build
```

默认服务：

- Web: `http://localhost:3000`
- Server: `http://localhost:3001`
- Health: `http://localhost:3001/health`
- Readiness: `http://localhost:3001/health/readiness`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

## Linux 服务器部署

### 目录

- Compose: [docker-compose.prod.yml](/e:/code/music_room/deploy/linux/docker-compose.prod.yml)
- Nginx: [music-room.conf](/e:/code/music_room/deploy/linux/nginx/music-room.conf)
- 环境变量样板: [.env.production.example](/e:/code/music_room/deploy/linux/.env.production.example)
- 脚本: [deploy-linux.sh](/e:/code/music_room/scripts/deploy-linux.sh)

### 推荐环境

- Ubuntu 22.04 / Debian 12
- Docker Engine 28+
- Docker Compose v2
- 2C4G 起步
- 域名已解析到服务器公网 IP

### 步骤

1. 安装 Docker 和 Docker Compose。
2. 拉取仓库到服务器。
3. 复制 `deploy/linux/.env.production.example` 为 `deploy/linux/.env.production`。
4. 修改域名、数据库密码、JWT 密钥。
5. 执行：

```bash
npx pnpm deploy:linux
```

### 默认路由

- `/` 转发到 `web:3000`
- `/v1/*` 转发到 `server:3001`
- `/ws/*` 转发到 `server:3001`
- `/health/*` 转发到 `server:3001`

## 环境变量

### 服务端

- `PORT`
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`

### 前端

- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_WS_URL`
- `NEXT_PUBLIC_STUN_URL`

### Linux 生产附加

- `APP_DOMAIN`
- `LETSENCRYPT_EMAIL`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`

## 部署前检查

1. 构建与测试：
   - `npx pnpm test`
   - `npx pnpm typecheck`
   - `npx pnpm build`
2. 编排检查：
   - 本地：`docker compose config`
   - Linux：`docker compose --env-file deploy/linux/.env.production -f deploy/linux/docker-compose.prod.yml config`
3. 服务运行后自检：
   - `npx pnpm deploy:check`

`deploy:check` 会检查：

- Web 首页是否可访问
- `GET /health`
- `GET /health/readiness`

## 当前部署边界

- 前端和服务端可通过 Docker 启动
- PostgreSQL 和 Redis 已纳入编排
- 服务端支持“有库持久化，无库降级”
- `readiness` 以 Prisma 和 Redis 连接状态为准
- Linux 生产部署当前默认是 `HTTP + Nginx 反代`
- TLS、证书自动续期和更严格的 secrets 管理还未补齐

## 下一步部署工作

1. 接入 HTTPS 和证书自动续期。
2. 增加 secrets 管理和环境隔离。
3. 增加日志聚合、错误追踪和指标。
4. 增加 CI/CD 发布流程。
