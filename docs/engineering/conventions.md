# 工程约定

## 目录规则

- `apps/web` 和 `apps/server` 都按领域拆分
- `packages/shared` 只放跨端复用的协议、schema、常量
- 前端特有 view model 不要进入 shared 包

## 命名规则

- 领域目录使用单数语义：`room`、`playlist`、`playback`
- 类型名使用显式业务名词
- WebSocket 事件名使用 `domain.action`

## 状态边界

- 房间生命周期状态放在 `room`
- 播放控制状态放在 `player` 或 `playback`
- WebRTC peer、控制通道、媒体连接和诊断状态放在 `p2p`

## shared 使用规则

- 前后端协议变更必须先改 shared
- 不允许在 web 和 server 内部分别复制 DTO
- schema 优先于手写类型
