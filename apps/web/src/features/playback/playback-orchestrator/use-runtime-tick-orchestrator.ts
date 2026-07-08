"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import type { MutableRefObject } from "react";
import {
  PlaybackOrchestrator,
  type PlaybackOrchestratorScheduler
} from "./orchestrator";

type RuntimeTickState = {
  lastDriftSampleAtMs: number;
  lastPausedRecoveryAtMs: number;
};

type RuntimeTickEffect =
  | "recover-paused-full-local"
  | "sync-progressive-warmup"
  | "sync-full-local-warmup"
  | "sync-upgrade"
  | "sample-drift";

type RuntimeTickOrchestrator = PlaybackOrchestrator<
  RuntimeTickState,
  null,
  null,
  RuntimeTickEffect,
  null,
  number
>;

export type PlaybackRuntimeTickRefs = {
  syncProgressiveWarmupRef: MutableRefObject<() => void>;
  recoverPausedFullLocalPlaybackRef: MutableRefObject<() => void>;
  sampleDriftRef: MutableRefObject<() => void>;
  syncFullLocalBufferedWarmupRef: MutableRefObject<() => void>;
  syncUpgradeRef: MutableRefObject<() => void>;
};

const progressiveRuntimeTickIntervalMs = 80;
const playbackDriftSampleIntervalMs = 1_000;
const fullLocalPausedRecoveryIntervalMs = 500;

export const noopPlaybackRuntimeTick = () => undefined;

type PlaybackRuntimeTickOrchestratorOptions = {
  refs: PlaybackRuntimeTickRefs;
  nowMs?: () => number;
  scheduler: PlaybackOrchestratorScheduler<number>;
};

export function createPlaybackRuntimeTickOrchestrator({
  refs,
  nowMs = Date.now,
  scheduler
}: PlaybackRuntimeTickOrchestratorOptions): RuntimeTickOrchestrator {
  const initialRuntimeTickAtMs = nowMs();
  return new PlaybackOrchestrator({
    initialState: {
      lastDriftSampleAtMs: initialRuntimeTickAtMs,
      lastPausedRecoveryAtMs: initialRuntimeTickAtMs
    },
    initialInput: null,
    initialSnapshot: null,
    tickMs: progressiveRuntimeTickIntervalMs,
    getEngineSnapshot: () => null,
    reduceTick: ({ state, nowMs: tickNowMs }) => {
      const shouldSampleDrift =
        tickNowMs - state.lastDriftSampleAtMs >= playbackDriftSampleIntervalMs;
      const shouldRecoverPausedFullLocal =
        tickNowMs - state.lastPausedRecoveryAtMs >= fullLocalPausedRecoveryIntervalMs;
      return {
        nextState: {
          lastDriftSampleAtMs: shouldSampleDrift ? tickNowMs : state.lastDriftSampleAtMs,
          lastPausedRecoveryAtMs: shouldRecoverPausedFullLocal
            ? tickNowMs
            : state.lastPausedRecoveryAtMs
        },
        effects: [
          ...(shouldRecoverPausedFullLocal ? (["recover-paused-full-local"] as const) : []),
          "sync-progressive-warmup",
          "sync-full-local-warmup",
          "sync-upgrade",
          ...(shouldSampleDrift ? (["sample-drift"] as const) : [])
        ] as const
      };
    },
    runEffect: (effect) => {
      if (effect === "sync-progressive-warmup") {
        refs.syncProgressiveWarmupRef.current();
        return;
      }
      if (effect === "recover-paused-full-local") {
        refs.recoverPausedFullLocalPlaybackRef.current();
        return;
      }
      if (effect === "sample-drift") {
        refs.sampleDriftRef.current();
        return;
      }
      if (effect === "sync-full-local-warmup") {
        refs.syncFullLocalBufferedWarmupRef.current();
        return;
      }
      refs.syncUpgradeRef.current();
    },
    buildSnapshot: () => null,
    nowMs,
    scheduler
  });
}

export function usePlaybackRuntimeTickOrchestrator(): PlaybackRuntimeTickRefs {
  const syncProgressiveWarmupRef = useRef<() => void>(noopPlaybackRuntimeTick);
  const recoverPausedFullLocalPlaybackRef = useRef<() => void>(noopPlaybackRuntimeTick);
  const sampleDriftRef = useRef<() => void>(noopPlaybackRuntimeTick);
  const syncFullLocalBufferedWarmupRef = useRef<() => void>(noopPlaybackRuntimeTick);
  const syncUpgradeRef = useRef<() => void>(noopPlaybackRuntimeTick);
  const [runtimeTickOrchestratorRef] = useState<{ current: RuntimeTickOrchestrator }>(() => {
    const runtimeTickOrchestrator = createPlaybackRuntimeTickOrchestrator({
      refs: {
        syncProgressiveWarmupRef,
        recoverPausedFullLocalPlaybackRef,
        sampleDriftRef,
        syncFullLocalBufferedWarmupRef,
        syncUpgradeRef
      },
      scheduler: {
        setInterval: (callback, delayMs) => window.setInterval(callback, delayMs),
        clearInterval: (timerId) => window.clearInterval(timerId)
      }
    });
    return { current: runtimeTickOrchestrator };
  });
  const subscribeRuntimeOrchestrator = useCallback(
    (listener: () => void) => runtimeTickOrchestratorRef.current.subscribe(listener),
    [runtimeTickOrchestratorRef]
  );
  const getRuntimeOrchestratorSnapshot = useCallback(
    () => runtimeTickOrchestratorRef.current.getSnapshot(),
    [runtimeTickOrchestratorRef]
  );
  const runtimeOrchestratorSnapshot = useSyncExternalStore(
    subscribeRuntimeOrchestrator,
    getRuntimeOrchestratorSnapshot,
    getRuntimeOrchestratorSnapshot
  );
  void runtimeOrchestratorSnapshot;

  useEffect(() => {
    const runtimeTickOrchestrator = runtimeTickOrchestratorRef.current;
    runtimeTickOrchestrator.mount();
    return () => {
      runtimeTickOrchestrator.unmount();
    };
  }, [runtimeTickOrchestratorRef]);

  return useMemo(
    () => ({
      syncProgressiveWarmupRef,
      recoverPausedFullLocalPlaybackRef,
      sampleDriftRef,
      syncFullLocalBufferedWarmupRef,
      syncUpgradeRef
    }),
    []
  );
}
