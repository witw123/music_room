# 可观测性

## 日志

- 服务端采用结构化日志
- WebSocket 事件需记录事件名、房间号、成员 ID、traceId
- P2P 失败需记录 peerId、trackId、chunkIndex 和错误原因

## 指标

- 活跃房间数
- 在线成员数
- WebSocket 连接数
- P2P 建连成功率
- 平均起播耗时
- 缓冲次数与平均缓冲时长

## 错误追踪

- 前后端统一接入 Sentry
- 关键错误要携带房间上下文与浏览器信息

