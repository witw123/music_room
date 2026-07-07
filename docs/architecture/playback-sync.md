# 播放同步

最后更新：`2026-07-07`

## 权威模型

- 服务端保存并广播 `PlaybackSnapshot`
- 所有房间成员都可以发起播放控制
- 客户端以服务端广播结果为准，在本地做缓存播放、校准和恢复

`PlaybackSnapshot` 当前关键字段：

- `status`
- `currentTrackId`
- `currentQueueItemId`
- `positionMs`
- `startedAt`
- `queueVersion`
- `playbackRevision`
- `mediaEpoch`
- `sourceSessionId`
- `sourcePeerId`

## 当前播放源模型

项目当前走本地缓存播放模型，主要播放源只有两类：

### `progressive-local`

- 边拉取分片边播放
- 当前曲目优先下载，必要时进入追赶和恢复策略
- MP3 走 MSE，FLAC 走 PCM / WebCodecs + AudioContext

### `full-local`

- 当前曲目已经完整缓存到本地
- 客户端直接播放完整本地资源
- 这是最稳定的目标状态

## 缓存与数据通道

- 客户端通过 IndexedDB 保存曲目和分片
- 房间内 peer 广播曲目可用性，字段包括 `source: live_upload | local_cache`
- 手动缓存任务会从在线 provider 请求缺失分片
- 如果 provider 未连接或没有远端可用性公告，客户端会触发数据 peer 恢复
- 当前 source owner 的 `sourcePeerId` 仍重要：它用于优先 provider 选择、拓扑识别和重连恢复

## 版本语义

- `expectedVersion` 对应 `playbackRevision`
- 服务端用 `playbackRevision` 拒绝过期播放控制，避免旧播放状态覆盖新状态
- `queueVersion` 只表示队列结构版本，例如加歌、删歌、重排队列
- `mediaEpoch` 表示媒体拓扑重建，例如换曲、换 source peer、当前 source session 被替换
- source peer 重连会递增 `mediaEpoch` 和 `playbackRevision`，但不递增 `queueVersion`

## 选源原则

1. 如果当前曲目已完整缓存，优先 `full-local`
2. 否则使用 `progressive-local` 启动并持续补齐当前曲目
3. 当前曲目未完整前，调度器优先当前曲目分片
4. 当预测缓存追不上播放进度时，进入恢复策略并限制后台预取
5. 当前曲目完整后，再弱化当前曲目压力并允许后台预取其它曲目

## 分片调度策略

当前调度器包含六种策略：

- `startup`
- `steady`
- `catchup`
- `outrun-recovery`
- `pause-fill`
- `background`

## 诊断面板含义

成员与诊断页可观察：

- `播放源`
- `引擎`
- `连续缓冲`
- `前向缓冲`
- `调度策略`
- `启动就绪`
- `fallbackReason`
- `estimatedFillTimeMs`
- `remainingPlaybackMs`

当你看到：

- `播放源: progressive-local`
  - 表示当前在边拉分片边播
- `播放源: full-local`
  - 表示当前已经主要播放完整本地缓存
