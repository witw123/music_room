# Music Room

[![Release](https://img.shields.io/github/v/release/witw123/music_room)](https://github.com/witw123/music_room/releases)
[![License](https://img.shields.io/github/license/witw123/music_room)](./LICENSE)
[![Node](https://img.shields.io/badge/Node.js-22.x-339933)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220)](https://pnpm.io/)

Music Room 是一个面向多人同步听歌的协作式音乐房项目。仓库采用 Monorepo，包含 Web 前端、NestJS 服务端、桌面端、移动端，以及前后端共享类型。

## 仓库结构

- `apps/web`: Next.js Web 前端
- `apps/server`: NestJS API、房间服务、WebSocket 信令
- `apps/desktop`: Tauri 桌面端
- `apps/mobile`: Capacitor 移动端壳
- `packages/shared`: 前后端共享协议、类型、校验模型

## 功能概览

- 房间创建、加入、恢复与退出
- 多人共享播放队列、房主控制与播放同步
- 本地音频导入、曲库管理、歌单管理
- P2P 分片缓存同步
- WebRTC 实时音频推流
- 成员级“连接与缓存诊断”面板
- 服务端下发短期 TURN 凭证，前端自动回退静态 ICE 配置

## 快速开始

### 环境要求

- Node.js 22.x
- pnpm 10.x
- PostgreSQL
- Redis
- Docker / Docker Compose

### 本地开发

```bash
pnpm install
cp .env.example .env
pnpm dev
```

默认地址：

- Web: `http://localhost:3000`
- Server: `http://localhost:3001`
- Health: `http://localhost:3001/health`

### 常用命令

```bash
pnpm dev
pnpm build
pnpm typecheck
pnpm test
pnpm pack:desktop
pnpm pack:mobile
```

## Shell Origin Configuration

- Web falls back to the current page origin at runtime, so the open-source repo does not need a production domain baked into the frontend bundle.
- Desktop and mobile shells use `MUSIC_ROOM_PUBLIC_ORIGIN` at build/package time.
- If `MUSIC_ROOM_PUBLIC_ORIGIN` is not set, the repo keeps the placeholder `https://example.com`.

Examples:

```bash
# Desktop dev / pack
MUSIC_ROOM_PUBLIC_ORIGIN=https://music.example.com pnpm --filter @music-room/desktop dev
MUSIC_ROOM_PUBLIC_ORIGIN=https://music.example.com pnpm --filter @music-room/desktop pack

# Mobile shell sync / pack
MUSIC_ROOM_PUBLIC_ORIGIN=https://music.example.com pnpm --filter @music-room/mobile android:sync
MUSIC_ROOM_PUBLIC_ORIGIN=https://music.example.com pnpm --filter @music-room/mobile pack
```

## WebRTC / TURN 配置

前端优先请求服务端短期 ICE 配置接口：

- `GET /v1/realtime/ice-config`

返回内容包含：

- `iceServers`
- `ttlSeconds`
- `source`
  - `ephemeral`
  - `static`
  - `stun-only`

默认策略：

- 前端优先使用服务端返回的短期 TURN 凭证
- 若接口不可用，则回退到静态 `NEXT_PUBLIC_TURN_*` / `NEXT_PUBLIC_WEBRTC_ICE_SERVERS`
- 若 TURN 完全不可用，则只使用 STUN

### 关键环境变量

服务端：

- `TURN_ENABLED`
- `TURN_PUBLIC_HOST`
- `TURN_PORT`
- `TURN_TLS_PORT`
- `TURN_SHARED_SECRET`
- `TURN_REALM`
- `TURN_PROTOCOLS`
- `TURN_TTL_SECONDS`

前端 fallback：

- `NEXT_PUBLIC_STUN_URL`
- `NEXT_PUBLIC_TURN_URL`
- `NEXT_PUBLIC_TURN_USERNAME`
- `NEXT_PUBLIC_TURN_CREDENTIAL`
- `NEXT_PUBLIC_WEBRTC_ICE_SERVERS`

## 连接与缓存诊断

成员页中的“连接与缓存诊断”现在会输出：

- 每个 peer 的 `offer / answer / candidate` 收发事件
- Data / Media 的 ICE 状态与连接状态
- 是否收到远端 `track`
- 是否已绑定到远端音频元素
- 远端音频元素 `playing / waiting / pause / error`
- 最近事件流与错误摘要

诊断判读原则：

- 有 `offer / answer`，但没有 candidate 或 ICE 一直不 `connected`：优先检查 TURN、网络出口、防火墙
- Media 已 `connected`，但没有 `remote track`：优先检查 host 侧媒体流注入
- Data 正常、Media 全断：优先检查媒体协商、浏览器自动播放限制、TURN 媒体 candidate

## Docker 部署

本仓库提供：

- 根目录开发用 `docker-compose.yml`
- Linux 生产模板 [deploy/linux](./deploy/linux)
- 部署文档 [docs/deployment/deployment.md](./docs/deployment/deployment.md)

生产建议：

- Nginx 只反代 Web / API / WebSocket
- TURN 不经过 Nginx，直接开放端口
- 至少开放：
  - `3478/udp`
  - `3478/tcp`
  - `5349/tcp`
- 若 coturn 在 NAT 后方，需要正确配置公网域名或 `external-ip`

## 发布

桌面端和移动端安装包发布在：

- [GitHub Releases](https://github.com/witw123/music_room/releases)

当前发布物通常包含：

- Windows `.exe` / `.msi`
- macOS `.dmg`
- Linux `.AppImage` / `.deb` / `.rpm`
- Android `.apk`

## License

[MIT](./LICENSE)
