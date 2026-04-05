# 播放同步

最后更新：`2026-04-05`

## 权威模型

- 服务端保存并广播 `PlaybackSnapshot`
- 所有成员都可以发起播放控制
- 客户端以服务端广播结果为准，只在本地执行校准和回退

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

- 主要承担后台预热和缓存增长
- 默认不再作为短时间内必然接管的主播放路径
- 当前实现：
  - MP3：MSE
  - FLAC：PCM / WebCodecs + AudioContext

### `full-local`

- 当前曲目已经完整缓存到本地
- 客户端直接用完整本地资源播放
- 这是当前最稳定的状态

## 选源原则

当前选源不是“尽快切本地”，而是：

1. 先用 `remote-stream` 保证秒开
2. `progressive-local` 继续在后台补当前曲目，不抢主路
3. 当前曲目完整缓存、链路稳定且没有追赶风险时，才切到 `full-local`
4. 如果出现 `buffer-underrun`、`stalled`、data 未 ready 或当前曲目缓存速度追不上播放进度，保持 `remote-stream`

## 分片调度策略

当前调度器包含六种策略：

- `startup`
- `steady`
- `catchup`
- `outrun-recovery`
- `pause-fill`
- `background`

调度原则是：

- 当前曲目绝对优先
- 在当前曲目未完整前，不给其它曲目分配主要带宽
- 当预测“当前曲目缓存速度追不上剩余播放时长”时，会进入 `outrun-recovery`
- `outrun-recovery` 下只补当前曲目，暂停下一首和后台预取
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
- `estimatedFillTimeMs`
- `remainingPlaybackMs`
- `remoteFirstLockReason`

当你看到：

- `播放源: remote-stream`
  - 表示当前还主要依赖房主实时推流
- `播放源: progressive-local`
  - 表示当前在边收边播
- `播放源: full-local`
  - 表示当前已经主要听本地完整缓存
