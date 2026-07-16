import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PlaybackAssetManifest,
  PlaybackSnapshot
} from "@music-room/shared";
import type { AudioAssetUnitRecord } from "@/lib/indexeddb";
import { roomAudioOutput } from "./room-audio-output";
import { SegmentedOpusEngine } from "./segmented-opus-engine";

class FakeSource {
  buffer: AudioBuffer | null = null;
  playbackRate = { value: 1 };
  onended: (() => void) | null = null;
  starts: Array<{ when: number; offset: number }> = [];
  connectedTo: unknown = null;
  stopped = false;
  disconnectCount = 0;

  connect(target: unknown) {
    this.connectedTo = target;
    return target;
  }
  disconnect() {
    this.disconnectCount += 1;
  }
  start(when = 0, offset = 0) {
    this.starts.push({ when, offset });
  }
  stop() {
    this.stopped = true;
  }
}

function createContext() {
  const sources: FakeSource[] = [];
  const gains: Array<{
    gain: {
      value: number;
      setValueAtTime: ReturnType<typeof vi.fn>;
      linearRampToValueAtTime: ReturnType<typeof vi.fn>;
    };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  const createGain = vi.fn(() => {
    const gain = {
      value: 1,
      setValueAtTime: vi.fn((value: number) => {
        gain.value = value;
      }),
      linearRampToValueAtTime: vi.fn((value: number) => {
        gain.value = value;
      })
    };
    const next = {
      gain,
      connect: vi.fn(),
      disconnect: vi.fn()
    };
    gains.push(next);
    return next;
  });
  const buffer = {
    duration: 2,
    sampleRate: 48_000,
    length: 96_000,
    numberOfChannels: 2,
    getChannelData: () => new Float32Array(96_000)
  } as unknown as AudioBuffer;
  const context = {
    state: "running",
    currentTime: 10,
    destination: {},
    createGain,
    createBufferSource: vi.fn(() => {
      const source = new FakeSource();
      sources.push(source);
      return source;
    }),
    decodeAudioData: vi.fn(async () => buffer),
    createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => ({
      duration: length / sampleRate,
      sampleRate,
      length,
      numberOfChannels: channels,
      getChannelData: () => new Float32Array(length),
      copyToChannel: vi.fn()
    }))
  } as unknown as AudioContext;
  return { context, sources, gains };
}

const manifest = {
  assetId: "a".repeat(64),
  kind: "playback",
  sourceFileHash: "b".repeat(64),
  profileId: "opus-music-v2",
  codec: "opus",
  container: "audio/ogg",
  sampleRate: 48_000,
  channels: 2,
  bitrate: 192_000,
  durationMs: 10_000,
  segmentDurationMs: 2_000,
  seekPrerollMs: 80,
  unitCount: 5,
  merkleRoot: "c".repeat(64),
  encoder: { name: "@audio/opus-encode", version: "2.0.0" }
} as PlaybackAssetManifest;

function playback(serverNowMs: number): PlaybackSnapshot {
  return {
    status: "playing",
    currentTrackId: "track_1",
    currentQueueItemId: null,
    positionMs: 0,
    startAt: new Date(serverNowMs + 1_000).toISOString(),
    sourcePeerId: "peer_a",
    sourceSessionId: "user_a",
    mediaEpoch: 1,
    revision: 1,
    queueVersion: 1
  } as unknown as PlaybackSnapshot;
}

