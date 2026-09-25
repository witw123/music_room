# 整体架构

最后更新：`2026-09-24`

## 组件划分

### `apps/web`

- Next.js 15 前端，提供网页工作区、房间页、工程级说明页与播放器 UI
- 负责账号、房间、队列、Socket.IO、WebRTC 控制/媒体连接和 IndexedDB 个人本地资产
- 播放采用分段 Opus 引擎、统一 AudioContext 输出总线和 WebRTC RTP 直连输出

### `apps/desktop`

- Tauri 2 跨平台桌面客户端（Rust + Web）
- 集成 Windows SMTC（系统媒体传输控制）/ macOS Now Playing / Linux MPRIS 原生媒体通知与硬件多媒体快捷键
- 支持独立透明置顶的桌面悬浮歌词窗口与原生更新检查

### `apps/mobile`

- Capacitor 7 移动原生包装工程（Android / iOS）
- 集成 Android 原生 MediaSession 与前台播放服务，支持系统通知栏/锁屏控件与后台持续音频播放
- 深度适配 Android 返回键优先级栈（浮层 -> 房间 -> 防误触退出）

### `apps/server`

- NestJS 服务端，提供 REST API、Socket.IO 信令网关、房间/队列/播放权威协调和短期 TURN 配置下发
- 服务端仅保存播放权威基准时钟和音频元数据，不持久化任何音频文件
- 网易云音乐、QQ 音乐和 B 站（哔哩哔哩）provider 只在取流和导入阶段短暂代理音频流，导入完成后完全由浏览器本地生成并保存 Opus 播放资产

### `packages/shared`

- 前后端共享的 Zod schema、TypeScript 类型定义与业务模型常量
- 包含 `RoomSnapshot`、`PlaybackSnapshot`、分段资产清单与 WebRTC/播放诊断模型

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

WebRTC 的 `music-room-control` DataChannel 只用于控制和连接健康协调，音频不经过 DataChannel，也不在成员之间传输原始或播放资产。多人听歌只认一种条件：房间曲目必须拥有可被源成员分发的本地歌曲资产。第三方源缓存不能直接作为多人播放依据；源成员离线或资产缺失时房间统一暂停播放。源成员在线时，引擎自动按优先级（本地文件 -> 本地缓存 -> IndexedDB -> 第三方下载）准备分段 Opus 资产并登记至房间，激活统一房间时钟。不会从其他成员或服务端寻找替代音频源。

## 基础设施

- PostgreSQL：账号、房间、歌单和播放权威状态
- Redis：房间 patch、presence 和跨实例协作
- coturn：WebRTC 中继
- Nginx：Web、API、WebSocket 反代


