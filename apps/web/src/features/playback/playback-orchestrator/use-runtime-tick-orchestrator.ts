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
import { PlaybackOrchestrator } from "./orchestrator";

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

const progressiveRuntimeTickIntervalMs = 150;
const playbackDriftSampleIntervalMs = 1_000;
const fullLocalPausedRecoveryIntervalMs = 500;

export const noopPlaybackRuntimeTick = () => undefined;

export function usePlaybackRuntimeTickOrchestrator(): PlaybackRuntimeTickRefs {
  const syncProgressiveWarmupRef = useRef<() => void>(noopPlaybackRuntimeTick);
  const recoverPausedFullLocalPlaybackRef = useRef<() => void>(noopPlaybackRuntimeTick);
  const sampleDriftRef = useRef<() => void>(noopPlaybackRuntimeTick);
  const syncFullLocalBufferedWarmupRef = useRef<() => void>(noopPlaybackRuntimeTick);
  const syncUpgradeRef = useRef<() => void>(noopPlaybackRuntimeTick);
  const [runtimeTickOrchestratorRef] = useState<{ current: RuntimeTickOrchestrator }>(() => {
    const initialRuntimeTickAtMs = Date.now();
    const runtimeTickOrchestrator = new PlaybackOrchestrator({
      initialState: {
        lastDriftSampleAtMs: initialRuntimeTickAtMs,
        lastPausedRecoveryAtMs: initialRuntimeTickAtMs
      },
      initialInput: null,
      initialSnapshot: null,
      tickMs: progressiveRuntimeTickIntervalMs,
      getEngineSnapshot: () => null,
      reduceTick: ({ state, nowMs }) => {
        const shouldSampleDrift =
          nowMs - state.lastDriftSampleAtMs >= playbackDriftSampleIntervalMs;
        const shouldRecoverPausedFullLocal =
          nowMs - state.lastPausedRecoveryAtMs >= fullLocalPausedRecoveryIntervalMs;
        return {
          nextState: {
            lastDriftSampleAtMs: shouldSampleDrift ? nowMs : state.lastDriftSampleAtMs,
            lastPausedRecoveryAtMs: shouldRecoverPausedFullLocal
              ? nowMs
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
          syncProgressiveWarmupRef.current();
          return;
        }
        if (effect === "recover-paused-full-local") {
          recoverPausedFullLocalPlaybackRef.current();
          return;
        }
        if (effect === "sample-drift") {
          sampleDriftRef.current();
          return;
        }
        if (effect === "sync-full-local-warmup") {
          syncFullLocalBufferedWarmupRef.current();
          return;
        }
        syncUpgradeRef.current();
      },
      buildSnapshot: () => null,
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
    runtimeTickOrchestratorRef.current.mount();
    return () => {
      runtimeTickOrchestratorRef.current.unmount();
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
