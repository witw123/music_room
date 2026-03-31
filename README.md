# Music Room

[![Release](https://img.shields.io/github/v/release/witw123/music_room)](https://github.com/witw123/music_room/releases)
[![License](https://img.shields.io/github/license/witw123/music_room)](./LICENSE)
[![Node](https://img.shields.io/badge/Node.js-22.x-339933)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220)](https://pnpm.io/)

Music Room 是一个面向多人同步听歌场景的音乐房应用。

它的目标不是做一个泛聊天社区，而是把“同一时间、同一首歌、同一条共享队列”这件事做得更稳定、更自然。用户可以创建房间、邀请他人加入、共享播放队列、导入本地音乐，并在同一个房间里保持实时同步的播放体验。

项目采用 Monorepo 结构，包含：

- `apps/web`：官网展示页与 Web 前端
- `apps/server`：NestJS 后端服务与实时通信
- `apps/desktop`：Tauri 桌面应用
- `apps/mobile`：Capacitor 移动端壳
- `packages/shared`：前后端共享类型与协议

## 项目特点

- 以“房间”为核心组织多人听歌体验，而不是以聊天流为核心
- 支持账号体系、房间创建、邀请码加入、最近房间恢复
- 支持共享播放队列、房主控制、多人同步播放
- 支持导入本地音频文件，围绕本地音乐做协作播放
- 支持桌面端、移动端与服务端共用同一套后端能力

## 适合的使用场景

- 和朋友一起听同一张专辑或同一条播放列表
- 在小型社区、社群、学习空间里做同步背景音乐
- 围绕本地收藏音乐做共享播放，而不是依赖单一流媒体平台
- 在桌面端长时间开房，在移动端快速回到正在进行的房间

## 当前形态

- 浏览器默认访问官网展示页
- 登录、房间、同步播放等主要功能承载在应用端
- 桌面端与移动端安装包发布在 [GitHub Releases](https://github.com/witw123/music_room/releases)

当前发布物包括：

- Windows `.exe` / `.msi`
- macOS `.dmg`
- Linux `.AppImage` / `.deb` / `.rpm`
- Android `.apk`

## 技术栈

- 前端：Next.js 15、React 19、TypeScript、Tailwind CSS、Socket.IO Client
- 后端：NestJS 11、Prisma 6、PostgreSQL、Redis、Socket.IO
- 桌面端：Tauri 2、Rust
- 移动端：Capacitor
- 工程化：pnpm workspace、Turborepo、GitHub Actions

## 快速开始

### 环境要求

- Node.js 22.x
- pnpm 10.x
- PostgreSQL
- Redis
- Rust 与 Cargo
- Android SDK
  仅在本地构建 Android 安装包时需要

### 安装与启动

```bash
pnpm install
cp .env.example .env
pnpm dev
```

默认地址：

- Web: `http://localhost:3000`
- Server: `http://localhost:3001`
- Health Check: `http://localhost:3001/health`

### 常用命令

```bash
pnpm dev
pnpm build
pnpm typecheck
pnpm pack:desktop
pnpm pack:mobile
```

## 环境变量与连接

前端通过以下环境变量连接后端：

- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_WS_URL`
- `NEXT_PUBLIC_SOCKET_PATH`

登录成功后返回的 `token` 会同时用于：

- REST 请求头 `x-session-token`
- Socket.IO 握手参数 `auth.sessionToken`

推荐的同域部署配置：

```env
NEXT_PUBLIC_API_BASE_URL=https://witw.top
NEXT_PUBLIC_WS_URL=wss://witw.top
NEXT_PUBLIC_SOCKET_PATH=/ws/socket.io
CORS_ORIGINS=https://witw.top
```

## 多端说明

- Web：默认访问 `https://witw.top/`
- Desktop：开发环境加载 `http://localhost:3000/app?client=desktop`，生产环境加载 `https://witw.top/app?client=desktop`
- Mobile：当前连接 `https://witw.top/app?client=mobile`

## 部署

项目提供 Linux 部署模板与说明：

- [deploy/linux](./deploy/linux)
- [docs/deployment/deployment.md](./docs/deployment/deployment.md)

生产环境建议使用 Nginx 做同域反向代理：

- `/` 转发到 Web 前端
- `/v1/` 转发到 REST API
- `/ws/socket.io` 转发到 Socket.IO

## 目录结构

```text
music-room/
├─ apps/
│  ├─ web/
│  ├─ server/
│  ├─ desktop/
│  └─ mobile/
├─ packages/
├─ docs/
├─ deploy/
└─ scripts/
```

## License

[MIT](./LICENSE)
