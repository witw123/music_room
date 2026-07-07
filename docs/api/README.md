# 接口文档

最后更新：`2026-07-07`
当前版本：`0.2.8`

## 适用范围

这套文档面向：

- 前后端联调
- 功能测试
- 回归测试
- 桌面壳 / Android 壳接入同一套服务端时的协议核对

它覆盖的是“整个项目的可测试契约”：

- REST API
- Socket.IO 事件
- 共享模型与版本字段
- Web / 桌面壳 / Android 壳的测试入口与前置条件

## 测试环境基线

- Web：`http://localhost:3000`
- Server：`http://localhost:3001`
- Health：`http://localhost:3001/health`
- Socket.IO 基址：`http://localhost:3001`
- Socket.IO path：`/ws/socket.io`

本地启动基线：

```bash
pnpm install
cp .env.example .env
pnpm dev
```

依赖：

- Node.js `22.x`
- pnpm `10.x`
- PostgreSQL
- Redis

## 认证与客户端形态

- REST 和 WebSocket 共用同一登录态
- 登录后把 `AuthSession.token` 放到：
  - REST：`x-session-token`
  - Socket.IO：`auth.sessionToken` 或 `x-session-token` header
- Web 前端默认走当前页面同源
- 桌面壳和 Android 壳测试时，本质上是在访问同一套后端接口，只是入口不同
- 桌面壳 / Android 壳的远端入口依赖 `MUSIC_ROOM_PUBLIC_ORIGIN`

## 页面与测试入口

- `/`：官网展示页，不作为主要联调入口
- `/app`：客户端工作区入口，适合从这里开始联调
- `/auth`：登录页
- `/rooms`：房间与最近房间入口
- `/room/{roomId}`：房间内页面

## 文档阅读顺序

1. [REST API](./rest.md)
2. [WebSocket 事件](./websocket-events.md)
3. [共享模型](./shared-models.md)
4. [测试场景手册](./testing-playbook.md)

## 当前实现需要特别注意的地方

- 这套文档以当前代码状态为准，不补写不存在的错误码规范
- 认证接口有明确限流；播放控制也有限流
- 播放控制依赖 Realtime 可用，Redis 故障时会直接失败
- 房间、队列、歌单相关的一部分业务错误当前仍是未包装异常，测试时应记录现实现状
- 曲目上传当前只上传元数据，不上传音频文件本体
- `room.snapshot` 是权威状态；patch 只做增量优化