function unit(unitIndex: number): AudioAssetUnitRecord {
  return {
    unitId: `${manifest.assetId}:${unitIndex}`,
    assetId: manifest.assetId,
    kind: "playback",
    unitIndex,
    payloadBytes: 1,
    contentHash: "d".repeat(64),
    proof: [],
    startMs: unitIndex * 2_000,
    durationMs: 2_000,
    trimStartSamples: unitIndex === 0 ? 0 : 3_840,
    trimEndSamples: 0,
    payload: new Uint8Array([unitIndex]).buffer,
    lastAccessedAt: new Date(0).toISOString(),
    protectedUntil: null
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SegmentedOpusEngine", () => {
  it("requires the configured startup window before scheduling", async () => {
    const { context, sources } = createContext();
    vi.spyOn(roomAudioOutput, "getSharedAudioContext").mockReturnValue(context);
    const engine = new SegmentedOpusEngine();

    const result = await engine.sync({
      manifest,
      playback: playback(Date.now()),
      serverNowMs: Date.now(),
      volume: 0.7,
      getUnit: async (unitIndex) => unitIndex < 2 ? unit(unitIndex) : null
    });

    expect(result.state).toBe("buffering");
    expect(context.createBuffer).not.toHaveBeenCalled();
    expect(sources).toHaveLength(2);
    engine.destroy();
  });

  it("schedules the current segment before decode-ahead work finishes", async () => {
    const { context, sources } = createContext();
    let releaseDecodeAhead!: () => void;
    const decodeAhead = new Promise<AudioBuffer>((resolve) => {
      releaseDecodeAhead = () => resolve({
        duration: 2,
        sampleRate: 48_000,
        length: 96_000,
        numberOfChannels: 2,
        getChannelData: () => new Float32Array(96_000)
      } as unknown as AudioBuffer);
    });
    vi.mocked(context.decodeAudioData).mockImplementation(async (payload) =>
      new Uint8Array(payload)[0] === 0
        ? {
            duration: 2,
            sampleRate: 48_000,
            length: 96_000,
            numberOfChannels: 2,
            getChannelData: () => new Float32Array(96_000)
          } as unknown as AudioBuffer
        : decodeAhead
    );
    vi.spyOn(roomAudioOutput, "getSharedAudioContext").mockReturnValue(context);
    const engine = new SegmentedOpusEngine();

    const syncing = engine.sync({
      manifest,
      playback: playback(Date.now()),
      serverNowMs: Date.now(),
      volume: 0.7,
      getUnit: async (unitIndex) => unit(unitIndex)
    });
    await vi.waitFor(() => expect(sources).toHaveLength(1));

    releaseDecodeAhead();
    await syncing;
    expect(sources).toHaveLength(5);
    engine.destroy();
  });

  it("parallel-decodes ahead and schedules one contiguous master-gain timeline", async () => {
    const { context, sources, gains } = createContext();
    vi.spyOn(roomAudioOutput, "getSharedAudioContext").mockReturnValue(context);
    const engine = new SegmentedOpusEngine();
    const serverNowMs = Date.now();

    const result = await engine.sync({
      manifest,
      playback: playback(serverNowMs),
      serverNowMs,
      volume: 0.65,
      getUnit: async (unitIndex) => unit(unitIndex)
    });

    expect(result).toEqual({ state: "live", bufferedUnits: 5 });
    expect(context.decodeAudioData).toHaveBeenCalledTimes(5);
    expect(context.createGain).toHaveBeenCalledTimes(8);
    expect(gains[2]?.gain.value).toBe(0.65);
    expect(gains[4]?.gain.linearRampToValueAtTime).not.toHaveBeenCalled();
    expect(sources).toHaveLength(5);
    expect(sources.every((source) => source.connectedTo !== gains[2])).toBe(true);
    expect(sources.map((source) => source.starts[0]?.when)).toEqual([11, 13, 15, 17, 19]);

    await engine.sync({
      manifest,
      playback: playback(serverNowMs),
      serverNowMs,
      volume: 0.4,
      getUnit: async (unitIndex) => unit(unitIndex)
    });
    expect(context.createBufferSource).toHaveBeenCalledTimes(5);
    expect(gains[2]?.gain.value).toBe(0.4);
    sources.forEach((source) => source.onended?.());
    const ended = await engine.sync({
      manifest,
      playback: playback(serverNowMs),
      serverNowMs: serverNowMs + 11_000,
      volume: 0.4,
      getUnit: async (unitIndex) => unit(unitIndex)
    });
    expect(ended.state).toBe("ended");
    engine.destroy();
  });

  it("does not reread cached units on every scheduler tick", async () => {
    const { context } = createContext();
    vi.spyOn(roomAudioOutput, "getSharedAudioContext").mockReturnValue(context);
    const engine = new SegmentedOpusEngine();
    const getUnit = vi.fn(async (unitIndex: number) => unit(unitIndex));
    const serverNowMs = Date.now();

    await engine.sync({
      manifest,
      playback: playback(serverNowMs),
      serverNowMs,
      volume: 0.7,
      getUnit
    });
    await engine.sync({
      manifest,
      playback: playback(serverNowMs),
      serverNowMs: serverNowMs + 100,
      volume: 0.7,
      getUnit
    });

    expect(getUnit).toHaveBeenCalledTimes(manifest.unitCount);
    engine.destroy();
  });

  it("stops the old timeline and schedules a seek target immediately", async () => {
    const { context, sources } = createContext();
    vi.spyOn(roomAudioOutput, "getSharedAudioContext").mockReturnValue(context);
    const engine = new SegmentedOpusEngine();
    const serverNowMs = Date.now();

    await engine.sync({
      manifest,
      playback: playback(serverNowMs),
      serverNowMs,
      volume: 0.7,
      getUnit: async (unitIndex) => unit(unitIndex)
    });
    const previousSources = [...sources];

    await engine.sync({
      manifest,
      playback: {
        ...playback(serverNowMs),
        positionMs: 4_000,
        startAt: new Date(serverNowMs).toISOString(),
        startedAt: new Date(serverNowMs).toISOString(),
        playbackRevision: 2
      },
      serverNowMs,
      volume: 0.7,
      getUnit: async (unitIndex) => unit(unitIndex)
    });

    expect(previousSources.every((source) => source.stopped)).toBe(true);
    expect(previousSources.every((source) => source.disconnectCount === 0)).toBe(true);
    expect(sources).toHaveLength(8);
    expect(sources[5]?.starts[0]).toEqual({ when: 10.08, offset: 0 });
    engine.destroy();
  });

  it("reuses decoded units when pausing and resuming the same track", async () => {
    const { context, sources } = createContext();
    vi.spyOn(roomAudioOutput, "getSharedAudioContext").mockReturnValue(context);
    const engine = new SegmentedOpusEngine();
    const serverNowMs = Date.now();
    const getUnit = vi.fn(async (unitIndex: number) => unit(unitIndex));
    const decodeAudioData = vi.mocked(context.decodeAudioData);

    await engine.sync({
      manifest,
      playback: playback(serverNowMs),
      serverNowMs,
      volume: 0.7,
      getUnit
    });
    const initialDecodeCount = decodeAudioData.mock.calls.length;

    await engine.sync({
      manifest,
      playback: {
        ...playback(serverNowMs),
        status: "paused",
        positionMs: 2_000,
        startAt: null,
        startedAt: null,
        playbackRevision: 2
      },
      serverNowMs,
      volume: 0.7,
      getUnit
    });
    await engine.sync({
      manifest,
      playback: {
        ...playback(serverNowMs),
        positionMs: 2_000,
        startAt: new Date(serverNowMs).toISOString(),
        startedAt: new Date(serverNowMs).toISOString(),
        playbackRevision: 3
      },
      serverNowMs,
      volume: 0.7,
      getUnit
    });

    expect(decodeAudioData.mock.calls.length).toBe(initialDecodeCount);
    expect(sources.length).toBeGreaterThan(5);
    engine.destroy();
  });
});
