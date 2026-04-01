# 部署方案

最后更新：`2026-04-01`

## 当前范围

当前仓库已经包含：

- 本地开发 `docker-compose.yml`
- Linux 生产模板 [deploy/linux/docker-compose.prod.yml](/e:/code/music_room/deploy/linux/docker-compose.prod.yml)
- Nginx 反代配置 [music-room.conf](/e:/code/music_room/deploy/linux/nginx/music-room.conf)
- 环境变量模板 [.env.production.example](/e:/code/music_room/deploy/linux/.env.production.example)
- Linux 部署脚本 [deploy-linux.sh](/e:/code/music_room/scripts/deploy-linux.sh)
- PostgreSQL、Redis、coturn、server、web 的容器编排
- 服务端 `GET /v1/realtime/ice-config`，支持下发短期 TURN 凭证

当前未覆盖：

- 自动申请与续签 TLS 证书
- 集中日志、指标、告警
- 完整 CI/CD 发版流水线

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
- TURN: `localhost:3478`
- TURNS: `localhost:5349`

## Linux 生产部署

### 前置条件

- Ubuntu 22.04 或 Debian 12
- Docker Engine 28+
- Docker Compose v2
- 已解析到服务器公网 IP 的域名
- 已开放 HTTP 与 TURN 端口

### 步骤

1. 安装 Docker 与 Docker Compose。
2. 拉取仓库到服务器。
3. 复制 `deploy/linux/.env.production.example` 为 `deploy/linux/.env.production`。
4. 填写数据库、Redis、JWT、域名、TURN 相关配置。
5. 执行：

```bash
npx pnpm deploy:linux
```

### 生产路由

- `/` 转发到 `web:3000`
- `/v1/*` 转发到 `server:3001`
- `/ws/*` 转发到 `server:3001`
- `/health/*` 转发到 `server:3001`

## TURN 部署要求

### 核心原则

- Web、API、WebSocket 可以走 Nginx 反代
- TURN 不走 Nginx，浏览器会直接连 coturn
- 必须在防火墙和云安全组中开放 TURN 端口

### 建议开放端口

- `3478/udp`
- `3478/tcp`
- `5349/tcp`

如果你的网络环境要求严格，也可以只保留：

- `3478/udp`
- `5349/tcp`

### 环境变量

服务端和 coturn 相关配置：

- `TURN_ENABLED=true`
- `TURN_PUBLIC_HOST=turn.example.com`
- `TURN_PORT=3478`
- `TURN_TLS_PORT=5349`
- `TURN_SHARED_SECRET=<replace-me>`
- `TURN_REALM=turn.example.com`
- `TURN_PROTOCOLS=udp,tcp,tls`
- `TURN_TTL_SECONDS=3600`

前端静态 fallback：

- `NEXT_PUBLIC_STUN_URL=stun:stun.l.google.com:19302`
- `NEXT_PUBLIC_TURN_URL=turn:turn.example.com:3478?transport=udp`
- `NEXT_PUBLIC_TURN_USERNAME=<optional>`
- `NEXT_PUBLIC_TURN_CREDENTIAL=<optional>`
- `NEXT_PUBLIC_WEBRTC_ICE_SERVERS=<optional JSON override>`

### NAT 与 external-ip

如果 coturn 部署在 NAT 或云厂商私网后面，必须确保 coturn 对外宣告的是公网地址。可选做法：

- 直接用公网 IP 绑定服务器
- 用公网域名作为 `TURN_PUBLIC_HOST`
- 在自定义 coturn 启动参数中显式设置 `external-ip`

如果不处理这一步，前端即使拿到 TURN 凭证，也可能出现：

- 有 `offer / answer`
- 有少量 candidate
- ICE 长时间停留在 `checking` 或 `disconnected`

## 短期 TURN 凭证模式

当前生产默认采用 shared-secret 模式，而不是长期静态用户名密码。

服务端行为：

- 登录用户访问 `GET /v1/realtime/ice-config`
- 服务端生成 `expiryTimestamp:userId` 形式的用户名
- 服务端使用 `TURN_SHARED_SECRET` 通过 HMAC 生成临时 credential
- 前端将返回的 `iceServers` 直接传给 `RTCPeerConnection`

回退逻辑：

- 若 `TURN_SHARED_SECRET` 或 `TURN_PUBLIC_HOST` 缺失，则服务端回退到 `static` 或 `stun-only`
- 若前端接口请求失败，则前端回退到静态 `NEXT_PUBLIC_TURN_*` 配置

## 部署前检查

执行：

```bash
npx pnpm typecheck
npx pnpm test
npx pnpm build
docker compose config
docker compose --env-file deploy/linux/.env.production -f deploy/linux/docker-compose.prod.yml config
```

服务启动后检查：

```bash
npx pnpm deploy:check
```

`deploy:check` 至少应验证：

- Web 首页可访问
- `GET /health`
- `GET /health/readiness`

## 诊断面板判读

“连接与缓存诊断”可用于快速区分问题层级。

### 更像网络 / TURN 问题

- `offer / answer` 正常
- candidate 很少或没有
- ICE 一直不进入 `connected`
- 同房在线，但 Media/Data 都未建立

### 更像媒体流注入问题

- Media 已进入 `connected`
- 监听端没有 `received remote track`
- 远端音频元素没有 `playing`

### 更像浏览器或自动播放问题

- 已收到 `remote track`
- 已绑定音频元素
- 但音频事件停在 `waiting`、`pause` 或 `error`

## 当前部署边界

当前方案已经能支撑：

- Docker 化本地开发
- Linux 单机部署
- WebSocket 信令
- Redis 跨实例广播
- 基于 shared-secret 的 TURN 凭证下发

后续建议：

1. 接入 HTTPS 证书自动续签。
2. 补齐 coturn 的公网 `external-ip` 自动化配置。
3. 增加日志聚合、监控、告警。
4. 增加 CI/CD 自动部署。
