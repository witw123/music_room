# 部署说明

最后更新：`2026-07-07`

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

正式版当前只支持单个 `server` 实例。不要把 `server` 服务横向扩容到 2 个或更多副本；房间控制、播放状态和实时 source peer 仍按单写权威模型交付，多实例一致性会在后续 Redis CAS 或数据库事务化方案中单独处理。

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
3. 将 `GHCR_OWNER` 设为镜像所属组织，将 `RELEASE_TAG` 设为 CI 生成的 `sha-<完整提交 SHA>`；Web 与 Server 必须使用同一标签
4. 执行：

```bash
npx pnpm deploy:linux
```

或手动执行：

```bash
docker compose --env-file deploy/linux/.env.production -f deploy/linux/docker-compose.prod.yml pull
docker compose --env-file deploy/linux/.env.production -f deploy/linux/docker-compose.prod.yml up -d
```

## Spotify / Zotify 部署

Spotify 完整导入使用 server 镜像内置的 Python、FFmpeg 和 Zotify。推送包含 Spotify 改动的 `main` 后，等待 GitHub Actions 完成镜像发布，再使用该次提交对应的完整 `sha-<40 位 commit SHA>` 作为 `RELEASE_TAG`；不要使用旧镜像或 `latest`。

首次部署前：

1. 在 `deploy/linux/.env.production` 设置随机的 `SPOTIFY_CREDENTIALS_ENCRYPTION_KEY`（32 字节 hex 或 base64），并将 `SPOTIFY_ENABLED=true`、`NEXT_PUBLIC_SPOTIFY_ENABLED=true` 写入配置。
2. 创建数据目录并限制权限：

```bash
mkdir -p deploy/linux/data/spotify
chmod 700 deploy/linux/data/spotify
```

3. 设置下载运行参数：

```dotenv
SPOTIFY_DOWNLOAD_DIR=/data/spotify/downloads
SPOTIFY_DATA_DIR=./data/spotify
SPOTIFY_ZOTIFY_BIN=zotify
SPOTIFY_DOWNLOAD_FORMAT=mp3
SPOTIFY_DEFAULT_QUALITY=high
```

启动正式服务：

```bash
docker compose --env-file deploy/linux/.env.production \
  -f deploy/linux/docker-compose.prod.yml up -d
docker compose --env-file deploy/linux/.env.production \
  -f deploy/linux/docker-compose.prod.yml exec server zotify --help
```

用户登录网页后，在「第三方 → Spotify」填写 Spotify Developer Dashboard 的 Client ID、Client Secret，并选择本机生成的 `credentials.json`。文件内容通过 HTTPS 提交，服务端加密入库；不同用户的下载缓存相互隔离。

`NEXT_PUBLIC_SPOTIFY_ENABLED` 是 Next.js 构建期变量。官方 CI 镜像已默认编译启用 Spotify；如果自行构建 `Dockerfile.web`，必须传入 `--build-arg NEXT_PUBLIC_SPOTIFY_ENABLED=true`，仅修改运行时环境变量不会改变已经生成的前端 bundle。

查看 Spotify 服务状态：登录后请求 `GET /v1/providers/spotify/account`，或直接打开「第三方」Tab。状态必须同时显示当前用户凭证和 Zotify 就绪。

注意：Spotify 下载缓存位于 `deploy/linux/data/spotify/downloads`，不要删除该目录；加密主密钥丢失后，已保存的用户凭证无法恢复。

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
- `/app`
- `/health`
- `/health/readiness`
- `/v1/realtime/ice-config`

如果重新部署后发现“账号像被清空了一样”，优先检查两件事：

- `DATABASE_URL` 指向的 PostgreSQL 是否真的可连通，并且容器卷 `postgres_data` 没被删除
- 生产环境是否明确设置了 `AUTH_FAKE_PERSISTENCE=false`

认证服务在数据库不可用时有一套开发期 fallback 存储；如果生产误用了这条路径，数据会写进容器内临时文件，容器重建后自然就没了。

如果首页能开但 `/app` 白屏，要优先检查：

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
- `TURN_PUBLIC_HOST_USE_APP_DOMAIN=0`
- `TURN_PUBLIC_HOST_USE_REQUEST_HOST=0`
- `TURN_PORT=3478`
- `TURN_SHARED_SECRET=<replace-me>`
- `TURN_REALM=turn.example.com`
- `TURN_MIN_PORT=49160`
- `TURN_MAX_PORT=49200`
- `TURN_TTL_SECONDS=3600`
- `TURN_PROTOCOLS=udp,tcp,tls`

### 必须放通的端口

- `3478/udp`
- `3478/tcp`
- `5349/tcp`（TURN TLS）
- `TURN_MIN_PORT-TURN_MAX_PORT/udp`

### 现象判断

如果房间里看到：

- `offer / answer` 正常
- `ICE disconnected` 或 `failed`
- `mediaConnectionState` 长时间不是 `connected`
- `mediaReceiveBitrateKbps` 为 `0`
- `remoteTrackStatus.hasSrcObject` 为 `false`

优先检查 TURN、媒体候选路径和远端 Track 绑定，不要先怀疑播放器 UI。

## Shell Public Origin

### Web

- Web 运行时默认使用当前页面同源
- 不再需要把生产域名硬编码进仓库

Web 运行时默认使用当前页面同源，不再需要把生产域名硬编码进仓库。
