# Music Room

一个面向多人在线听歌场景的音乐房间项目。

Music Room 以 Web 为主形态，提供房间、播放队列、歌单、实时同步、聊天与桌面壳能力。项目采用 Monorepo 结构，前端基于 Next.js，后端基于 NestJS，桌面端基于 Electron。

## 下载

- Windows 安装包请前往 [GitHub Releases](https://github.com/witw123/music_room/releases) 页面下载

## 项目简介

Music Room 的目标不是把音频流量全部压到服务端，而是让服务端主要负责：

- 用户会话与身份认证
- 房间与成员管理
- 播放状态与队列同步
- WebSocket / WebRTC 信令协调
- 歌单与曲目信息管理

客户端负责音频选择、播放、缓存与部分点对点能力，尽量降低服务端媒体分发压力。

当前仓库包含三部分应用：

- `apps/web`：Web 前端
- `apps/server`：后端服务
- `apps/desktop`：Electron 桌面壳

## 核心功能

- 用户注册、登录、会话保持
- 创建房间、加入房间、按邀请码加入、恢复最近房间
- 房间成员同步、房主控制播放
- 播放队列管理：添加、删除、重排
- 本地音频导入与曲目信息注册
- 歌单创建、编辑、删除、导入房间
- 房间聊天
- Socket.IO 实时同步
- 桌面端文件选择、外链打开、版本读取等系统能力

## 技术栈

### 前端

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS
- Zustand
- Socket.IO Client
- Dexie

### 后端

- NestJS 11
- Prisma 6
- PostgreSQL
- Redis
- Socket.IO

### 桌面端

- Electron 35
- esbuild
- electron-builder

### 工程基础设施

- pnpm workspace
- Turborepo

## 仓库结构

```text
music-room/
├── apps/
│   ├── web/                Web 前端
│   ├── server/             后端服务
│   └── desktop/            Electron 桌面壳
├── packages/
│   ├── shared/             前后端共享类型与协议
│   ├── ui/                 共享 UI 组件
│   └── config-*            工程配置
├── docs/                   项目文档
├── deploy/                 部署模板
└── scripts/                工具脚本
```

## 本地开发

### 环境要求

- Node.js 22.x
- pnpm 10.x
- PostgreSQL 可选
- Redis 可选

未配置 PostgreSQL 或 Redis 时，部分能力会降级，但项目可用于本地开发和演示。

### 安装依赖

```bash
pnpm install
```

### 初始化环境变量

```bash
cp .env.example .env
```

### 启动全部应用

```bash
pnpm dev
```

默认地址：

- 前端：`http://localhost:3000`
- 后端：`http://localhost:3001`
- 健康检查：`http://localhost:3001/health`

### 分应用启动

```bash
pnpm --filter @music-room/web dev
pnpm --filter @music-room/server dev
pnpm --filter @music-room/desktop dev
```

## 常用命令

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm build:desktop
pnpm pack:desktop
```

## 环境变量说明

完整示例见 [`.env.example`](./.env.example)。

常用变量如下：

- `PORT`：后端端口
- `DATABASE_URL`：PostgreSQL 连接串
- `REDIS_URL`：Redis 连接串
- `JWT_SECRET`：认证密钥
- `CORS_ORIGINS`：后端允许的前端来源，多个值用逗号分隔
- `NEXT_PUBLIC_API_BASE_URL`：前端访问后端 REST 的地址
- `NEXT_PUBLIC_WS_URL`：前端访问后端 Socket.IO 的地址
- `NEXT_PUBLIC_SOCKET_PATH`：Socket.IO 路径，默认 `/ws/socket.io`
- `MUSIC_ROOM_DESKTOP_RENDERER_URL`：桌面端生产环境加载的前端地址

## 前后端连接方式

前端与后端的连接规则如下：

- REST 请求走 `NEXT_PUBLIC_API_BASE_URL`
- 实时连接走 `NEXT_PUBLIC_WS_URL + NEXT_PUBLIC_SOCKET_PATH`
- 登录成功后返回的会话 `token` 同时用于：
  - REST 请求头 `x-session-token`
  - Socket.IO 握手参数 `auth.sessionToken`

如果前后端同域部署，例如 `https://witw.top`，推荐配置：

```env
NEXT_PUBLIC_API_BASE_URL=https://witw.top
NEXT_PUBLIC_WS_URL=wss://witw.top
NEXT_PUBLIC_SOCKET_PATH=/ws/socket.io
CORS_ORIGINS=https://witw.top
```

## 桌面端说明

桌面端当前定位为“前端壳”，而不是独立离线客户端。

### 当前行为

- 开发模式加载本地 Web 前端
- 生产安装包默认加载远程前端地址
- 不内置 NestJS 后端
- 不内置本地 Next.js 运行时

当前默认生产地址已配置为：

```text
https://witw.top
```

### 桌面端开发

```bash
pnpm --filter @music-room/server dev
pnpm --filter @music-room/web dev
pnpm --filter @music-room/desktop dev
```

### 桌面端打包

```bash
pnpm pack:desktop
```

打包产物输出到：

```text
apps/desktop/release/
```

如果需要临时指定其他前端地址：

```bash
set MUSIC_ROOM_DESKTOP_RENDERER_URL=https://your-domain.com
pnpm pack:desktop
```

## 部署说明

项目提供 Linux Docker 部署模板，位于：

- [deploy/linux](./deploy/linux)
- [docs/deployment/deployment.md](./docs/deployment/deployment.md)

生产环境建议：

- 前端与后端通过 Nginx 同域反向代理
- `/` 转发到 Web 前端
- `/v1/` 转发到后端 REST
- `/ws/socket.io` 转发到后端 Socket.IO

如果使用当前仓库默认生产配置，域名为：

```text
witw.top
```

## 发布建议

作为 GitHub 正式发版项目，建议每次发布至少包含以下内容：

- 更新版本号
- 补充本次变更说明
- 确认 `pnpm build` 通过
- 确认桌面端安装包可生成
- 确认生产环境变量与域名配置一致
- 在 Release 中附带安装包与更新说明

## 自动发版

仓库已配置 GitHub Actions 自动发布桌面安装包。

当你推送版本标签后，GitHub 会自动：

- 在 Windows 环境安装依赖
- 构建桌面端安装包
- 创建或更新对应版本的 GitHub Release
- 上传 `.exe` 与 `.blockmap` 产物

示例：

```bash
git tag v0.1.0
git push origin v0.1.0
```

工作流文件位于：

- [release-desktop.yml](./.github/workflows/release-desktop.yml)

## 开发规范

- 共享类型优先放在 `packages/shared`
- 不要在前后端重复定义相同 DTO
- WebSocket 事件命名采用 `domain.action`
- 提交前至少执行：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## 后续计划

- 完善桌面端图标与安装体验
- 增强错误监控与日志采集
- 增强播放同步与弱网恢复能力
- 完善组件测试与端到端测试
- 优化部署文档与自动化发布流程

## 许可证

本项目基于 [MIT License](./LICENSE) 开源。
