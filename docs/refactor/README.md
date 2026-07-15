# 重构记录

最后更新：`2026-07-15`

本目录包含已经完成的播放链路迁移记录，以及早期重构提案的归档说明。历史提案不代表当前实现，不应作为新增功能或协议的依据。

## 当前有效记录

- [01 · 单一播放运行时迁移](./01-playback-runtime.md)：已完成，描述当前唯一 Segmented Opus/WebRTC 播放链路

## 已归档提案

- [02 · WebRTC Peer 连接重构](./02-p2p-mesh.md)
- [03 · 上传流水线重构](./03-track-uploads.md)
- [04 · 房间缓存下载器重构](./04-manual-cache-downloader.md)
- [05 · 房间实时连接重构](./05-room-realtime-connection.md)
- [06 · 顶层组件编排重构](./06-music-room-app.md)

这些文档保留文件级背景，具体实现和协议以 `apps/**`、`packages/shared/**` 以及 `docs/architecture/**` 为准。
