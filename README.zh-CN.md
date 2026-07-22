# Music Room

[English](./README.md) | [中文](./README.zh-CN.md)

[![Node](https://img.shields.io/badge/Node.js-22.x-339933)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220)](https://pnpm.io/)

Music Room 是一个面向多人同步听歌的浏览器音乐房应用。仓库采用 Monorepo，包含 Next.js 网页端、NestJS 服务端以及前后端共享协议。

当前工作区版本：`0.2.8`<br>
文档快照：`2026-07-23`

## 项目定位

Music Room 聚焦于用户本地音频和已导入外部曲目的多人协作收听。服务端负责账号、房间、权限、队列、播放状态、实时同步和曲目元数据；音频文件不会由服务端持久化。每个浏览器只在本机 IndexedDB 保存当前用户自己导入的原始资产和播放资产。

房间不会在成员之间下载或交换音频资产。曲目拥有者从本地已经准备好的分段 Opus 播放资产发布 WebRTC 媒体流，监听成员只接收一条 RTP Opus 音频流。网易云和 QQ 音乐导入由服务端临时代理，随后仍进入浏览器本地播放资产流程。

## 当前进度

核心产品闭环已经可运行，当前处于“产品可用，工程持续加固”阶段：

- 首页 `/` 为项目入口，`/app` 为网页工作区入口
- 注册/登录、房间创建/加入/恢复、成员权限、暂离房间恢复、共享队列、房主播放控制已打通
- 网页工作区包含房间、平台搜索、歌单、收藏专辑、个人资料、设置和持久化播放器
- 房间工作区当前为 `曲库`、`我的歌单`、`成员`；共享队列由房间舞台和播放器管理
- 网易云和 QQ 音乐支持账号绑定、歌曲搜索、歌单/专辑浏览和本地导入，并由 provider 开关控制
- 播放统一使用单一 Segmented Opus/WebRTC 链路和稳定的房间音频会话
- 诊断面板提供 AudioContext、缓冲、limiter、RTP、ICE 和 Track identity 信息
- 桌面与移动设备使用同一套响应式网页

当前播放链路：

```text
IndexedDB 分段 Opus
  -> SegmentedOpusEngine
  -> 共享 AudioContext 输出总线
  -> MediaStreamAudioDestinationNode
  -> WebRTC RTP Opus
  -> 监听端单一 audio.srcObject
```

进度细节见：

- [项目状态](./docs/engineering/status.md)
- [整体架构](./docs/architecture/overview.md)
- [播放同步](./docs/architecture/playback-sync.md)
- [路线图](./docs/engineering/roadmap.md)
- [测试策略](./docs/engineering/testing.md)
- [本地开发环境](./docs/engineering/setup.md)

## 文档入口

建议按以下顺序阅读：

- [文档总览](./docs/README.md)
- [接口文档总览](./docs/api/README.md)
- [REST API](./docs/api/rest.md)
- [WebSocket 事件](./docs/api/websocket-events.md)
- [共享模型](./docs/api/shared-models.md)
- [测试场景手册](./docs/api/testing-playbook.md)
- [部署说明](./docs/deployment/deployment.md)

## 仓库结构

- `apps/web`: Next.js Web 前端、本地资产准备、播放和 WebRTC
- `apps/server`: NestJS API、房间/provider 服务、持久化和 Socket.IO 信令
- `packages/shared`: 前后端共享协议、类型和校验模型
- `packages/opus-encode`: 导入流程使用的浏览器 Ogg Opus 编码包
- `packages/config-*`: 共享 TypeScript 与 ESLint 配置

## 功能概览

- 房间创建、加入、恢复与退出
- 首页展示入口与 `/app` 网页工作区分流
- 多人共享播放队列、房主控制与播放同步
- 本地音频导入、个人曲库恢复和歌单管理
- 可选的网易云和 QQ 音乐账号绑定、歌曲/歌单/专辑搜索和本地导入
- 收藏专辑、个人资料、设置、主题偏好和暂离房间恢复
- 通过稳定 WebRTC RTP 媒体 Track 发布分段 Opus 播放
- 成员级连接、媒体、播放和音频诊断
- 服务端下发短期 TURN 凭证，前端自动回退静态 ICE 配置

WebRTC 的 `music-room-control` DataChannel 只承载控制和健康状态协调，不传输音频资产，也不负责缓存下载。

## 快速开始

### 环境要求

- Node.js 22.x
- pnpm 10.x
- PostgreSQL 16.x
- Redis 7.x
- Docker / Docker Compose（推荐用于本地依赖）
- 支持 IndexedDB、Web Audio 和 WebRTC 的现代浏览器

### 本地开发

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres redis
pnpm --filter @music-room/server db:push
pnpm dev
```

PowerShell 下第二条命令使用 `Copy-Item .env.example .env`。本地模板启用了仅用于开发的认证 fallback 存储，但正常的房间和元数据持久化仍需要 PostgreSQL，实时播放控制仍需要 Redis。

默认地址：

- Web：`http://localhost:3000`
- Server：`http://localhost:3001`
- Health：`http://localhost:3001/health`

开发期主入口：

- 首页展示：`/`
- 网页工作区：`/app`
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
```

补充检查：

```bash
pnpm lint
pnpm deploy:check
```

`pnpm e2e` 会启动真实 server + web、清理隔离的 Redis 数据库，并要求 Redis 可连接到 `redis://127.0.0.1:6379/15`（也可通过 `REDIS_URL` 覆盖）。`pnpm check:toolchain` 会强制校验 Node.js 22.x 与 pnpm 10.x。完整依赖和迁移流程见[本地开发环境](./docs/engineering/setup.md)。

## Web Origin 配置

- Web 默认使用当前页面 origin，不需要把生产域名硬编码进仓库。
- `NEXT_PUBLIC_API_BASE_URL` 和 `NEXT_PUBLIC_WS_URL` 可指向独立部署的服务端。

## WebRTC / TURN 配置

前端优先请求 `GET /v1/realtime/ice-config` 获取短期 ICE 配置。返回值包含 `iceServers`、`ttlSeconds` 以及 `ephemeral`、`static` 或 `stun-only` 的 `source`。

默认策略：

- 优先使用服务端返回的短期 TURN 凭证
- 接口不可用时回退到静态 `NEXT_PUBLIC_TURN_*` / `NEXT_PUBLIC_WEBRTC_ICE_SERVERS`
- TURN 完全不可用时只使用 STUN

服务端关键变量：

- `TURN_ENABLED`
- `TURN_PUBLIC_HOST`
- `TURN_PUBLIC_HOST_USE_APP_DOMAIN`
- `TURN_PUBLIC_HOST_USE_REQUEST_HOST`
- `TURN_PORT`
- `TURN_TLS_PORT`
- `TURN_SHARED_SECRET`
- `TURN_REALM`
- `TURN_PROTOCOLS`
- `TURN_TTL_SECONDS`

前端静态 ICE 回退变量：

- `NEXT_PUBLIC_STUN_URL`
- `NEXT_PUBLIC_TURN_URL`
- `NEXT_PUBLIC_TURN_USERNAME`
- `NEXT_PUBLIC_TURN_CREDENTIAL`
- `NEXT_PUBLIC_WEBRTC_ICE_SERVERS`

### 可选平台 provider

当前 provider API 支持网易云和 QQ 音乐，`.env.example` 默认关闭。启用 provider 时需要同时设置服务端开关和前端构建开关；生产环境还需要合法的 32 字节 hex 或 base64 Cookie 加密密钥。平台凭证只在服务端加密保存，导入音频不会作为服务端曲库长期保存。

- 网易云：`NETEASE_ENABLED`、`NETEASE_COOKIE_ENCRYPTION_KEY`、`NEXT_PUBLIC_NETEASE_ENABLED`
- QQ 音乐：`QQMUSIC_ENABLED`、`QQMUSIC_COOKIE_ENCRYPTION_KEY`、`NEXT_PUBLIC_QQMUSIC_ENABLED`

## 连接与播放诊断

成员页的诊断面板会输出：

- offer/answer/candidate 信令事件
- 控制与媒体连接、ICE 状态
- `playbackAssetId`、媒体会话 key、源 peer 和源拥有者状态
- AudioContext、已缓冲/已调度音频、underrun 和解码错误
- limiter peak/RMS、RTP bitrate、jitter、丢包和编码信息
- 本地输出 Track 与远端 Track identity

排障原则：

- ICE 无法建立：先检查 TURN、网络出口、防火墙和候选路径
- Media 已连接但无声音：检查 AudioContext 解锁、源拥有者在线状态、远端 Track 绑定和 `audio.play()` 结果
- 卡顿或电流声：检查 buffered/scheduled ahead、underrun、limiter peak/RMS、RTP jitter 和丢包
- 成员/presence 快照刷新本身不应改变输出或远端 Track identity

## Docker 部署

本仓库提供：

- 根目录开发用 `docker-compose.yml`
- Linux 生产模板 [deploy/linux](./deploy/linux)
- 部署文档 [docs/deployment/deployment.md](./docs/deployment/deployment.md)

生产建议：

- Nginx 只反代 Web / API / WebSocket
- TURN 不经过 Nginx，直接开放端口
- 正式部署当前只支持单个 `server` 实例，多实例房间权威尚未完成
- 至少开放 `3478/udp`、`3478/tcp`、`5349/tcp` 以及配置的 TURN relay 端口段
- coturn 在 NAT 后方时，正确配置公网域名或 `external-ip`

部署细节见：

- [部署说明](./docs/deployment/deployment.md)
- [TURN 网络检查清单](./docs/deploy/turn-network-checklist.md)
- [风险与约束](./docs/deployment/risks.md)
- [可观测性](./docs/deployment/observability.md)

## 发布

生产环境通过 `Dockerfile.web`、`Dockerfile.server` 和 `deploy/linux` 中的 Compose 配置发布。当前仓库只发布响应式 Web 应用，不生成桌面或移动安装包。

## 当前已知边界

- 播放依赖实时信令和曲目拥有者浏览器在线
- Redis 不可用时，依赖 Realtime 的播放控制请求会失败
- 曲目拥有者离线时，其他成员无法播放该拥有者尚未在本机上传的曲目
- 网易云能力依赖上游接口、用户登录态、歌曲版权和可用音质；网易云临时音频地址不会写入房间状态
- QQ 音乐能力同样依赖上游接口、登录态、版权和可用音质；平台 provider 不保证所有歌曲都能导入
- 浏览器级长时间 WebRTC 测试和统一生产观测能力仍在继续补强

## License

[MIT](./LICENSE)
