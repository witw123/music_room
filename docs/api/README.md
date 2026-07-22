# 接口文档

最后更新：`2026-07-23`
当前版本：`0.2.8`

## 适用范围

这套文档面向前后端联调、功能测试、回归测试和浏览器接入服务端时的协议核对，覆盖：

- REST API
- Socket.IO 事件
- 共享模型与版本字段
- 播放媒体会话和 WebRTC 诊断
- NetEase / QQ Music provider 账号、搜索、歌单、专辑和导入接口
- Web 测试入口与前置条件

## 测试环境基线

- Web：`http://localhost:3000`
- Server：`http://localhost:3001`
- Health：`http://localhost:3001/health`
- Socket.IO path：`/ws/socket.io`

本地启动：

```bash
pnpm install
cp .env.example .env
pnpm dev
```

依赖：Node.js `22.x`、pnpm `10.x`、PostgreSQL、Redis。

## 认证与网页入口

- REST 和 Socket.IO 共用同一登录态
- `AuthSession.token` 用于 REST `x-session-token` 和 Socket.IO `auth.sessionToken`
- Web 默认使用当前页面同源
- `/` 是官网展示页，`/app` 是客户端工作区，`/auth` 是登录页，`/rooms` 是房间入口
- `/app/search`、`/app/playlists`、`/app/favorites`、`/app/profile` 和 `/app/settings` 是工作区子页面

## 文档阅读顺序

1. [REST API](./rest.md)
2. [WebSocket 事件](./websocket-events.md)
3. [共享模型](./shared-models.md)
4. [测试场景手册](./testing-playbook.md)

## 当前实现需要特别注意的地方

- `room.snapshot` 是权威状态，patch 只做增量优化
- 播放控制依赖 Realtime 可用，Redis 故障时会直接失败
- 曲目上传请求同步元数据和资产清单，音频文件本体保留在上传者浏览器
- IndexedDB 只保存当前用户自己的上传资产
- WebRTC `music-room-control` DataChannel 只承载控制/健康协调；音频通过独立 RTP Opus 媒体 Track
- 房间不提供音频资产下载、成员间缓存同步或播放 fallback
- 成员与诊断页面用于查看 AudioContext、buffer、underrun、limiter、RTP、ICE 和 Track identity
- 房间工作区当前使用 `Library / My Playlists / Members`；共享队列由房间状态和播放器承载
