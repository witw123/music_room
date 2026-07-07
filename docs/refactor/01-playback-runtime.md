# 01 · 播放编排层重构

> 目标文件：`apps/web/src/features/playback/use-progressive-runtime.ts`
> 优先级：**P0（最高）** · 风险：中 · 状态：提案

## 1. 现状

| 指标 | 数值 |
|---|---|
| 行数 | 3178 |
| `useEffect` | 27 |
| `useMemo` | 22 |
| `useCallback` | 19 |
| `useRef` | 3（但 `ref.current =` 写入 **76** 处） |
| `setInterval` | 5 |
| `setTimeout` | 2 |
| 外部引用面 | 仅 `music-room-app.tsx` + 测试 |

引擎层本身是干净的（`ProgressivePcmEngine` 只暴露 `attach / sync / syncPlayback /
destroy / getSnapshot / setVolume` 等）。**问题 100% 在这个编排 hook。**

### 5 个定时器（核心病灶）

| 行号（约） | 定时器 | 周期 | 职责 |
|---|---|---|---|
| 2244 | full-local 暂停恢复 | 500ms | 上传者本地完整播放的暂停自愈 |
| 2326 | drift 采样 | 1000ms | 采集漂移样本 |
| 2665 | syncWarmup（PCM/progressive） | 150ms | listener 边下边播 warmup + 追赶 |
| 2793 | syncWarmup（full-local buffered） | 150ms | 缓冲完整轨的 warmup |
| 2882 | syncUpgrade | 150ms | 播放源升级/接管判定 |

这 5 个定时器**各自跑、各自读 effect 依赖、各自操作同一个 pcmEngine / audio 元素**，
彼此不感知。这是"声音重叠""卡死""缓存无声"等回归的结构性来源。

## 2. 根因（为什么打补丁修不完）

1. **状态三处分裂**：播放状态散落在 React state、22 个 `useMemo`、76 处 `ref.current`。
   真相源不唯一，读到哪份取决于代码路径。
2. **多定时器竞态**：5 个 loop 交叉操作同一引擎/audio，交错的 anchor 重置与
   `scheduleAhead` 互相打架（见项目记忆"声音重叠"条目）。
3. **effect 依赖冲突**：effect 要"拿最新值"又要"别重建定时器"，在 React 依赖模型里
   本质冲突。近期回归链条：
   - `9020833` 为消 `exhaustive-deps` 警告，把 `playback?.status` 等标量依赖换成整个
     `playback` / `roomSnapshot.room.playback` 对象，并给 warmup 定时器 effect **新增**
     了 `currentTrack` 等派生依赖。
   - `currentTrack`（`music-room-app.tsx:408`）依赖 `roomSnapshot?.tracks`；成员进出→
     新快照→`tracks` 新数组引用→`currentTrack` 新引用→warmup 的 150ms 定时器被
     `clearInterval`+重建→打断 PCM 追赶解码 = **缓存无声 / 重连抖动**。
   - `be45d44` 用 ref 读值 + 标量依赖修了**部分** effect，但要对 27 个 effect 逐个正确，
     漏一个就复现。**这就是本次仍未修好的原因。**

> 详细的依赖回归证据见 git 历史 `9020833` / `be45d44`，以及项目记忆
> `MEMORY.md` 的"声音重叠 + 播放卡死"条目。

## 3. 目标架构

```
music-room-app.tsx  (React 组件)
      │  提供 roomSnapshot / activeSession / volume 等输入；渲染 UI
      ▼
useProgressiveRuntime  (瘦 hook, 目标 ~150 行)
      │  只做三件事：①每次渲染把 props 推给 orchestrator
      │             ②useSyncExternalStore 订阅快照 → 渲染
      │             ③mount/unmount 生命周期
      ▼
PlaybackOrchestrator  (纯 TS class, 无 React 依赖)
      │  · 唯一真相源：一份 RuntimeState
      │  · 单一 tick 循环（一个定时器）
      │  · 每 tick 按固定顺序跑纯函数管线
      │  · emitSnapshot() 通知订阅者
      ├──► PCM / MSE Engine       (已有，接口干净，基本不动)
      ├──► selectPlaybackSource() (纯函数)
      ├──► computeDriftPlan()     (纯函数)
      └──► resolveEngineAction()  (纯函数)
```

