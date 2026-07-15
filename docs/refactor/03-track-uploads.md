# 03 · 上传流水线重构归档

状态：`历史提案，不代表当前实现`

本文件原本讨论把上传、缓存库、房间可用性广播和手动下载状态拆分。房间资产传输、缓存下载和 availability 广播已删除，旧方案不再适用。

当前上传边界：

- 浏览器校验用户选择的文件
- 上传阶段在本地生成原始资产和分段 Opus 播放资产
- 资产和清单写入当前用户浏览器的 IndexedDB
- REST 只注册曲目元数据和 `originalAsset` / `playbackAsset` 清单
- 房间同步曲目元数据，不同步文件本体

当前实现以 `apps/web/src/features/upload/**` 和 [共享模型](../api/shared-models.md) 为准。
