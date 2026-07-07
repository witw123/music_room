# Docs

最后更新：`2026-07-07`
当前版本：`0.2.8`

## 当前项目现状

Music Room 现在是一套围绕“本地音乐多人同步播放”构建的完整应用，已经包含：

- Next.js Web 前端
- NestJS API / Socket.IO 服务端
- Tauri 2 桌面壳
- Capacitor Android 壳
- PostgreSQL、Redis、coturn 的生产依赖
- P2P 分片同步和渐进式本地播放
- 官网展示入口 `/` 与客户端入口 `/app`
- 桌面端和 Android 端的软件内检查更新

当前房间 UI 默认是：

- `共享队列`
- `曲库`
- `缓存`
- `成员与诊断`

歌单后端能力仍保留，但房间中的歌单区域当前已默认隐藏。

工程重构记录见 [refactor/README.md](./refactor/README.md)。

## 先看哪几页

- 当前状态：[engineering/status.md](./engineering/status.md)
- 测试策略：[engineering/testing.md](./engineering/testing.md)
- 工程路线：[engineering/roadmap.md](./engineering/roadmap.md)
- 接口文档总览：[api/README.md](./api/README.md)
- 整体架构：[architecture/overview.md](./architecture/overview.md)
- 播放同步：[architecture/playback-sync.md](./architecture/playback-sync.md)
- P2P 分发：[architecture/p2p-distribution.md](./architecture/p2p-distribution.md)
- 部署说明：[deployment/deployment.md](./deployment/deployment.md)
- REST API：[api/rest.md](./api/rest.md)
- WebSocket 事件：[api/websocket-events.md](./api/websocket-events.md)
- 共享模型：[api/shared-models.md](./api/shared-models.md)
- 测试场景手册：[api/testing-playbook.md](./api/testing-playbook.md)

## 重要说明

### 1. Web 不再需要硬编码生产域名

- Web 前端默认走当前页面同源
- 桌面端和移动端打包时需要注入 `MUSIC_ROOM_PUBLIC_ORIGIN`
- 如果缺失该变量，客户端打包现在会直接失败，而不是静默产出指向 `example.com` 的坏包
- `0.2.8` 官方客户端打包口径统一为 `https://musicroom.witw.top`

### 1.5. 当前工程阶段是“可用 + 加固”

- 核心用户链路已经跑通，不再是 PoC
- 当前主要工作集中在多实例稳态、真实 WebRTC / Media 集成测试和统一观测能力
- 文档中的“未完成”项优先理解为工程加固，而不是产品完全不可用

### 1.6. 客户端更新策略

- 桌面端使用 Tauri updater 检查 `latest.json`，发现新版后提示用户下载并安装
- Android 端检查 GitHub 最新 Release，发现新版 APK 后提示用户前往下载
- Web 浏览器访问 `/app` 时不走安装包更新流程，直接使用当前部署的 Web 版本

### 2. Docker 配置不能直接当宿主机 Nginx 配置用

`deploy/linux/nginx/music-room.conf` 里的 upstream 是：

- `web:3000`
- `server:3001`

这是给 Docker 网络用的，不是给宿主机直部署用的。宿主机部署时必须改成 `127.0.0.1:3000` 和 `127.0.0.1:3001` 之类的本机地址。

### 3. 诊断面板现在是核心排障入口

房间里的“成员与诊断”页已经能直接观察：

- P2P data channel 连接状态
- ICE 状态
- 分片可用性与请求状态
- 当前播放源
- 本地缓冲和调度策略

线上排障时，优先看这页，而不是先猜播放器代码。