**关键转变**：

| 维度 | 现状 | 目标 |
|---|---|---|
| 定时器 | 5 个独立 | **1 个** 单 tick 串行 |
| 状态真相源 | React state + 22 memo + 76 ref | **1 份 `RuntimeState`** |
| React effect | 27（依赖雷区） | **~3**（依赖都是稳定 orchestrator 引用） |
| 竞态 | 多 loop 交叉写 | 单线程串行，从根消除 |

## 4. 数据模型草案

```ts
// playback-orchestrator/types.ts

// 每次渲染由 React 推入的外部输入（快照式，只读）
interface RuntimeInput {
  playbackStatus: PlaybackStatus | null;
  currentTrackId: string | null;
  mediaEpoch: number | null;
  positionModel: PlaybackPositionModel;   // 用于算 expectedSeconds 的最小字段集
  currentTrackKey: string | null;         // id|fileHash|duration|mime|codec 拼接（稳定标量）
  activePlaybackSource: PlaybackSource;
  volume: number;
  isPageVisible: boolean;
  isCurrentSourceOwner: boolean;
  manifest: ProgressiveTrackManifest | null;
  bufferedFullLocalObjectUrl: string | null;
  // …只放 tick 真正需要的最小字段，全部是标量或稳定引用
}

// orchestrator 内部唯一真相源
interface RuntimeState {
  phase: "idle" | "warming" | "playing" | "degraded" | "failed";
  source: PlaybackSource;
  driftSamples: DriftSample[];
  lastAnchorAtMs: number | null;
  catchupTargetChunkIndex: number | null;
  // …原先散在 76 个 ref 里的字段收拢到这里
}

// 推给 React 渲染的快照
interface RuntimeSnapshot {
  bufferHealth: "healthy" | "low" | "critical";
  mediaConnectionState: MediaConnectionState;
  localReady: boolean;
  driftMs: number | null;
  fallbackReason: string | null;
  // …UI 需要的只读派生值
}
```

## 5. 纯函数管线（阶段 1 产出）

```ts
// playback-orchestrator/pipeline.ts —— 全部纯函数，100% 单测覆盖
function selectPlaybackSource(state: RuntimeState, input: RuntimeInput): PlaybackSource;
function computeDriftPlan(state: RuntimeState, input: RuntimeInput): DriftPlan;
function resolveEngineAction(
  state: RuntimeState,
  input: RuntimeInput
): { kind: "sync" | "syncPlayback" | "none"; expectedSeconds?: number; isPlaying?: boolean };

// 核心 reducer：一次 tick 的状态转移 + 待执行副作用清单
function reduceTick(
  state: RuntimeState,
  input: RuntimeInput,
  engineSnapshot: PcmEngineSnapshot | null,
  now: number
): { next: RuntimeState; effects: TickEffect[] };
```

`TickEffect` 是**声明式副作用**（如 `{type:"engine.syncPlayback", ...}`、
`{type:"audio.pause"}`），由 orchestrator 在 tick 末尾统一执行——纯函数本身不碰 DOM/引擎，
因此极易测试。

## 6. Orchestrator class（阶段 2 产出）

```ts
// playback-orchestrator/orchestrator.ts
class PlaybackOrchestrator {
  private state: RuntimeState;
  private input: RuntimeInput;              // 由 React 每次渲染刷新
  private timer: number | null = null;
  private listeners = new Set<() => void>();
  private snapshot: RuntimeSnapshot;

  constructor(private deps: {
    getEngine: () => ProgressivePcmEngine | ProgressiveMseEngine | null;
    getAudio: () => HTMLAudioElement | null;
    recordDiagnostic: (d: PeerDiagnostic) => void;
  }) {}

  updateInput(input: RuntimeInput) { this.input = input; }   // 只存，不算

  mount() {
    this.timer = window.setInterval(() => this.tick(), TICK_MS);  // 唯一定时器
  }
  unmount() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
  }

  private tick() {
    const engineSnapshot = this.deps.getEngine()?.getSnapshot() ?? null;
    const { next, effects } = reduceTick(this.state, this.input, engineSnapshot, Date.now());
    this.state = next;
    for (const effect of effects) this.runEffect(effect);   // 串行执行，无竞态
    this.recomputeSnapshotAndNotify();
  }

  private runEffect(effect: TickEffect) { /* 唯一碰引擎/audio 的地方 */ }

  getSnapshot() { return this.snapshot; }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}
```

