import { describe, expect, it, vi } from "vitest";
import {
  createPlaybackRuntimeTickOrchestrator,
  noopPlaybackRuntimeTick,
  type PlaybackRuntimeTickRefs
} from "./use-runtime-tick-orchestrator";

const createTickRefs = (): PlaybackRuntimeTickRefs => ({
  syncProgressiveWarmupRef: { current: noopPlaybackRuntimeTick },
  recoverPausedFullLocalPlaybackRef: { current: noopPlaybackRuntimeTick },
  sampleDriftRef: { current: noopPlaybackRuntimeTick },
  syncFullLocalBufferedWarmupRef: { current: noopPlaybackRuntimeTick },
  syncUpgradeRef: { current: noopPlaybackRuntimeTick }
});

describe("createPlaybackRuntimeTickOrchestrator", () => {
  it("keeps one interval while room snapshot refreshes replace tick callbacks", () => {
    const refs = createTickRefs();
    const intervalCallbacks: Array<() => void> = [];
    const setInterval = vi.fn((callback: () => void, delayMs: number) => {
      expect(delayMs).toBe(150);
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    });
    const clearInterval = vi.fn();
    let nowMs = 1_000;

    refs.syncProgressiveWarmupRef.current = vi.fn();
    const firstWarmup = refs.syncProgressiveWarmupRef.current;
    const orchestrator = createPlaybackRuntimeTickOrchestrator({
      refs,
      nowMs: () => nowMs,
      scheduler: {
        setInterval,
        clearInterval
      }
    });

    orchestrator.mount();
    intervalCallbacks[0]?.();

    refs.syncProgressiveWarmupRef.current = vi.fn();
    const refreshedWarmup = refs.syncProgressiveWarmupRef.current;
    nowMs += 150;
    intervalCallbacks[0]?.();

    expect(setInterval).toHaveBeenCalledOnce();
    expect(clearInterval).not.toHaveBeenCalled();
    expect(firstWarmup).toHaveBeenCalledOnce();
    expect(refreshedWarmup).toHaveBeenCalledOnce();
  });

  it("continues progressive warmup catch-up ticks after callback refreshes", () => {
    const refs = createTickRefs();
    const warmupCalls: string[] = [];
    const intervalCallbacks: Array<() => void> = [];
    const orchestrator = createPlaybackRuntimeTickOrchestrator({
      refs,
      nowMs: () => 2_000,
      scheduler: {
        setInterval: (callback) => {
          intervalCallbacks.push(callback);
          return intervalCallbacks.length;
        },
        clearInterval: () => undefined
      }
    });

    refs.syncProgressiveWarmupRef.current = () => warmupCalls.push("initial");
    orchestrator.mount();
    intervalCallbacks[0]?.();
    intervalCallbacks[0]?.();

    refs.syncProgressiveWarmupRef.current = () => warmupCalls.push("refreshed");
    intervalCallbacks[0]?.();
    intervalCallbacks[0]?.();

    expect(warmupCalls).toEqual(["initial", "initial", "refreshed", "refreshed"]);
  });
});
