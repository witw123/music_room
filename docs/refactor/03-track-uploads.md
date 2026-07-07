# 03 · 上传流水线重构

> 目标文件：`apps/web/src/features/upload/use-track-uploads.ts`
> 优先级：P2 · 风险：低 · 状态：提案

## 1. 现状

| 指标 | 数值 |
|---|---|
| 行数 | 1931 |
| `useEffect` | 9 |
| `useCallback` | 19 |
| `useMemo` | 3 |
| `export function` | 21（大量纯函数已在文件内） |
| `ref.current =` | 3 |
| `setInterval` | 0 |

好消息：这个 hook **没有多定时器竞态**，且已经有 21 个 export function（说明纯逻辑
天然可分离）。风险低，是练手 / 验证范式的好目标。

## 2. 职责盘点

`use-track-uploads.ts` 目前混合了多条相对独立的流水线：
- 文件选择与校验（`handleFilesSelected`）
- 上传到本地缓存 / IndexedDB 写入
- 曲目可用性广播（`announceRoomTrackAvailability`）
- 缓存库管理（增删、导入导出、加载文件）
- 手动缓存任务的 UI 状态派生

这些流水线共享少量 ref，但彼此逻辑独立，适合按流水线切分。

## 3. 目标结构

```
use-track-uploads.ts (瘦编排 hook, ~300 行)
   ├──► upload-pipeline.ts         文件校验 + 分片 + 写缓存（纯函数为主）
   ├──► cache-library.ts           缓存库 CRUD / 导入导出 / 加载（多为纯 async 函数）
   ├──► track-availability.ts      可用性广播计算与去重
   └──► upload-ui-state.ts         manualCacheTasks 等 UI 派生（纯函数）
```

21 个 export function 里的纯逻辑直接搬进对应文件，hook 只保留 React 状态与编排。

## 4. 分阶段实施

- **阶段 0**：确认 `use-track-uploads.test.ts`（现 ~907 行）与
  `cached-library-track-policy.test.ts` 覆盖各流水线；补缺口。
- **阶段 1**：把已是 export function 的纯逻辑物理搬到上述文件，旧文件 re-export 保持
  兼容（测试零改动）。这一步几乎无风险。
- **阶段 2**：把与各流水线绑定的 `useCallback` 下沉为对应文件的普通函数 + 在 hook 里
  薄封装。
- **阶段 3**：清理，缩小 hook 主体。

## 5. 风险与回滚
- 风险低：无定时器、无竞态、外部引用面清晰。
- 每阶段独立 commit；`use-track-uploads.test.ts` 绿即安全。

## 6. 成功判据
- hook 主体从 1931 → ~300 行；纯逻辑分散到 4 个 < 500 行的文件，各有单测。
- 上传 / 缓存库 / 广播行为逐位不变。
