import { describe, expect, it } from "vitest";
import {
  buildIdleWaveformSamples,
  decayWaveformSamples,
  normalizeWaveformSamples,
  resolvePlayerAudioVisualizerRenderMode,
  resolvePlayerAudioVisualizerSampleCount,
  resolveVisualizerSourceSelection
} from "./use-player-audio-visualizer";

describe("resolveVisualizerSourceSelection", () => {
  it("selects the remote audio element while remote-stream is active", () => {
    const localAudio = {} as HTMLAudioElement;
    const remoteAudio = {} as HTMLAudioElement;

    expect(
      resolveVisualizerSourceSelection({
        audioElement: localAudio,
        remoteAudioElement: remoteAudio,
        activePlaybackSource: "remote-stream",
        currentTrackId: "track-a"
      })
    ).toEqual({
      kind: "remote",
      element: remoteAudio,
      graphKey: "track-a:remote-stream:remote"
    });
  });

  it("selects the local audio element while local playback is audible", () => {
    const localAudio = {} as HTMLAudioElement;
    const remoteAudio = {} as HTMLAudioElement;

    expect(
      resolveVisualizerSourceSelection({
        audioElement: localAudio,
        remoteAudioElement: remoteAudio,
        activePlaybackSource: "progressive-local",
        currentTrackId: "track-a"
      })
    ).toEqual({
      kind: "local",
      element: localAudio,
      graphKey: "track-a:progressive-local:local"
    });
  });

  it("returns an idle source when no active track is present", () => {
    expect(
      resolveVisualizerSourceSelection({
        audioElement: {} as HTMLAudioElement,
        remoteAudioElement: {} as HTMLAudioElement,
        activePlaybackSource: "full-local",
        currentTrackId: null
      })
    ).toEqual({
      kind: "none",
      element: null,
      graphKey: "none"
    });
  });
});

describe("resolvePlayerAudioVisualizerRenderMode", () => {
  it("enters live mode while playing", () => {
    expect(
      resolvePlayerAudioVisualizerRenderMode({
        playbackStatus: "playing",
        hasTrack: true,
        reducedMotion: false,
        hasLiveSignal: true
      })
    ).toBe("live");
  });

  it("enters reduced-motion mode when playback is active and motion is reduced", () => {
    expect(
      resolvePlayerAudioVisualizerRenderMode({
        playbackStatus: "playing",
        hasTrack: true,
        reducedMotion: true,
        hasLiveSignal: true
      })
    ).toBe("reduced-motion");
  });

  it("keeps a paused track in paused mode while audio remains available", () => {
    expect(
      resolvePlayerAudioVisualizerRenderMode({
        playbackStatus: "paused",
        hasTrack: true,
        reducedMotion: false,
        hasLiveSignal: true
      })
    ).toBe("paused");
  });

  it("falls back to idle mode without an active track", () => {
    expect(
      resolvePlayerAudioVisualizerRenderMode({
        playbackStatus: "paused",
        hasTrack: false,
        reducedMotion: false,
        hasLiveSignal: false
      })
    ).toBe("idle");
  });
});

describe("normalizeWaveformSamples", () => {
  it("normalizes analyser time-domain data into a fixed-width waveform", () => {
    const timeDomainData = new Uint8Array([128, 164, 128, 92, 128, 200, 128, 56]);

    expect(
      normalizeWaveformSamples({
        timeDomainData,
        sampleCount: 4
      }).map((sample) => Number(sample.toFixed(3)))
    ).toEqual([0.281, 0.281, 0.563, 0.563]);
  });

  it("softens the waveform when reduced motion is enabled", () => {
    const timeDomainData = new Uint8Array([128, 200, 128, 56]);

    const normal = normalizeWaveformSamples({
      timeDomainData,
      sampleCount: 2
    });
    const reduced = normalizeWaveformSamples({
      timeDomainData,
      sampleCount: 2,
      reducedMotion: true
    });

    expect(reduced[0]).toBeLessThan(normal[0]!);
    expect(reduced[1]).toBeLessThan(normal[1]!);
  });
});

describe("decayWaveformSamples", () => {
  it("decays paused samples toward a low-amplitude floor instead of dropping to zero", () => {
    const decayed = decayWaveformSamples([0.9, 0.6, 0.2], 0.5, 0.04);

    expect(decayed[0]).toBeCloseTo(0.45);
    expect(decayed[1]).toBeCloseTo(0.3);
    expect(decayed[2]).toBeGreaterThan(0.04);
  });
});

describe("buildIdleWaveformSamples", () => {
  it("returns a stable idle waveform with the requested width", () => {
    const samples = buildIdleWaveformSamples(40);

    expect(samples).toHaveLength(40);
    expect(Math.min(...samples)).toBeGreaterThan(0);
  });
});

describe("resolvePlayerAudioVisualizerSampleCount", () => {
  it("uses mobile and desktop sample counts at the expected breakpoint", () => {
    expect(resolvePlayerAudioVisualizerSampleCount(390)).toBe(40);
    expect(resolvePlayerAudioVisualizerSampleCount(1280)).toBe(64);
  });
});
