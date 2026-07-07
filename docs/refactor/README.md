# Music Room 重构方案汇总

> 最后更新：`2026-07-05`
> 目标读者：维护本项目的工程师
> 状态：历史重构方案（已作为 0.2.8 重构依据；规模与测试数保留方案编写时基线）

## 这份文档是什么

Music Room 的 web 端在演进中积累了若干**超大文件 + 隐式状态机**，其中播放编排层
（`use-progressive-runtime.ts`，3178 行）已多次出现"修了又复现"的回归。本目录把
需要重构的模块**逐个拆成独立方案**，并在本文件汇总优先级、依赖关系与推进节奏。

每份模块方案都是**独立可读、独立可实施、独立可回滚**的。你可以只做其中一个，也可以
按汇总里的顺序全做。

## 模块方案索引

| # | 模块 | 文件 | 现状规模 | 优先级 | 风险 |
|---|---|---|---|---|---|
| 01 | 播放编排层 | [01-playback-runtime.md](./01-playback-runtime.md) | `use-progressive-runtime.ts` 3178 行 / 27 effect / 5 定时器 / 76 ref 写 | **P0 最高** | 中 |
| 02 | P2P Mesh | [02-p2p-mesh.md](./02-p2p-mesh.md) | `mesh.ts` 1655 行 / 单类 67 方法 | P1 | 中 |
| 03 | 上传流水线 | [03-track-uploads.md](./03-track-uploads.md) | `use-track-uploads.ts` 1931 行 / 21 export fn | P2 | 低 |
| 04 | 手动缓存下载器 | [04-manual-cache-downloader.md](./04-manual-cache-downloader.md) | `use-manual-cache-downloader.ts` 1413 行 | P2 | 低 |
| 05 | 房间实时连接 | [05-room-realtime-connection.md](./05-room-realtime-connection.md) | `use-room-realtime-connection.ts` 1008 行 / 3 定时器 / 36 ref 写 | P1 | 中 |
| 06 | 顶层组件编排 | [06-music-room-app.md](./06-music-room-app.md) | `music-room-app.tsx` 1655 行 / 12 state / 29 cb | P2 | 低 |

## 共同的根因诊断

这些文件都不是"逻辑写错"，而是**架构错配**，症状高度一致：

1. **状态多处分裂**：同一份运行时状态同时存在于 React state、`useMemo` 和大量
   `ref.current` 里，"真相源"不唯一。（runtime 76 处 ref 写、realtime 36 处）
2. **多个独立定时器操作同一资源**：多个 `setInterval` 各跑各的 tick，各读各的 effect
   依赖，互不感知却操作同一个引擎 / audio 元素 / socket → 竞态。
   （runtime 5 个、realtime 3 个）
3. **effect 依赖数组是雷区**：effect 既要"读到最新值"又要"不频繁重建定时器"，这两个
   诉求在 React 依赖模型里天然冲突。要对几十个 effect **逐个手工正确**，漏一个就
   线上复现——这正是播放层反复回归的机制。

**统一结论**：用 React effect 依赖数组去管理一个实时状态机是根本性错配。正确方向是把
状态机从 React 渲染周期里**抽离成纯 TS 的编排器（plain class + 纯函数管线）**，React
侧只负责"推入输入 / 订阅快照 / 生命周期"。

## 统一的重构范式（所有模块通用）

所有模块方案都遵循同一套**已在本项目验证过的安全范式**（参考已完成的
`pcm-runtime-failure.ts` 与 `piece-frame-codec.ts`）：

```
阶段 0  建立行为基线测试        —— 锁死"当前正确行为"，作为重构安全网（必做前置）
阶段 1  抽纯函数 / 纯状态机管线  —— 逻辑搬到独立文件，旧文件 re-export，行为不变
阶段 2  引入编排器 class         —— 合并多定时器为单 tick，消除竞态
阶段 3  瘦身 React hook          —— 只剩推 input / 订阅 snapshot / 生命周期
阶段 4  清理与 lint 固化         —— 删旧的分散 ref/memo，把规则提到 error 锁死
```

**铁律**：
- 绝不一次性重写。每阶段一个独立 commit，部署一个验一个。
- 每阶段结束时全套测试必须绿（方案编写时基线 57 文件 / 479 测试）。
- 任何一步线上复现问题，**单独 revert 那一步**，不牵连其他。
- 不通过关闭 lint 规则来"解决"警告；通过让依赖回到稳定标量来达标。

## 推进顺序（关键路径）

```
P0: 01 播放编排层   ← 先做。这是反复回归的源头，收益最大
        │
        ├─ P1: 05 房间实时连接  （与 01 共享 roomSnapshot 输入模型，可复用编排器范式）
        └─ P1: 02 P2P Mesh      （独立，可并行）
                │
                ├─ P2: 03 上传流水线
                ├─ P2: 04 手动缓存下载器
                └─ P2: 06 顶层组件编排  （依赖 01/05 稳定后收尾）
```

**建议**：先只做 `01` 的**阶段 0 + 阶段 1**，验证范式在本项目跑得通、基线测试能复现
线上 bug，再决定是否推进后续。不要一次立项做全部 6 个模块。

## 成功判据

- 播放层：成员进出时定时器**不重建**（测试可 spy `setInterval`/`clearInterval` 计数）；
  listener 边下边播追赶解码**不被打断**；切歌无重叠音。
- 全局：单个模块的 `useEffect` 数量与 `ref.current` 写入数量显著下降；该文件可将
  `exhaustive-deps` / `no-explicit-any` 提到 `error` 且零告警。
- 回归测试覆盖历史上每一个已修 bug（静音 / 重叠 / NaN / 卡死 / 重连抖动）。

## 相关文档

- [架构总览](../architecture/overview.md)
- [播放同步模型](../architecture/playback-sync.md)
- [P2P 分发](../architecture/p2p-distribution.md)
- [实时通信](../architecture/realtime.md)
