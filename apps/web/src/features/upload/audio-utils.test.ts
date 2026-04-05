import { describe, expect, it, vi } from "vitest";
import { captureAudioStream, getCapturedAudioStreamMode } from "./audio-utils";

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
    expect(getCapturedAudioStreamMode(audio)).toBe("native");
  });

  it("falls back to null instead of throwing when media capture APIs fail", () => {
    const audio = {
      captureStream: vi.fn(() => {
        throw new DOMException("capture failed", "InvalidStateError");
      })
    } as unknown as HTMLAudioElement;

    expect(captureAudioStream(audio)).toBeNull();
  });

  it("rebuilds the cached capture stream when forceRefresh is requested", () => {
    const firstStream = {
      getAudioTracks: () => [],
      getTracks: () => []
    } as unknown as MediaStream;
    const secondStream = {
      getAudioTracks: () => [],
      getTracks: () => []
    } as unknown as MediaStream;
    const captureStream = vi
      .fn<() => MediaStream>()
      .mockReturnValueOnce(firstStream)
      .mockReturnValueOnce(secondStream);
    const audio = {
      captureStream
    } as unknown as HTMLAudioElement;

    const first = captureAudioStream(audio);
    const refreshed = captureAudioStream(audio, { forceRefresh: true });

    expect(first).toBe(firstStream);
    expect(refreshed).toBe(secondStream);
    expect(captureStream).toHaveBeenCalledTimes(2);
  });

  it("prefers the audio context capture path when requested", () => {
    const captureStream = vi.fn(() => ({
      getAudioTracks: () => [{ id: "native-track" }],
      getTracks: () => [{ id: "native-track", stop: vi.fn() }]
    }));
    const destinationStream = {
      getAudioTracks: () => [{ id: "context-track" }],
      getTracks: () => [{ id: "context-track", stop: vi.fn() }]
    } as unknown as MediaStream;
    const resume = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn();
    const createMediaElementSource = vi.fn(() => ({ connect }));
    const createMediaStreamDestination = vi.fn(() => ({
      stream: destinationStream
    }));

    const previousWindow = (globalThis as { window?: unknown }).window;
    const testWindow = {
      AudioContext: vi.fn().mockImplementation(() => ({
        state: "running",
        resume,
        close,
        createMediaElementSource,
        createMediaStreamDestination,
        destination: {}
      }))
    } as unknown as Window;
    (globalThis as { window?: unknown }).window = testWindow;

    const audio = {
      captureStream
    } as unknown as HTMLAudioElement;

    const stream = captureAudioStream(audio, { preferAudioContext: true });

    expect(stream).toBe(destinationStream);
    expect(captureStream).not.toHaveBeenCalled();
    expect(createMediaElementSource).toHaveBeenCalledWith(audio);
    expect(getCapturedAudioStreamMode(audio)).toBe("audio-context");

    (globalThis as { window?: unknown }).window = previousWindow;
  });

  it("reuses the existing audio-context capture graph when forceRefresh is requested", () => {
    const destinationStream = {
      getAudioTracks: () => [{ id: "context-track" }],
      getTracks: () => [{ id: "context-track", stop: vi.fn() }]
    } as unknown as MediaStream;
    const resume = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn();
    const createMediaElementSource = vi.fn(() => ({ connect }));
    const createMediaStreamDestination = vi.fn(() => ({
      stream: destinationStream
    }));

    const previousWindow = (globalThis as { window?: unknown }).window;
    const testWindow = {
      AudioContext: vi.fn().mockImplementation(() => ({
        state: "running",
        resume,
        close,
        createMediaElementSource,
        createMediaStreamDestination,
        destination: {}
      }))
    } as unknown as Window;
    (globalThis as { window?: unknown }).window = testWindow;

    const audio = {
      captureStream: vi.fn(() => ({
        getAudioTracks: () => [{ id: "native-track" }],
        getTracks: () => [{ id: "native-track", stop: vi.fn() }]
      }))
    } as unknown as HTMLAudioElement;

    const first = captureAudioStream(audio, { preferAudioContext: true });
    const refreshed = captureAudioStream(audio, {
      forceRefresh: true,
      preferAudioContext: true
    });

    expect(first).toBe(destinationStream);
    expect(refreshed).toBe(destinationStream);
    expect(createMediaElementSource).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();

    (globalThis as { window?: unknown }).window = previousWindow;
  });
});
