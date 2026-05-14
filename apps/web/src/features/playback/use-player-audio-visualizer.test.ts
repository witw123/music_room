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
  it("selects the local audio stream while local playback is active", () => {
    const localStream = {
      getAudioTracks: () => [{ readyState: "live", enabled: true }]
    } as unknown as MediaStream;
    const localAudio = {
      srcObject: localStream
    } as unknown as HTMLAudioElement;

    expect(
      resolveVisualizerSourceSelection({
        audioElement: localAudio,
        activePlaybackSource: "progressive-local",
        currentTrackId: "track-a",
        mediaEpoch: 3,
        sourcePeerId: "peer_source",
        sourceSessionId: "member_source"
      })
    ).toMatchObject({
      kind: "local-stream",
      element: localAudio,
      stream: localStream,
      hasSignal: true
    });
  });

  it("returns an idle source when no active track is present", () => {
    expect(
      resolveVisualizerSourceSelection({
        audioElement: {} as HTMLAudioElement,
        activePlaybackSource: "full-local",
        currentTrackId: null
      })
    ).toEqual({
      kind: "none",
      stream: null,
      element: null,
      graphKey: "none",
      hasSignal: false
    });
  });

  it("falls back to local element capture when the element has a src but no stream", () => {
    const localAudio = {
      currentSrc: "blob:track-a"
    } as unknown as HTMLAudioElement;

    expect(
      resolveVisualizerSourceSelection({
        audioElement: localAudio,
        activePlaybackSource: "full-local",
        currentTrackId: "track-a",
        mediaEpoch: 5,
        sourcePeerId: "peer_source",
        sourceSessionId: "member_source"
      })
    ).toMatchObject({
      kind: "local-element",
      element: localAudio,
      stream: null,
      hasSignal: true
    });
  });

  it("changes the graph key when local playback enters a new session", () => {
    const localStream = {
      getAudioTracks: () => [{ readyState: "live", enabled: true }]
    } as unknown as MediaStream;
    const localAudio = {
      srcObject: localStream
    } as unknown as HTMLAudioElement;

    const first = resolveVisualizerSourceSelection({
      audioElement: localAudio,
      activePlaybackSource: "progressive-local",
      currentTrackId: "track-a",
      mediaEpoch: 1,
      sourcePeerId: "peer_source_a",
      sourceSessionId: "member_source"
    });
    const second = resolveVisualizerSourceSelection({
      audioElement: localAudio,
      activePlaybackSource: "progressive-local",
      currentTrackId: "track-a",
      mediaEpoch: 2,
      sourcePeerId: "peer_source_b",
      sourceSessionId: "member_source"
    });

    expect(first.kind).toBe("local-stream");
    expect(second.kind).toBe("local-stream");
    expect(first.graphKey).not.toBe(second.graphKey);
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