## 7. 瘦身后的 hook（阶段 3 产出）

```ts
// use-progressive-runtime.ts —— 目标 ~150 行
export function useProgressiveRuntime(props: UseProgressiveRuntimeProps) {
  const orchestratorRef = useRef<PlaybackOrchestrator | null>(null);
  if (!orchestratorRef.current) {
    orchestratorRef.current = new PlaybackOrchestrator({ /* deps */ });
  }
  const orchestrator = orchestratorRef.current;

  // ① 每次渲染推入最新输入（稳定标量组装成 RuntimeInput）
  orchestrator.updateInput(buildRuntimeInput(props));

  // ② 订阅快照（useSyncExternalStore 天然避免撕裂）
  const snapshot = useSyncExternalStore(
    orchestrator.subscribe.bind(orchestrator),
    orchestrator.getSnapshot.bind(orchestrator)
  );

  // ③ 生命周期
  useEffect(() => {
    orchestrator.mount();
    return () => orchestrator.unmount();
  }, [orchestrator]);

  return snapshot;
}
```

27 个 effect 的依赖雷区**整体消失**——因为业务逻辑不再挂在 React 渲染周期上。

## 8. 分阶段实施

### 阶段 0：行为基线测试（必做前置，零风险）
在动任何结构前，补一组编排层行为测试锁死"当前正确行为"，作为整个重构的安全网：
- listener 边下边播能出声（追赶解码不被打断）
- **成员进出时定时器不重建**（spy `setInterval`/`clearInterval` 计数断言）
- 切歌不产生重叠音
- 卡死后暂停/继续能恢复（decoder 重建路径）

> 这一步还应**在测试里复现当前线上 bug**，坐实根因后再动手。没有基线测试就重构 = 盲飞。

### 阶段 1：抽纯函数管线（低风险）
把散在 76 个 ref 的状态收拢成 `RuntimeState`，把选源/漂移/引擎动作判定抽成
`pipeline.ts` 纯函数。在旧 hook 里调用这些纯函数替换等价内联逻辑，行为不变。
- 验证：新纯函数单测 + 现有 479 测试全绿。

### 阶段 2：引入 orchestrator（中风险，收益最大）
把引擎驱动、定时器、audio 操作收进 `PlaybackOrchestrator`。**5 定时器合并为 1。**
竞态在此消除。
- 验证：阶段 0 基线测试 + 定时器计数 spy。

### 阶段 3：瘦身 hook（中风险）
hook 缩到 ~150 行，只剩 3 个 effect，改用 `useSyncExternalStore`。
- 验证：同上 + snapshot 渲染一致性测试。

### 阶段 4：清理与 lint 固化（低风险）
删除旧的分散 ref/memo；在本文件把 `exhaustive-deps` / `no-explicit-any` 提到 `error`
且零告警，防止回退。

## 9. 风险与回滚

| 阶段 | 风险 | 验证 | 回滚 |
|---|---|---|---|
| 0 | 无 | 测试自身 | — |
| 1 | 低 | 纯函数单测 + 479 测试 | 单 commit revert |
| 2 | 中 | 基线 + 定时器 spy | 单 commit revert |
| 3 | 中 | 基线 + 渲染一致性 | 单 commit revert |
| 4 | 低 | lint + tsc | — |

## 10. 成功判据
- 成员进出：`setInterval`/`clearInterval` 计数在 roster 变化时**不增长**。
- listener 边下边播：追赶解码全程不中断，进度与出声同步。
- 切歌：无重叠音，无卡死。
- 该文件 `useEffect` 从 27 → ~3，`ref.current =` 从 76 → 个位数。
- `exhaustive-deps` 在本文件可设 `error` 且零告警。
