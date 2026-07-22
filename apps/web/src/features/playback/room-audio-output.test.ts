import { afterEach, describe, expect, it, vi } from "vitest";
import { roomAudioOutput } from "./room-audio-output";

function createAudioContextMock() {
  const source = {
    connect: vi.fn(),
    disconnect: vi.fn()
  };
  const gain = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: {
      value: 0.72,
      cancelScheduledValues: vi.fn(),
      setTargetAtTime: vi.fn()
    }
  };
  const track = {
    id: "broadcast-track",
    stop: vi.fn()
  };
  const broadcastDestination = {
    context: null as unknown,
    disconnect: vi.fn(),
    stream: {
      id: "broadcast-stream",
      getAudioTracks: () => [track],
      getTracks: () => [track]
    }
  };
  const context = {
    currentTime: 12,
    destination: {},
    createGain: vi.fn(() => gain),
    createMediaElementSource: vi.fn(() => source),
    createMediaStreamDestination: vi.fn(() => broadcastDestination),
    state: "running"
  };
  broadcastDestination.context = context;
  return { broadcastDestination, context, gain, source, track };
}

describe("room audio output", () => {
  afterEach(() => {
    roomAudioOutput.releaseRoomAudioSession();
    vi.restoreAllMocks();
  });

  it("keeps member volume local while broadcasting the source at full level", () => {
    const { broadcastDestination, context, gain, source } = createAudioContextMock();
    vi.spyOn(roomAudioOutput, "getSharedAudioContext")
      .mockReturnValue(context as unknown as AudioContext);
    const audio = { volume: 0.35 } as HTMLAudioElement;

    expect(roomAudioOutput.bindLocalAudioElement(audio)).toBe(broadcastDestination.stream);
    expect(source.connect).toHaveBeenCalledWith(gain);
    expect(source.connect).toHaveBeenCalledWith(broadcastDestination);
    expect(gain.connect).toHaveBeenCalledWith(context.destination);
    expect(audio.volume).toBe(1);

    roomAudioOutput.applyVolume({ localAudio: audio, volume: 0.2 });

    expect(gain.gain.setTargetAtTime).toHaveBeenCalledWith(0.2, 12, 0.02);
    expect(audio.volume).toBe(1);
  });

  it("disconnects the local graph before a new source is bound", () => {
    const { context, gain, source } = createAudioContextMock();
    vi.spyOn(roomAudioOutput, "getSharedAudioContext")
      .mockReturnValue(context as unknown as AudioContext);
    const firstAudio = { volume: 1 } as HTMLAudioElement;
    const secondAudio = { volume: 1 } as HTMLAudioElement;

    roomAudioOutput.bindLocalAudioElement(firstAudio);
    roomAudioOutput.bindLocalAudioElement(secondAudio);

    expect(source.disconnect).toHaveBeenCalled();
    expect(gain.disconnect).toHaveBeenCalled();
  });
});
