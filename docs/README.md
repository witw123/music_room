# 文档总览

最后更新：`2026-07-23`
当前版本：`0.2.8`

## 当前项目现状

Music Room 是一套围绕“本地音乐多人同步播放”构建的 Web 应用：

- Next.js Web 前端
- NestJS API / Socket.IO 服务端
- PostgreSQL、Redis、coturn 生产依赖
- 本地 IndexedDB 个人上传资源、provider 导入资源和分段 Opus 播放资产
- 单一 Segmented Opus/WebRTC RTP 媒体链路
- 官网展示入口 `/` 与客户端入口 `/app`
- `/app/search`、`/app/playlists`、`/app/favorites`、`/app/profile` 和 `/app/settings` 工作区

服务端只保存账号、房间、队列、播放状态和音频元数据，不保存音频文件。房间不提供缓存下载、音频资产互传或房间级缓存同步。IndexedDB 用于恢复当前用户自己上传或 provider 导入的歌曲及其本地生成的资产。

当前房间 UI 为：

- `曲库`
- `我的歌单`
- `成员与诊断`

共享队列由房间舞台和持久化播放器管理；房间内的“我的歌单”用于本地歌单、网络歌单和 provider 曲目导入。

## 先看哪几页

- 当前状态：[engineering/status.md](./engineering/status.md)
- 整体架构：[architecture/overview.md](./architecture/overview.md)
- 本地存储仓库设计：[architecture/local-storage.md](./architecture/local-storage.md)
- 播放同步：[architecture/playback-sync.md](./architecture/playback-sync.md)
- 实时链路：[architecture/realtime.md](./architecture/realtime.md)
- TURN 网络检查：[deploy/turn-network-checklist.md](./deploy/turn-network-checklist.md)
- 测试策略：[engineering/testing.md](./engineering/testing.md)
- 工程路线：[engineering/roadmap.md](./engineering/roadmap.md)
- 接口文档总览：[api/README.md](./api/README.md)
- REST API：[api/rest.md](./api/rest.md)
- WebSocket 事件：[api/websocket-events.md](./api/websocket-events.md)
- 共享模型：[api/shared-models.md](./api/shared-models.md)
- 测试场景手册：[api/testing-playbook.md](./api/testing-playbook.md)
- 部署说明：[deployment/deployment.md](./deployment/deployment.md)

`refactor/` 下的文档是重构记录或历史提案，除已明确标注“已完成”的播放迁移记录外，不代表当前实现。

## 当前唯一播放链路

```text
IndexedDB 分段 Opus
  -> SegmentedOpusEngine
  -> 共享 AudioContext 输出总线
  -> MediaStreamAudioDestinationNode
  -> WebRTC RTP Opus
  -> 监听端单一 audio.srcObject
```

源端和监听端共享中性的媒体会话身份。成员加入、presence 更新、普通快照、队列刷新和本地音量变化不会重建媒体会话；只有切歌、source peer 变化、媒体连接彻底重建或退出房间才改变/释放输出 Track。

## 重要说明

### Web 默认使用当前页面同源

Web 前端默认使用当前页面 origin，不需要把生产域名硬编码进仓库。

### 当前工程阶段是“可用 + 加固”

核心用户链路已经跑通，当前主要工作集中在单实例发布稳态、真实 WebRTC/Media 集成测试、长时间播放验证、真实设备音频观测和统一生产告警能力。

### 诊断面板是媒体排障入口

“成员与诊断”页用于区分信令、ICE、媒体 RTP、AudioContext、播放缓冲和 Track 绑定问题。诊断重点包括：

- `audioContextState`
- `playbackAssetId` / `mediaSessionKey`
- `outputTrackId` / `remoteTrackId`
- `bufferedAheadMs` / `scheduledAheadMs`
- underrun、limiter peak/RMS、RTP bitrate、jitter 和 packet loss

### Docker Nginx 配置边界

`deploy/linux/nginx/music-room.conf` 中的 `web:3000` 和 `server:3001` upstream 只适用于 Docker 网络。宿主机部署时必须改为本机地址，例如 `127.0.0.1:3000` 和 `127.0.0.1:3001`。
