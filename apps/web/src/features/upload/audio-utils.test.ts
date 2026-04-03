import { describe, expect, it, vi } from "vitest";
import { captureAudioStream } from "./audio-utils";

describe("captureAudioStream", () => {
  it("reuses the native captureStream result for the same audio element", () => {
    const stream = {
      getAudioTracks: () => []
    } as unknown as MediaStream;
    const captureStream = vi.fn(() => stream);
    const audio = {
      captureStream
    } as unknown as HTMLAudioElement;

    const first = captureAudioStream(audio);
    const second = captureAudioStream(audio);

    expect(first).toBe(stream);
    expect(second).toBe(stream);
    expect(captureStream).toHaveBeenCalledTimes(1);
  });
});
