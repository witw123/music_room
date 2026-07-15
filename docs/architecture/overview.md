# 整体架构

最后更新：`2026-07-15`

## 组件划分

### `apps/web`

- Next.js 15 前端，提供网页工作区、房间页和播放器 UI
- 负责账号、房间、队列、WebSocket、WebRTC Data/Media、IndexedDB 资产缓存
- 播放只使用分段 Opus 引擎和 WebRTC RTP 输出

### `apps/server`

- NestJS 服务端，提供 REST API、Socket.IO 信令、房间/队列/播放服务和 TURN 配置
- 服务端保存播放权威状态和音频元数据，不保存音频文件

### `packages/shared`

- 前后端共享的 Zod schema 和类型
- 包含 `RoomSnapshot`、`PlaybackSnapshot`、资产传输协议和 WebRTC 诊断模型

## 播放主流程

```text
IndexedDB 分段 Opus
  -> SegmentedOpusEngine
  -> 共享 AudioContext 输出总线
  -> MediaStreamAudioDestinationNode
  -> WebRTC RTP Opus
  -> 监听端单一 audio.srcObject
```

房间普通快照、presence、成员变化、队列刷新和音量变化不会重建媒体会话。只有切换 source peer、离开房间或媒体会话彻底重建时才释放输出 Track。

## 基础设施

- PostgreSQL：账号、房间、歌单和播放权威状态
- Redis：房间 patch、presence 和跨实例协作
- coturn：WebRTC 中继
- Nginx：Web、API、WebSocket 反代
