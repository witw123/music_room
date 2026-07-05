export type PlaybackOrchestratorScheduler<TTimerId> = {
  setInterval: (callback: () => void, delayMs: number) => TTimerId;
  clearInterval: (timerId: TTimerId) => void;
};

export type PlaybackOrchestratorReducerArgs<TState, TInput, TEngineSnapshot> = {
  state: TState;
  input: TInput;
  engineSnapshot: TEngineSnapshot;
  nowMs: number;
};

export type PlaybackOrchestratorReducerResult<TState, TEffect> = {
  nextState: TState;
  effects: readonly TEffect[];
};

export type PlaybackOrchestratorSnapshotArgs<TState, TInput, TEngineSnapshot> = {
  state: TState;
  input: TInput;
  engineSnapshot: TEngineSnapshot;
  nowMs: number;
};

export type PlaybackOrchestratorOptions<
  TState,
  TInput,
  TEngineSnapshot,
  TEffect,
  TSnapshot,
  TTimerId
> = {
  initialState: TState;
  initialInput: TInput;
  initialSnapshot: TSnapshot;
  tickMs: number;
  getEngineSnapshot: () => TEngineSnapshot;
  reduceTick: (
    args: PlaybackOrchestratorReducerArgs<TState, TInput, TEngineSnapshot>
  ) => PlaybackOrchestratorReducerResult<TState, TEffect>;
  runEffect: (effect: TEffect) => void;
  buildSnapshot: (
    args: PlaybackOrchestratorSnapshotArgs<TState, TInput, TEngineSnapshot>
  ) => TSnapshot;
  nowMs?: () => number;
  scheduler: PlaybackOrchestratorScheduler<TTimerId>;
};

export class PlaybackOrchestrator<
  TState,
  TInput,
  TEngineSnapshot,
  TEffect,
  TSnapshot,
  TTimerId = ReturnType<typeof setInterval>
> {
  private state: TState;
  private input: TInput;
  private snapshot: TSnapshot;
  private timerId: TTimerId | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly tickMs: number;
  private readonly getEngineSnapshot: () => TEngineSnapshot;
  private readonly reduceTick: (
    args: PlaybackOrchestratorReducerArgs<TState, TInput, TEngineSnapshot>
  ) => PlaybackOrchestratorReducerResult<TState, TEffect>;
  private readonly runEffect: (effect: TEffect) => void;
  private readonly buildSnapshot: (
    args: PlaybackOrchestratorSnapshotArgs<TState, TInput, TEngineSnapshot>
  ) => TSnapshot;
  private readonly nowMs: () => number;
  private readonly scheduler: PlaybackOrchestratorScheduler<TTimerId>;

  constructor(
    options: PlaybackOrchestratorOptions<
      TState,
      TInput,
      TEngineSnapshot,
      TEffect,
      TSnapshot,
      TTimerId
    >
  ) {
    this.state = options.initialState;
    this.input = options.initialInput;
    this.snapshot = options.initialSnapshot;
    this.tickMs = options.tickMs;
    this.getEngineSnapshot = options.getEngineSnapshot;
    this.reduceTick = options.reduceTick;
    this.runEffect = options.runEffect;
    this.buildSnapshot = options.buildSnapshot;
    this.nowMs = options.nowMs ?? Date.now;
    this.scheduler = options.scheduler;
  }

  updateInput(input: TInput) {
    this.input = input;
  }

  mount() {
    if (this.timerId !== null) {
      return;
    }

    this.timerId = this.scheduler.setInterval(() => this.tick(), this.tickMs);
  }

  unmount() {
    if (this.timerId === null) {
      return;
    }

    this.scheduler.clearInterval(this.timerId);
    this.timerId = null;
  }

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private tick() {
    const engineSnapshot = this.getEngineSnapshot();
    const nowMs = this.nowMs();
    const result = this.reduceTick({
      state: this.state,
      input: this.input,
      engineSnapshot,
      nowMs
    });

    this.state = result.nextState;
    for (const effect of result.effects) {
      this.runEffect(effect);
    }
    this.snapshot = this.buildSnapshot({
      state: this.state,
      input: this.input,
      engineSnapshot,
      nowMs
    });
    this.notify();
  }

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
