# WebSocket 事件协议

## 房间事件

- `room.join`
- `room.leave`
- `room.snapshot`
- `member.joined`
- `member.left`

## 播放与队列事件

- `queue.update`
- `playback.update`
- `track.announce`
- `piece.availability`

## 信令事件

- `peer.signal`
  - `offer`
  - `answer`
  - `candidate`

## 错误处理

- 所有事件响应统一携带 `event` 与 `payload`
- 失败消息增加 `code`、`message`、`traceId`
- 非法 payload 直接拒绝并记录日志

