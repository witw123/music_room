# Music Room

[English](./README.md) | [中文](./README.zh-CN.md)

[![Node](https://img.shields.io/badge/Node.js-22.x-339933)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220)](https://pnpm.io/)

Music Room 是一个面向多人同步听歌的多端音乐房应用。仓库采用 Monorepo 架构，包含 Next.js Web 前端、Tauri 2 桌面端、Capacitor 7 移动端、NestJS 服务端以及前后端共享协议。

当前工作区版本：`0.3.2`<br>
文档快照：`2026-09`

## 项目定位

Music Room 聚焦于用户本地音频和已导入外部曲目的多人协作收听。服务端负责账号、房间、权限、队列、播放状态、实时同步和曲目元数据；音频文件不会由服务端持久化。每个客户端只在本机 IndexedDB 保存当前用户自己导入的原始资产和播放资产（支持通过 File System Access API 同步至本地目录）。

房间不会在成员之间下载或交换音频资产。曲目拥有者从本地已经准备好的分段 Opus 播放资产发布 WebRTC 媒体流，监听成员只接收一条 RTP Opus 音频流。网易云和 QQ 音乐导入由服务端临时代理，随后仍进入客户端本地播放资产流程。

## 当前进度

核心产品闭环已经稳定运行，并全面覆盖 Web、桌面端与移动端：

- **多端客户端体系**：
  - 响应式 Web 端：自适应桌面与移动端浏览器，支持 PWA 体验
  - 桌面客户端（Tauri 2）：支持 Windows SMTC 系统媒体传输控制、桌面悬浮歌词、原生媒体快捷键
  - 移动客户端（Capacitor 7）：支持 Android 原生 MediaSession、后台音频播放、通知栏与锁屏播放控制
  - 系统媒体桥接（System Media Bridge）：统一串联 Windows SMTC、Android 与 Web MediaSession API
- **房间形态与协作**：
  - 标准房间：多人协作共享队列、播放控制权限（player 权限）、WebRTC 实时同步广播
  - 点歌房 / 电台模式：房主掌控播放，观众可搜索曲库并向点歌收件箱提交点歌，房主集中审批入队
  - 实时互动：支持房间实时悬浮表情互动（Reactions）与信令广播
  - 多设备登录源隔离：基于设备会话独立识别媒体源，彻底杜绝同账号跨设备登录导致的媒体流中断与卡顿
- **歌词系统**：
  - 支持标准 LRC 滚动歌词与网易云 YRC 逐字精准歌词（通过 `lyric_new` 接口）
  - 支持双语翻译歌词与音译歌词并排呈现
  - 移动端沉浸式全屏歌词（点击空白处平滑切换专辑封面）与桌面端独立歌词悬浮窗
  - 统一的本地 IndexedDB 歌词多级缓存
- **搜索与发现**：
  - 通用 `SearchBar` 组件，深度优化移动端中文拼音 IME 合成事件，解决输入被刷新与覆盖问题
  - 支持键入即时联想词（Autocomplete）、热搜词推荐与本地搜索历史
  - 支持本地曲库、网易云音乐与 QQ 音乐跨平台歌曲、专辑与歌单搜索
- **播放架构**：
  - SegmentedOpusEngine + 共享 AudioContext + WebRTC RTP 广播链路（曲目拥有者是唯一媒体源）
  - 拥有者离线时，Provider 曲目支持监听端无缝 offline fallback 继续播放
  - 服务端 Watchdog 针对活跃房间按需轮询，避免全量扫描造成的 CPU 浪费
- **诊断面板**：
  - 提供 AudioContext 状态、缓冲队列、Limiter 峰值/RMS、RTP 码率/抖动/丢包率及 Track Identity 实时诊断

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

- `apps/web`: Next.js 15 Web 前端、响应式工作区、本地资产准备、播放引擎与 WebRTC
- `apps/desktop`: Tauri 2 跨平台桌面客户端，集成 Windows SMTC 系统媒体控制与桌面歌词
- `apps/mobile`: Capacitor 7 移动客户端，集成 Android 原生 MediaSession 与后台播放服务
- `apps/server`: NestJS 11 API、房间/Provider 服务、Prisma ORM、持久化与 Socket.IO 信令网关
- `packages/shared`: 前后端共享协议、TypeScript 类型定义与 Zod 校验模型
- `packages/opus-encode`: 浏览器端 Ogg Opus 音频分段编码包
- `packages/config-*`: Monorepo 共享 TypeScript 与 ESLint 配置

## 功能概览

- **多端客户端体系**：Web 网页端、Tauri 2 桌面客户端、Capacitor 7 移动客户端
- **系统媒体集成**：Windows SMTC、Android MediaSession 原生通知栏/锁屏控制、Web MediaSession API
- **房间模式**：标准协作房、点歌房（观众提交点歌、房主审批）、房间内实时表情互动
- **播放控制与同步**：多人共享播放队列、播放权限控制（player 权限）、WebRTC RTP 广播与 Provider 离线回退
- **歌词体验**：LRC 滚动歌词、网易云 YRC 逐字歌词、双语翻译与罗马音音译、移动端沉浸歌词、桌面悬浮歌词
- **音频资产管理**：本地音频导入、个人曲库恢复、歌单管理、本地目录双向同步
- **在线平台集成**：可选的网易云和 QQ 音乐账号绑定、歌曲/歌单/专辑搜索与本地导入
- **个性化与体验**：收藏专辑、个人资料、多套主题偏好、暂离房间自动恢复、客户端更新检测
- **端到端诊断**：成员级连接状态、信令时序、ICE 状态、Web Audio 调度与 RTP 流质量诊断
- **弹性网络穿透**：服务端下发短期 TURN 凭证，前端自动回退静态 ICE 配置

WebRTC 的 `music-room-control` DataChannel 只承载控制和健康状态协调，不传输音频资产，也不负责缓存下载。

## 快速开始

### 环境要求

- Node.js 22.x
- pnpm 10.x
- PostgreSQL 16.x
- Redis 7.x
- Docker / Docker Compose（推荐用于本地数据库与中间件依赖）
- 现代浏览器（支持 IndexedDB、Web Audio 和 WebRTC）
- （可选）Rust / Cargo 工具链（用于 Tauri 桌面端开发）
- （可选）Android Studio / Xcode（用于 Capacitor 移动端构建）

### 本地开发

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres redis
pnpm --filter @music-room/server db:push
pnpm dev
```

PowerShell 下第二条复制命令使用 `Copy-Item .env.example .env`。本地模板启用了仅用于开发的认证 fallback 存储，但正常的房间和元数据持久化仍需要 PostgreSQL，实时播放控制仍需要 Redis。

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
# 开发与构建
pnpm dev                  # 启动 Web 与 Server 开发服务
pnpm build                # 全 monorepo 构建
pnpm typecheck            # TypeScript 类型检查
pnpm test                 # 单元测试 (Vitest + Jest)
pnpm e2e                  # 端到端测试 (Playwright)

# 桌面端开发与打包 (Tauri 2)
pnpm desktop:dev          # 启动 Tauri 桌面端开发窗口
pnpm desktop:build        # 构建桌面端安装包

# 移动端同步与打包 (Capacitor 7)
pnpm mobile:sync          # 同步 Web 构建产物至 Android / iOS 工程
pnpm --filter @music-room/mobile open:android  # 在 Android Studio 中打开
pnpm --filter @music-room/mobile open:ios      # 在 Xcode 中打开

# 质量与部署检查
pnpm lint                 # ESLint 代码检查
pnpm check:toolchain      # 校验 Node.js 与 pnpm 版本
pnpm deploy:check         # 部署前置环境检查
```

`pnpm e2e` 会启动真实 server + web、清理隔离的 Redis 数据库，并要求 Redis 可连接到 `redis://127.0.0.1:6379/15`（也可通过 `REDIS_URL` 覆盖）。`pnpm check:toolchain` 会强制校验 Node.js 22.x 与 pnpm 10.x。完整依赖和迁移流程见[本地开发环境](./docs/engineering/setup.md)。

## Web Origin 配置

- Web 默认使用当前页面 origin，不需要把生产域名硬编码进仓库。
- `NEXT_PUBLIC_API_BASE_URL` 和 `NEXT_PUBLIC_WS_URL` 可指向独立部署的服务端。

## Cloudflare Turnstile

登录和注册页使用 Cloudflare Turnstile 防刷。开发环境默认关闭；生产环境启动时会强制要求开启并校验服务端密钥。

在 Cloudflare Turnstile 控制台创建站点后，把以下变量写入环境文件：

- `TURNSTILE_ENABLED=true`
- `TURNSTILE_SITE_KEY`：站点公钥
- `TURNSTILE_SECRET_KEY`：服务端密钥，只配置在 API 服务端

验证请求由 API 服务端发送到 Cloudflare，前端不会接触 `TURNSTILE_SECRET_KEY`。修改生产环境变量后需要重启 `server` 容器。

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

### 可选平台 Provider

当前 provider API 支持网易云和 QQ 音乐，`.env.example` 默认关闭。启用 provider 时需要同时设置服务端开关和前端构建开关；生产环境还需要合法的 32 字节 hex 或 base64 Cookie 加密密钥。平台凭证只在服务端加密保存，导入音频不会作为服务端曲库长期保存。

- 网易云：`NETEASE_ENABLED`、`NETEASE_COOKIE_ENCRYPTION_KEY`、`NEXT_PUBLIC_NETEASE_ENABLED`
- QQ 音乐：`QQMUSIC_ENABLED`、`QQMUSIC_COOKIE_ENCRYPTION_KEY`、`NEXT_PUBLIC_QQMUSIC_ENABLED`

## 连接与播放诊断

成员页的诊断面板会输出：

- offer/answer/candidate 信令事件
- 控制与媒体连接、ICE 状态
- `playbackAssetId`、媒体会话 key、源 peer 和源拥有者状态
- AudioContext、已缓冲/已调度音频、underrun 和解码错误
- Limiter peak/RMS、RTP bitrate、jitter、丢包和编码信息
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

生产环境支持多端发布矩阵：

- **Web 与服务端**：通过 `Dockerfile.web`、`Dockerfile.server` 和 `deploy/linux` 中的 Compose 配置进行容器化发布与部署
- **桌面端**：使用 `pnpm desktop:build` 生成各平台原生安装包
- **移动端**：使用 `pnpm mobile:sync` 同步构建后，通过 Android Studio 打包 APK / AAB，或通过 Xcode 打包 iOS 应用

## 当前已知边界

- 播放依赖实时信令和曲目拥有者客户端在线（拥有者是唯一媒体源）
- Redis 不可用时，依赖 Realtime 的播放控制请求会失败
- 本地上传曲目在拥有者离线时会暂停；provider 曲目支持监听端 offline fallback 继续播放
- 生产部署服务端仍限制为单个 server 实例，多实例房间权威尚未完成
- 网易云能力依赖上游接口、用户登录态、歌曲版权和可用音质；网易云临时音频地址不会写入房间状态
- QQ 音乐能力同样依赖上游接口、登录态、版权和可用音质；平台 provider 不保证所有歌曲都能导入
- 浏览器级长时间 WebRTC 测试和统一生产观测能力仍在继续补强

## License

[MIT](./LICENSE)
