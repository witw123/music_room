# 测试策略

最后更新：`2026-07-15`

## 已覆盖

- shared 房间、会话、事件、资产清单和 WebRTC 模型约束
- 服务端认证、房间、队列、播放、实时和信令
- 前端房间运行时、WebRTC 连接、IndexedDB 个人资产处理、上传工具和组件
- 分段 Opus 引擎的缓冲、去重、时间线 generation、fade、limiter 和音量 ramp
- 播放媒体会话 key、启动请求、AudioContext 激活和 WebRTC Track 生命周期

## 浏览器集成验收

使用两个 Chromium context 验证：

- 连续播放 30 分钟
- 成员加入/离开、普通房间快照、presence 和队列刷新不中断播放
- 暂停、恢复、切歌、seek、快速调节音量
- 缺片、解码延迟、RTP 丢包和媒体连接恢复
- 监听端不会反复清空 `srcObject`
- 非重连期间 `remoteTrackId` 保持不变
- `currentTime` 持续推进
- limiter 后 peak 不超过 0dBFS，没有持续高频噪声、尖峰或可听 click/pop

## 发布前命令

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm e2e
```
