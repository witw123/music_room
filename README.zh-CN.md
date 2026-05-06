# Music Room

[English](./README.md) | [中文](./README.zh-CN.md)

[![Release](https://img.shields.io/github/v/release/witw123/music_room)](https://github.com/witw123/music_room/releases)
[![License](https://img.shields.io/github/license/witw123/music_room)](./LICENSE)
[![Node](https://img.shields.io/badge/Node.js-22.x-339933)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220)](https://pnpm.io/)

Music Room 是一个面向多人同步听歌的协作式音乐房项目。仓库采用 Monorepo，包含 Web 前端、NestJS 服务端、桌面端、移动端，以及前后端共享类型。

## 项目定位

Music Room 不是公共版权曲库，也不是服务端托管音频的平台。

当前项目的核心目标是：

- 让用户基于本地音频完成多人同步听歌
- 用共享队列、P2P 分片和实时音频把房间体验串成闭环
- 在不上传音频文件本体的前提下，尽量提供稳定的多人协作播放体验

## 当前进度

当前代码已经具备可运行的核心闭环，项目状态处于“产品可用，工程持续加固”阶段：

- 首页 `/` 为官网展示入口，`/app` 为客户端工作区入口
- 账号注册 / 登录、房间创建 / 加入 / 恢复、共享队列、房主播放控制已打通
- 房间主界面当前收敛为 `共享队列`、`曲库`、`缓存`、`成员`
- P2P 分片缓存、房主实时音频推流、MP3/FLAC 渐进式本地播放均已接入
- 桌面端已迁移到 Tauri 2，移动端当前提供 Capacitor Android 壳

进度细节见：

- [项目状态](./docs/engineering/status.md)
- [路线图](./docs/engineering/roadmap.md)
- [测试策略](./docs/engineering/testing.md)

## 文档入口

如果你是第一次打开这个仓库，建议按这个顺序阅读：

- [文档总览](./docs/README.md)
- [接口文档总览](./docs/api/README.md)
- [REST API](./docs/api/rest.md)
- [WebSocket 事件](./docs/api/websocket-events.md)
- [共享模型](./docs/api/shared-models.md)
- [测试场景手册](./docs/api/testing-playbook.md)
- [部署说明](./docs/deployment/deployment.md)

## 仓库结构

- `apps/web`: Next.js Web 前端
- `apps/server`: NestJS API、房间服务、WebSocket 信令
- `apps/desktop`: Tauri 桌面端
- `apps/mobile`: Capacitor 移动端壳
- `packages/shared`: 前后端共享协议、类型、校验模型

## 功能概览

- 房间创建、加入、恢复与退出
- 首页展示入口与 `/app` 客户端工作区分流
- 多人共享播放队列、房主控制与播放同步
- 本地音频导入、曲库管理、歌单管理
- P2P 分片缓存同步
- WebRTC 实时音频推流
- 手动缓存、缓存回库与缓存导出
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

开发期主入口：

- 首页展示：`/`
- 客户端工作区：`/app`
- 登录页：`/auth`
- 房间入口：`/rooms`

### 常用命令

```bash
pnpm dev
pnpm build
pnpm typecheck
pnpm test
pnpm e2e
pnpm check:toolchain
pnpm pack:desktop
pnpm pack:mobile
```

`pnpm e2e` 会启动真实 server + web，并要求本地 Redis 可连接到 `redis://127.0.0.1:6379/15`；`pnpm check:toolchain` 会强制校验 Node.js 22.x 与 pnpm 10.x，避免本地环境和 CI / 发布环境漂移。

## Shell Origin 配置

- Web 会在运行时回退到当前页面 origin，因此开源仓库不需要把生产域名写死进前端 bundle。
- 桌面端和移动端壳在构建 / 打包时使用 `MUSIC_ROOM_PUBLIC_ORIGIN`。
- 如果没有设置 `MUSIC_ROOM_PUBLIC_ORIGIN`，桌面端和移动端打包会快速失败，避免产出指向 `https://example.com` 的客户端。
- 官方 `0.2.7` 客户端包预期指向 `https://musicroom.witw.top`。

示例：

```bash
# Desktop dev / pack
MUSIC_ROOM_PUBLIC_ORIGIN=https://musicroom.witw.top pnpm --filter @music-room/desktop dev
MUSIC_ROOM_PUBLIC_ORIGIN=https://musicroom.witw.top pnpm --filter @music-room/desktop pack

# Mobile shell sync / pack
MUSIC_ROOM_PUBLIC_ORIGIN=https://musicroom.witw.top pnpm --filter @music-room/mobile android:sync
MUSIC_ROOM_PUBLIC_ORIGIN=https://musicroom.witw.top pnpm --filter @music-room/mobile pack
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

部署细节见：

- [部署说明](./docs/deployment/deployment.md)
- [风险与约束](./docs/deployment/risks.md)
- [可观测性](./docs/deployment/observability.md)

## 发布

桌面端和移动端安装包发布在：

- [GitHub Releases](https://github.com/witw123/music_room/releases)

当前发布物通常包含：

- Windows `.exe` / `.msi`
- macOS `.dmg`
- Linux `.AppImage` / `.deb` / `.rpm`
- Android `.apk`

## 当前已知边界

- 播放控制依赖 Realtime 可用；Redis 不可用时，播放相关接口会直接失败
- 房间主界面当前以 `共享队列 / 曲库 / 缓存 / 成员` 为主，歌单后端能力保留但默认不作为主入口
- 浏览器级 E2E、真实 WebRTC 集成测试和统一观测能力仍在继续补强

## License

[MIT](./LICENSE)
