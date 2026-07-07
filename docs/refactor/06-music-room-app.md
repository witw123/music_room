# 06 · 顶层组件编排重构

> 目标文件：`apps/web/src/components/music-room-app.tsx`
> 优先级：P2 · 风险：低 · 状态：提案

## 1. 现状

| 指标 | 数值 |
|---|---|
| 行数 | 1655 |
| `useState` | 12 |
| `useCallback` | 29 |
| `useMemo` | 8 |
| `useEffect` | 9 |
| `useRef` | 2 |
| `export function` | 11 |

这是整个房间页面的顶层组件，负责：装配所有子 hook（uploads / playback / realtime /
downloader）、派生大量传给子组件的 props、维护 12 个 UI state、渲染子面板。

## 2. 根因
- **12 个 useState + 29 个 useCallback** 挤在一个组件里，UI 状态与业务编排混杂。
- 派生逻辑（如 `currentTrack` memo，见 `01` 里它引发的连锁）散落，容易产生**新引用
  抖动**，进而影响下游 hook 的依赖稳定性。
- 这是"props 组装中心"，一旦某个派生值引用不稳，会放大到 playback/realtime 层
  （模块 01/05 的问题上游有一部分在这里）。

## 3. 目标结构

```
music-room-app.tsx (瘦装配组件, ~400 行)
   ├──► useRoomPageState()      12 个 useState 收拢为 1~2 个 reducer（参考 room-state-reducer.ts）
   ├──► useRoomPageDerived()    集中派生 currentTrack 等，保证引用稳定（按 id+hash memo）
   ├──► 子面板组件              MembersPanel / RoomStage / RoomDashboardView（已拆出）
   └──► 各 feature hook          uploads / playback / realtime / downloader（装配，不含逻辑）
```

项目已有成熟的 reducer 范式（`room-state-reducer.ts`，416 行 + 857 行测试），把 12 个
零散 useState 收敛进去是自然延伸。

## 4. 关键：稳定派生值
`06` 的最大价值不是减行数，而是**给下游提供引用稳定的 props**：
- `currentTrack` 改为按 `id + fileHash` 比较的稳定 memo（内容不变则保持同引用），
  从源头消除 `01` 里"成员进出→currentTrack 新引用→定时器重建"的连锁。
- 传给 playback/realtime 的对象类 props 统一在 `useRoomPageDerived` 里做引用去重。

> 注意：`06` 与 `01`/`05` 有协同——即使 `01` 内部用了 ref 读值规避了依赖抖动，
> 在 `06` 源头稳住引用仍是"纵深防御"，两者都做最稳。

## 5. 分阶段实施
- **阶段 0**：确认 `music-room-app.test.ts`（现 ~8 组）覆盖装配与关键派生；补稳定性用例。
- **阶段 1**：抽 `useRoomPageDerived`，把派生值集中并做引用去重（尤其 `currentTrack`）。
- **阶段 2**：12 个 useState 收进 reducer（`useRoomPageState`）。
- **阶段 3**：把纯派生 export function 归拢，缩小组件主体。

## 6. 风险与回滚
- 风险低：主要是搬运与 memo 化，行为不变。
- 建议**放在 01/05 稳定后收尾**，作为纵深防御与最终瘦身。

## 7. 成功判据
- 组件主体从 1655 → ~400 行；12 useState → 1~2 reducer。
- 传给下游 hook 的 props 引用稳定（内容不变则不换引用）。
- 页面渲染与交互行为逐位不变。
