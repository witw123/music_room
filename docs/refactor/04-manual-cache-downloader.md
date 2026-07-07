# 04 · 手动缓存下载器重构

> 目标文件：`apps/web/src/features/room/hooks/use-manual-cache-downloader.ts`
> 优先级：P2 · 风险：低 · 状态：提案

## 1. 现状

| 指标 | 数值 |
|---|---|
| 行数 | 1413 |
| `useEffect` | 4 |
| `useMemo` | 5 |
| `useCallback` | 0 |
| `export function` | 16 |
| `ref.current =` | 13 |
| `setInterval` | 1 |

## 2. 职责盘点

手动缓存下载器负责：
- 下载任务队列与调度（哪个 track、哪些 chunk、优先级）
- 从 P2P peer 拉取分片（配合 chunk-scheduler / mesh）
- 分片落 IndexedDB
- 进度/状态派生给 UI（`manualCacheTasks`）
- 1 个定时器驱动下载 tick

结构比播放层健康（只有 1 个定时器、16 个 export function），但 13 处 ref 写 + 下载状态
散落，仍有收拢空间。

## 3. 目标结构

```
use-manual-cache-downloader.ts (瘦 hook, ~250 行)
   ├──► download-queue.ts        任务队列 / 优先级 / 状态转移（纯函数 reducer）
   ├──► piece-fetch.ts           单分片拉取 + 落库（async 函数）
   └──► download-progress.ts     进度/状态派生给 UI（纯函数）
```

若下载 tick 逻辑复杂，可考虑与播放层同款的轻量 orchestrator（单定时器 + reducer），
但因只有 1 个定时器、无竞态，**优先用纯函数 reducer + hook 内单定时器**即可，不必上
完整 orchestrator。

## 4. 分阶段实施

- **阶段 0**：确认 `use-manual-cache-downloader.test.ts`（现 ~965 行）覆盖队列调度、
  拉取失败重试、进度派生；补缺口。
- **阶段 1**：抽 `download-queue.ts` 纯函数 reducer（任务状态转移），把 13 处 ref 写
  收拢为一份 queue state。
- **阶段 2**：抽 `piece-fetch.ts` / `download-progress.ts`。
- **阶段 3**：hook 只保留单定时器 + 订阅 reducer 结果。

## 5. 风险与回滚
- 风险低：单定时器、逻辑相对内聚、测试覆盖已较厚。
- 每阶段独立 commit。

## 6. 成功判据
- hook 主体从 1413 → ~250 行；`ref.current =` 从 13 → 个位数。
- 下载队列 / 重试 / 进度行为逐位不变。
