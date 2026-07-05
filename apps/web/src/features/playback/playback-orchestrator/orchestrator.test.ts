import { describe, expect, it, vi } from "vitest";
import { PlaybackOrchestrator } from "./orchestrator";

describe("PlaybackOrchestrator", () => {
  it("runs a single mounted tick loop with the latest input", () => {
    const intervalIds: number[] = [];
    const intervalCallbacks: Array<() => void> = [];
    const clearInterval = vi.fn();
    const reduceTick = vi.fn(({ state, input }) => ({
      nextState: {
        count: state.count + input.delta
      },
      effects: [`effect:${input.delta}`]
    }));
    const runEffect = vi.fn();

    const orchestrator = new PlaybackOrchestrator({
      initialState: { count: 0 },
      initialInput: { delta: 1 },
      initialSnapshot: { count: 0 },
      tickMs: 150,
      getEngineSnapshot: () => ({ buffered: true }),
      reduceTick,
      runEffect,
      buildSnapshot: ({ state }) => ({ count: state.count }),
      nowMs: () => 1_000,
      scheduler: {
        setInterval: (callback, delayMs) => {
          expect(delayMs).toBe(150);
          intervalCallbacks.push(callback);
          const id = intervalCallbacks.length;
          intervalIds.push(id);
          return id;
        },
        clearInterval
      }
    });

    orchestrator.mount();
    orchestrator.mount();
    orchestrator.updateInput({ delta: 3 });
    intervalCallbacks[0]?.();

    expect(intervalIds).toEqual([1]);
    expect(reduceTick).toHaveBeenCalledWith({
      state: { count: 0 },
      input: { delta: 3 },
      engineSnapshot: { buffered: true },
      nowMs: 1_000
    });
    expect(runEffect).toHaveBeenCalledWith("effect:3");
    expect(orchestrator.getSnapshot()).toEqual({ count: 3 });

    orchestrator.unmount();
    orchestrator.unmount();
    expect(clearInterval).toHaveBeenCalledOnce();
    expect(clearInterval).toHaveBeenCalledWith(1);
  });

  it("notifies subscribers after ticks and stops notifying unsubscribed listeners", () => {
    const intervalCallbacks: Array<() => void> = [];
    const listener = vi.fn();
    const orchestrator = new PlaybackOrchestrator({
      initialState: { count: 0 },
      initialInput: { delta: 1 },
      initialSnapshot: { count: 0 },
      tickMs: 150,
      getEngineSnapshot: () => null,
      reduceTick: ({ state, input }) => ({
        nextState: {
          count: state.count + input.delta
        },
        effects: []
      }),
      runEffect: () => undefined,
      buildSnapshot: ({ state }) => ({ count: state.count }),
      nowMs: () => 2_000,
      scheduler: {
        setInterval: (callback) => {
          intervalCallbacks.push(callback);
          return intervalCallbacks.length;
        },
        clearInterval: () => undefined
      }
    });
    const unsubscribe = orchestrator.subscribe(listener);

    orchestrator.mount();
    intervalCallbacks[0]?.();
    unsubscribe();
    intervalCallbacks[0]?.();

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith();
    expect(orchestrator.getSnapshot()).toEqual({ count: 2 });
  });

  it("supports useSyncExternalStore-style snapshot listeners", () => {
    const intervalCallbacks: Array<() => void> = [];
    const listener = vi.fn();
    const orchestrator = new PlaybackOrchestrator({
      initialState: { count: 0 },
      initialInput: { delta: 2 },
      initialSnapshot: { count: 0 },
      tickMs: 150,
      getEngineSnapshot: () => null,
      reduceTick: ({ state, input }) => ({
        nextState: {
          count: state.count + input.delta
        },
        effects: []
      }),
      runEffect: () => undefined,
      buildSnapshot: ({ state }) => ({ count: state.count }),
      scheduler: {
        setInterval: (callback) => {
          intervalCallbacks.push(callback);
          return intervalCallbacks.length;
        },
        clearInterval: () => undefined
      }
    });
    const unsubscribe = orchestrator.subscribe(listener);

    orchestrator.mount();
    intervalCallbacks[0]?.();
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith();
    expect(orchestrator.getSnapshot()).toEqual({ count: 2 });

    unsubscribe();
    intervalCallbacks[0]?.();
    expect(listener).toHaveBeenCalledOnce();
    expect(orchestrator.getSnapshot()).toEqual({ count: 4 });
  });
});
