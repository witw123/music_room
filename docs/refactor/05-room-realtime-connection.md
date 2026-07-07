# 05 · 房间实时连接重构

> 目标文件：`apps/web/src/features/room/hooks/use-room-realtime-connection.ts`
> 优先级：P1 · 风险：中 · 状态：提案

## 1. 现状

| 指标 | 数值 |
|---|---|
| 行数 | 1008 |
| `useEffect` | 6 |
| `useCallback` | 5 |
| `export function` | 12 |
| `ref.current =` | **36** |
| `setInterval` | 3 |

## 2. 根因

与播放层**同类问题**（这也是"成员进出重连"症状的另一半来源）：
- **3 个定时器**：房间快照看门狗（stale-watchdog，4s）、恢复看门狗（recovery-watchdog，
  5s）、presence 心跳。各自读 effect 依赖。
- **36 处 ref 写**：presence 修复 key、resync key、看门狗时间戳等散落在 ref。
- effect 依赖里含 `roomSnapshot`（整对象）：成员进出→新快照→看门狗 effect 重建定时器
  → resync/presence 抖动 → 表现为"重连"。

`9020833` 已把此文件从 `input.X` 改为解构 + 类型化（消除 `any`），是好的一步，但**定时器
与 effect 依赖的结构性问题仍在**。

## 3. 目标架构

复用播放层的编排器范式（`01-playback-runtime.md` 的思路）：

```
useRoomRealtimeConnection (瘦 hook, ~200 行)
   │  推 input / 订阅 snapshot / 生命周期
   ▼
RealtimeConnectionOrchestrator (纯 TS class)
   │  · 唯一真相源：ConnectionState
   │  · 单 tick（或最多按语义分组的定时器）驱动看门狗
   │  · 声明式 effect（resync / presence / recovery-recommendation）
   ├──► SubscribeController      房间订阅 + ack 重试退避
   ├──► PresenceController       presence 心跳 + 在线态修复
   └──► SnapshotWatchdog         stale/recovery 看门狗判定（纯函数）
```

看门狗判定逻辑（"多久没事件→resync"）本质是纯函数，抽出后 3 个定时器可合并/规整，
且 effect 依赖回到稳定标量（`roomSnapshot?.room.id` / `presenceRevision` 等），不再盯整对象。

## 4. 分阶段实施

- **阶段 0**：补行为基线测试——**成员进出时看门狗定时器不重建**（spy 计数）；
  presence 修复只在真正需要时触发；resync 去重 key 正确。`use-room-realtime-connection.test.ts`
  现有 ~16 组，需补定时器稳定性用例。
- **阶段 1**：抽看门狗/presence/subscribe 判定为纯函数，把 36 处 ref 收拢成 `ConnectionState`。
- **阶段 2**：引入 orchestrator，合并/规整 3 个定时器。
- **阶段 3**：瘦身 hook，effect 依赖回到稳定标量。
- **阶段 4**：清理 + lint 固化。

## 5. 与模块 01 的关系
两者共享 `roomSnapshot` 输入模型与"整对象依赖导致定时器重建"的同一病根。**建议 01 先做**，
把编排器范式跑通、沉淀出可复用的 orchestrator 骨架，再套用到 05，成本更低。

## 6. 风险与回滚
- 风险中等：涉及 socket 生命周期与重连，需真机/集成验证。
- 每阶段独立 commit，`use-room-realtime-connection.test.ts` 绿 + 手工重连验证。

## 7. 成功判据
- 成员进出：看门狗/presence 定时器计数不增长。
- `ref.current =` 从 36 → 个位数；3 定时器合并/规整。
- 订阅 / 重连 / presence 修复行为逐位不变。
