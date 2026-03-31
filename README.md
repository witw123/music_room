# Music Room

[![Release](https://img.shields.io/github/v/release/witw123/music_room)](https://github.com/witw123/music_room/releases)
[![License](https://img.shields.io/github/license/witw123/music_room)](./LICENSE)
[![Node](https://img.shields.io/badge/Node.js-22.x-339933)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220)](https://pnpm.io/)

Music Room 是一个面向多人在线听歌场景的房间式应用，提供房间协作、播放队列、歌单管理、聊天互动与实时同步能力。项目采用 Monorepo 结构，包含 Web 前端、NestJS 后端，以及用于分发的桌面端和 Android 客户端外壳。

## 下载

- Windows / macOS / Linux / Android 安装包：前往 [Releases](https://github.com/witw123/music_room/releases)

## 功能特性

- 支持用户注册、登录与会话保持
- 支持创建房间、加入房间和恢复最近房间
- 支持房主控制播放、房间成员实时同步
- 支持本地音频导入、播放队列和歌单管理
- 支持房间聊天与状态广播
- 支持 Web、桌面端和 Android 客户端接入同一套后端服务

## 技术栈

- 前端：Next.js 15、React 19、TypeScript、Tailwind CSS、Zustand、Socket.IO Client
- 后端：NestJS 11、Prisma 6、PostgreSQL、Redis、Socket.IO
- 桌面端：Electron、esbuild、electron-builder
- 移动端：Capacitor Android
- 工程化：pnpm workspace、Turborepo、GitHub Actions

## 快速开始

### 环境要求

- Node.js 22.x
- pnpm 10.x
- PostgreSQL
- Redis
- Android SDK（仅在本地构建 Android 安装包时需要）

### 安装与启动

```bash
pnpm install
cp .env.example .env
pnpm dev
```

默认地址：

- Web：`http://localhost:3000`
- Server：`http://localhost:3001`
- Health Check：`http://localhost:3001/health`

### 常用命令

```bash
pnpm dev
pnpm build
pnpm typecheck
pnpm pack:desktop
pnpm pack:mobile
```

执行 `pnpm pack:mobile` 前，需要先正确配置本机 `ANDROID_HOME` 或 Android SDK。

## 前后端连接

- REST API 基地址由 `NEXT_PUBLIC_API_BASE_URL` 提供
- WebSocket 基地址由 `NEXT_PUBLIC_WS_URL` 提供
- Socket.IO 路径由 `NEXT_PUBLIC_SOCKET_PATH` 提供
- 登录成功后返回的 `token` 同时用于 REST 请求头 `x-session-token` 与 Socket.IO 握手参数 `auth.sessionToken`

推荐的同域部署配置：

```env
NEXT_PUBLIC_API_BASE_URL=https://witw.top
NEXT_PUBLIC_WS_URL=wss://witw.top
NEXT_PUBLIC_SOCKET_PATH=/ws/socket.io
CORS_ORIGINS=https://witw.top
```

## 客户端说明

- Web：核心使用形态，直接通过浏览器访问
- Desktop：Electron 前端壳，生产环境默认加载 `https://witw.top`
- Android：Capacitor 前端壳，当前同样连接 `https://witw.top`

当前 GitHub Release 已支持自动上传：

- Windows `.exe`
- macOS `.dmg`
- Linux `.AppImage`
- Android `.apk`

## 部署

项目提供 Linux 部署模板与说明：

- [deploy/linux](./deploy/linux)
- [docs/deployment/deployment.md](./docs/deployment/deployment.md)

生产环境建议使用 Nginx 进行同域反向代理：

- `/` 转发到 Web 前端
- `/v1/` 转发到后端 REST API
- `/ws/socket.io` 转发到后端 Socket.IO 服务

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

## 许可证

本项目基于 [MIT License](./LICENSE) 开源。
