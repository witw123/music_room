# 整体架构

最后更新：`2026-07-11`

## 组件划分

### `apps/web`

- Next.js 15 前端
- 提供首页、`/app` 网页工作区、房间页和播放器 UI
- 负责：
  - 登录注册
  - 房间和队列交互
  - 本地音频导入
  - WebSocket 订阅
  - WebRTC Data / Media 建链
  - IndexedDB 分片缓存
  - 渐进式本地播放与诊断面板

### `apps/server`

- NestJS 服务端
- 提供：
  - REST API
  - Socket.IO 信令网关
  - 房间、队列、播放、歌单服务
  - TURN 短期 ICE 配置下发

### `packages/shared`

- 前后端共享的 Zod schema 和类型
- 包含：
  - `AuthSession`
  - `RoomSnapshot`
  - `PlaybackSnapshot`
  - `TrackMeta`
  - `TrackAvailabilityAnnouncement`
  - WebSocket payload

## 服务依赖

- PostgreSQL：账号、房间、歌单等持久化数据
- Redis：房间 patch 广播、presence、跨实例状态协作
- coturn：WebRTC 中继
- Nginx：Web / API / WebSocket 反代

## 当前主流程

1. 用户通过 `POST /v1/auth/register` 或 `POST /v1/auth/login` 获取会话
2. 用户从 `/app` 进入网页工作区，创建房间或按房间码加入房间
3. 前端拿到 `RoomSnapshot` 后建立 Socket.IO 订阅
4. 浏览器通过 `room.subscribe` 绑定 `roomId + sessionId + peerId`
5. 服务端通过：
   - `room.snapshot`
   - `room.playback.patch`
   - `room.queue.patch`
   - `room.presence.patch`
   - `room.library.patch`
   广播房间变化
6. 成员之间通过：
   - `peer.signal`
   - `piece.availability`
   建立 WebRTC data channel 并交换分片
7. 网页端根据缓存和浏览器能力选择播放源：
   - `progressive-local`
   - `full-local`

## 房间在线与重连

- 前端会定期发送 `room.presence`
- 服务端在线 presence TTL 当前为 `60s`
- WebSocket 断线后有 `25s` 宽限期，期间同一成员重连会取消延迟清理

## 当前 UI 状态

- 房间工作区当前默认是四个主页签：
  - `共享队列`
  - `曲库`
  - `缓存`
  - `成员`
- 歌单后端能力仍存在，但房间中的歌单区域当前已默认隐藏
