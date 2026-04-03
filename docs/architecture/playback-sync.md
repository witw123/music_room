# 播放同步

最后更新：`2026-04-03`

## 权威模型

- 房主是播放权威源
- 服务端保存并广播 `PlaybackSnapshot`
- 成员不独立决定房间播放状态，只在本地执行校准和回退

`PlaybackSnapshot` 当前关键字段：

- `status`
- `currentTrackId`
- `currentQueueItemId`
- `positionMs`
- `startedAt`
- `queueVersion`
- `mediaEpoch`

## 当前播放源模型

客户端现在不是单一路径播放，而是三层混合：

### `remote-stream`

- 房主通过 WebRTC Media 推送的实时音频
- 作用是秒开和兜底
- 新成员进房时通常先从这里起播

### `progressive-local`

- 一边收分片，一边本地播放
- Chromium 浏览器优先启用
- 当前实现：
  - MP3：MSE
  - FLAC：PCM / WebCodecs + AudioContext

### `full-local`

- 当前曲目已经完整缓存到本地
- 客户端直接用完整本地资源播放
- 这是当前最稳定的状态

## 选源原则

当前选源不是“只要有流就一直听流”，而是：

1. 先用 `remote-stream` 保证秒开
2. 本地连续缓冲达到启动门槛后，切到 `progressive-local`
3. 当前曲目完整缓存后，切到 `full-local`
4. 如果本地缓冲掉到危险阈值以下，或 seek 到未缓冲区域，再回退到 `remote-stream`

## 分片调度策略

当前调度器包含五种策略：

- `startup`
- `steady`
- `catchup`
- `pause-fill`
- `background`

调度原则是：

- 当前曲目绝对优先
- 在当前曲目未完整前，不给其它曲目分配主要带宽
- 当前曲目完整后，才开始后台预取其它曲目

## 与队列版本的关系

- 所有播放控制接口都依赖 `expectedVersion`
- 服务端通过 `queueVersion` 拒绝过期控制，避免旧状态覆盖新状态
- 当前文档层面应把这理解为“房间播放状态有版本控制，不保证并发点击全部成功”

## 诊断面板含义

成员与诊断页现在可直接观察：

- `播放源`
- `引擎`
- `连续缓冲`
- `前向缓冲`
- `调度策略`
- `启动就绪`
- `fallbackReason`

当你看到：

- `播放源: remote-stream`
  - 表示当前还主要依赖房主实时推流
- `播放源: progressive-local`
  - 表示当前在边收边播
- `播放源: full-local`
  - 表示当前已经主要听本地完整缓存
