# Music Room

[![Release](https://img.shields.io/github/v/release/witw123/music_room)](https://github.com/witw123/music_room/releases)
[![License](https://img.shields.io/github/license/witw123/music_room)](./LICENSE)
[![Node](https://img.shields.io/badge/Node.js-22.x-339933)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220)](https://pnpm.io/)

Music Room 是一个面向多人在线听歌场景的音乐房间项目，提供房间、播放队列、歌单、聊天与实时同步能力，同时支持 Electron 桌面端作为前端壳使用。

项目采用 Monorepo 结构，包含 Web 前端、NestJS 后端与 Electron 桌面端。系统以 Web 为核心形态，服务端负责会话、房间、播放状态与实时信令协调，客户端负责音频选择、播放与缓存。

## 下载

- Windows 安装包：前往 [Releases](https://github.com/witw123/music_room/releases) 下载

## 功能特性

- 用户注册、登录、会话保持
- 创建房间、加入房间、恢复最近房间
- 房主控制播放与队列同步
- 本地音频导入与曲目信息注册
- 歌单创建、编辑、删除、导入房间
- 房间聊天与实时状态同步
- Electron 桌面端文件选择、外链打开、版本读取等系统能力

## 技术栈

- 前端：Next.js 15、React 19、TypeScript、Tailwind CSS、Zustand、Socket.IO Client
- 后端：NestJS 11、Prisma 6、PostgreSQL、Redis、Socket.IO
- 桌面端：Electron 35、esbuild、electron-builder
- 工程基础设施：pnpm workspace、Turborepo

## 快速开始

### 环境要求

- Node.js 22.x
- pnpm 10.x
- PostgreSQL 可选
- Redis 可选

### 安装与启动

```bash
pnpm install
cp .env.example .env
pnpm dev
```

默认地址：

- 前端：`http://localhost:3000`
- 后端：`http://localhost:3001`
- 健康检查：`http://localhost:3001/health`

### 常用命令

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm build:desktop
pnpm pack:desktop
```

## 前后端连接

- REST 请求使用 `NEXT_PUBLIC_API_BASE_URL`
- 实时连接使用 `NEXT_PUBLIC_WS_URL + NEXT_PUBLIC_SOCKET_PATH`
- 登录后返回的会话 `token` 同时用于：
  - REST 请求头 `x-session-token`
  - Socket.IO 握手参数 `auth.sessionToken`

同域部署时推荐配置：

```env
NEXT_PUBLIC_API_BASE_URL=https://witw.top
NEXT_PUBLIC_WS_URL=wss://witw.top
NEXT_PUBLIC_SOCKET_PATH=/ws/socket.io
CORS_ORIGINS=https://witw.top
```

## 桌面端

桌面端当前定位为前端壳：

- 开发模式加载本地 Web 前端
- 生产模式加载远程前端地址
- 不内置本地 Next.js runtime
- 不内置本地后端服务

当前生产环境默认前端地址：

```text
https://witw.top
```

桌面端打包：

```bash
pnpm pack:desktop
```

打包产物输出到：

```text
apps/desktop/release/
```

## 部署

项目提供 Linux Docker 部署模板，详见：

- [deploy/linux](./deploy/linux)
- [docs/deployment/deployment.md](./docs/deployment/deployment.md)

生产环境建议通过 Nginx 同域反向代理：

- `/` 转发到 Web 前端
- `/v1/` 转发到后端 REST
- `/ws/socket.io` 转发到后端 Socket.IO

## 目录结构

```text
music-room/
├── apps/
│   ├── web/
│   ├── server/
│   └── desktop/
├── packages/
│   ├── shared/
│   ├── ui/
│   └── config-*
├── docs/
├── deploy/
└── scripts/
```

## 许可证

本项目基于 [MIT License](./LICENSE) 开源。
