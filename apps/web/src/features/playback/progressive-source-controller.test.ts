import { describe, expect, it } from "vitest";
import {
  getRoomPlaybackSurfaceSource,
  getInitialProgressivePlaybackSource,
  getSlidingWindowPlaybackSource,
  shouldForceSourceOwnerLocalPlayback,
  resolveFullLocalWarmupDecision,
  resolveProgressiveWarmupDecision
} from "./progressive-source-controller";
import { getFullLocalStableWindowMs } from "./progressive-playback";

describe("progressive source controller", () => {
  const stableWindowMs = getFullLocalStableWindowMs();

  it("uses local playback sources only", () => {
    expect(getInitialProgressivePlaybackSource(true)).toBe("full-local");
    expect(getInitialProgressivePlaybackSource(false)).toBe("progressive-local");
  });

  it("routes FLAC and WAV to lossless local playback and MP3 to progressive local playback", () => {
    expect(getSlidingWindowPlaybackSource({ format: "flac", hasFullLocalTrack: false })).toBe("lossless-local");
    expect(getSlidingWindowPlaybackSource({ format: "wav", hasFullLocalTrack: false })).toBe("lossless-local");
    expect(getSlidingWindowPlaybackSource({ format: "mp3", hasFullLocalTrack: false })).toBe("progressive-local");
    expect(getSlidingWindowPlaybackSource({ format: "flac", hasFullLocalTrack: true })).toBe("full-local");
  });

  it("uses local playback for listeners when cache-only playback is enabled", () => {
    expect(
      getRoomPlaybackSurfaceSource({
        hasFullLocalTrack: false
      })
    ).toBe("progressive-local");
  });

  it("uses local playback for listeners regardless of legacy cache policy", () => {
    expect(
      getRoomPlaybackSurfaceSource({
        hasFullLocalTrack: false
      })
    ).toBe("progressive-local");
  });

  it("uses cache-only local playback as the inactive playback surface default", () => {
    expect(
      getRoomPlaybackSurfaceSource({
        hasFullLocalTrack: false
      })
    ).toBe("progressive-local");
  });

  it("does not force source owners that already use local playback", () => {
    expect(
      shouldForceSourceOwnerLocalPlayback({
        isCurrentSourceOwner: true,
        activePlaybackSource: "progressive-local",
        hasFullLocalTrack: true
      })
    ).toBe(true);
    expect(
      shouldForceSourceOwnerLocalPlayback({
        isCurrentSourceOwner: false,
        activePlaybackSource: "progressive-local",
        hasFullLocalTrack: true
      })
    ).toBe(false);
  });

  it("keeps forcing source owners onto full-local until they are fully off the remote path", () => {
    expect(
      shouldForceSourceOwnerLocalPlayback({
        isCurrentSourceOwner: true,
        activePlaybackSource: "progressive-local",
        hasFullLocalTrack: true
      })
    ).toBe(true);

    expect(
      shouldForceSourceOwnerLocalPlayback({
        isCurrentSourceOwner: true,
        activePlaybackSource: "full-local",
        hasFullLocalTrack: true
      })
    ).toBe(false);
  });

  it("requires a stable warmup window before switching to progressive local", () => {
    const firstDecision = resolveProgressiveWarmupDecision({
      currentSource: "progressive-local",
      engineReady: true,
      activationReady: true,
      fallbackReason: null,
      driftMs: 120,
      warmupReadyAt: null,
      now: 5_000
    });

    expect(firstDecision).toEqual({
      nextSource: "progressive-local",
      nextWarmupReadyAt: null,
      clearFallbackReason: false
    });

    const secondDecision = resolveProgressiveWarmupDecision({
      currentSource: "progressive-local",
      engineReady: true,
      activationReady: true,
      fallbackReason: null,
      driftMs: 80,
      warmupReadyAt: 5_000,
      now: 5_000 + stableWindowMs - 100
    });

    expect(secondDecision.nextSource).toBe("progressive-local");

    const thirdDecision = resolveProgressiveWarmupDecision({
      currentSource: "progressive-local",
      engineReady: true,
      activationReady: true,
      fallbackReason: null,
      driftMs: 80,
      warmupReadyAt: 5_000,
      now: 5_000 + stableWindowMs + 200
    });

    expect(thirdDecision).toEqual({
      nextSource: "progressive-local",
      nextWarmupReadyAt: 5_000,
      clearFallbackReason: false
    });
  });

  it("stays on progressive local while cache-only progressive playback is still warming up", () => {
    const decision = resolveProgressiveWarmupDecision({
      currentSource: "progressive-local",
      engineReady: false,
      activationReady: false,
      fallbackReason: "startup-buffering",
      driftMs: Number.POSITIVE_INFINITY,
      warmupReadyAt: null,
      now: 5_000,
      cacheOnlyPlayback: true
    });

    expect(decision).toEqual({
      nextSource: "progressive-local",
      nextWarmupReadyAt: null,
      clearFallbackReason: false
    });
  });

  it("resets warmup when drift spikes or fallback is active", () => {
    expect(
      resolveProgressiveWarmupDecision({
        currentSource: "progressive-local",
        engineReady: true,
        activationReady: true,
        fallbackReason: "buffer-underrun",
        driftMs: 40,
        warmupReadyAt: 5_000,
        now: 8_000
      })
    ).toEqual({
      nextSource: "progressive-local",
      nextWarmupReadyAt: null,
      clearFallbackReason: false
    });

    expect(
      resolveProgressiveWarmupDecision({
        currentSource: "progressive-local",
        engineReady: true,
        activationReady: true,
        fallbackReason: null,
        driftMs: 420,
        warmupReadyAt: 5_000,
        now: 8_000
      })
    ).toEqual({
      nextSource: "progressive-local",
      nextWarmupReadyAt: null,
      clearFallbackReason: false
    });
  });

  it("switches to full-local after a stable warmup once a full track becomes available", () => {
    const firstDecision = resolveFullLocalWarmupDecision({
      currentSource: "progressive-local",
      localReady: true,
      driftMs: 90,
      warmupReadyAt: null,
      now: 9_000
    });

    expect(firstDecision).toEqual({
      nextSource: "full-local",
      nextWarmupReadyAt: 9_000,
      clearFallbackReason: false
    });

    const secondDecision = resolveFullLocalWarmupDecision({
      currentSource: "progressive-local",
      localReady: true,
      driftMs: 70,
      warmupReadyAt: firstDecision.nextWarmupReadyAt,
      now: 9_000 + stableWindowMs + 200
    });

    expect(secondDecision).toEqual({
      nextSource: "full-local",
      nextWarmupReadyAt: 9_000,
      clearFallbackReason: true
    });
  });
});
