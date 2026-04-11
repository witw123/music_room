# 部署说明

最后更新：`2026-04-11`

## 当前支持的部署形态

### 首选：Docker Compose 生产编排

仓库当前提供的正式模板是：

- [deploy/linux/docker-compose.prod.yml](/e:/code/music_room/deploy/linux/docker-compose.prod.yml)
- [deploy/linux/.env.production.example](/e:/code/music_room/deploy/linux/.env.production.example)
- [deploy/linux/nginx/music-room.conf](/e:/code/music_room/deploy/linux/nginx/music-room.conf)

这套模板默认包含：

- `postgres`
- `redis`
- `coturn`
- `server`
- `web`
- `nginx`

### 可选：宿主机直部署

项目可以直接跑在 Ubuntu 宿主机上，但仓库没有提供现成的一键 systemd 模板。你需要自己负责：

- `web` 进程守护
- `server` 进程守护
- PostgreSQL / Redis / coturn 安装与维护
- Nginx upstream
- 日志轮转和重启策略

## Docker 部署步骤

1. 复制环境变量模板
2. 按实际公网域名、数据库、Redis、TURN 填值
3. 执行：

```bash
npx pnpm deploy:linux
```

或手动执行：

```bash
docker compose --env-file deploy/linux/.env.production -f deploy/linux/docker-compose.prod.yml up -d --build
```

## 发布前检查

```bash
npx pnpm typecheck
npx pnpm test
npx pnpm build
docker compose config
docker compose --env-file deploy/linux/.env.production -f deploy/linux/docker-compose.prod.yml config
```

启动后再执行：

```bash
npx pnpm deploy:check
```

## 必查健康项

至少确认这些地址是通的：

- `/`
- `/app?client=desktop`
- `/health`
- `/health/readiness`
- `/v1/realtime/ice-config`

如果重新部署后发现“账号像被清空了一样”，优先检查两件事：

- `DATABASE_URL` 指向的 PostgreSQL 是否真的可连通，并且容器卷 `postgres_data` 没被删除
- 生产环境是否明确设置了 `AUTH_FAKE_PERSISTENCE=false`

认证服务在数据库不可用时有一套开发期 fallback 存储；如果生产误用了这条路径，数据会写进容器内临时文件，容器重建后自然就没了。

如果首页能开但 `/app?client=desktop` 白屏，要优先检查：

- `/_next/static/*` 是否返回 `200`
- 当前前端 bundle 是否仍然引用旧的静态资源

## 宿主机直部署注意事项

### 1. 不要直接复用 Docker 版 Nginx upstream

模板里的 upstream 是：

```nginx
upstream music_room_web {
  server web:3000;
}

upstream music_room_server {
  server server:3001;
}
```

这只适用于 Docker 容器网络。

宿主机直部署时应改成：

```nginx
upstream music_room_web {
  server 127.0.0.1:3000;
}

upstream music_room_server {
  server 127.0.0.1:3001;
}
```

如果没改，Nginx 最常见的表现就是：

- `502 Bad Gateway`

### 2. 必须有进程守护

如果你直接跑：

- `pnpm --filter @music-room/web start`
- `pnpm --filter @music-room/server start`

而没有 `systemd`、`pm2` 或等价守护，进程掉了以后 Nginx 只会继续返回 `502`。

### 3. 需要确认端口监听

```bash
ss -ltnp | grep -E ':3000|:3001'
curl http://127.0.0.1:3000
curl http://127.0.0.1:3001/health
```

## TURN / WebRTC 要求

### 必要环境变量

- `TURN_ENABLED=true`
- `TURN_PUBLIC_HOST=turn.example.com`
- `TURN_PORT=3478`
- `TURN_TLS_PORT=5349`
- `TURN_SHARED_SECRET=<replace-me>`
- `TURN_REALM=turn.example.com`
- `TURN_MIN_PORT=49160`
- `TURN_MAX_PORT=49200`
- `TURN_TTL_SECONDS=3600`

### 必须放通的端口

- `3478/udp`
- `3478/tcp`
- `5349/tcp`
- `TURN_MIN_PORT-TURN_MAX_PORT/udp`

### 现象判断

如果房间里看到：

- `offer / answer` 正常
- `ICE disconnected` 或 `failed`
- `实时音频: 0`
- `P2P 节点: 0`

优先检查 TURN，不要先怀疑播放器 UI。

## Shell Public Origin

### Web

- Web 运行时默认使用当前页面同源
- 不再需要把生产域名硬编码进仓库

### Desktop / Mobile

- 桌面端和移动端打包时必须提供 `MUSIC_ROOM_PUBLIC_ORIGIN`
- 现在缺失该变量会直接构建失败
- `0.2.7` 官方发布包要求该值为 `https://musicroom.witw.top`

示例：

```bash
MUSIC_ROOM_PUBLIC_ORIGIN=https://musicroom.witw.top pnpm --filter @music-room/desktop pack
MUSIC_ROOM_PUBLIC_ORIGIN=https://musicroom.witw.top pnpm --filter @music-room/mobile pack
```
