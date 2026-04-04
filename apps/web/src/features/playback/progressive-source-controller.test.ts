import { describe, expect, it } from "vitest";
import {
  getInitialProgressivePlaybackSource,
  resolveFullLocalWarmupDecision,
  resolveProgressiveWarmupDecision
} from "./progressive-source-controller";

describe("progressive source controller", () => {
  it("prefers full-local when the track is already cached in full", () => {
    expect(getInitialProgressivePlaybackSource(true)).toBe("full-local");
    expect(getInitialProgressivePlaybackSource(false)).toBe("remote-stream");
  });

  it("requires a stable warmup window before switching to progressive local", () => {
    const firstDecision = resolveProgressiveWarmupDecision({
      currentSource: "remote-stream",
      engineReady: true,
      activationReady: true,
      fallbackReason: null,
      driftMs: 120,
      warmupReadyAt: null,
      now: 5_000
    });

    expect(firstDecision).toEqual({
      nextSource: "remote-stream",
      nextWarmupReadyAt: 5_000,
      clearFallbackReason: false
    });

    const secondDecision = resolveProgressiveWarmupDecision({
      currentSource: "remote-stream",
      engineReady: true,
      activationReady: true,
      fallbackReason: null,
      driftMs: 80,
      warmupReadyAt: firstDecision.nextWarmupReadyAt,
      now: 6_200
    });

    expect(secondDecision.nextSource).toBe("remote-stream");

    const thirdDecision = resolveProgressiveWarmupDecision({
      currentSource: "remote-stream",
      engineReady: true,
      activationReady: true,
      fallbackReason: null,
      driftMs: 80,
      warmupReadyAt: firstDecision.nextWarmupReadyAt,
      now: 7_200
    });

    expect(thirdDecision).toEqual({
      nextSource: "progressive-local",
      nextWarmupReadyAt: 5_000,
      clearFallbackReason: true
    });
  });

  it("resets warmup when drift spikes or fallback is active", () => {
    expect(
      resolveProgressiveWarmupDecision({
        currentSource: "remote-stream",
        engineReady: true,
        activationReady: true,
        fallbackReason: "buffer-underrun",
        driftMs: 40,
        warmupReadyAt: 5_000,
        now: 8_000
      })
    ).toEqual({
      nextSource: "remote-stream",
      nextWarmupReadyAt: null,
      clearFallbackReason: false
    });

    expect(
      resolveProgressiveWarmupDecision({
        currentSource: "remote-stream",
        engineReady: true,
        activationReady: true,
        fallbackReason: null,
        driftMs: 420,
        warmupReadyAt: 5_000,
        now: 8_000
      })
    ).toEqual({
      nextSource: "remote-stream",
      nextWarmupReadyAt: null,
      clearFallbackReason: false
    });
  });

  it("switches to full-local after a stable warmup once a full track becomes available", () => {
    const firstDecision = resolveFullLocalWarmupDecision({
      currentSource: "remote-stream",
      localReady: true,
      driftMs: 90,
      warmupReadyAt: null,
      now: 9_000
    });

    expect(firstDecision).toEqual({
      nextSource: "remote-stream",
      nextWarmupReadyAt: 9_000,
      clearFallbackReason: false
    });

    const secondDecision = resolveFullLocalWarmupDecision({
      currentSource: "remote-stream",
      localReady: true,
      driftMs: 70,
      warmupReadyAt: firstDecision.nextWarmupReadyAt,
      now: 11_200
    });

    expect(secondDecision).toEqual({
      nextSource: "full-local",
      nextWarmupReadyAt: 9_000,
      clearFallbackReason: true
    });
  });
});
