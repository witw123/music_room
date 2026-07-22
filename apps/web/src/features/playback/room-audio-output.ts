"use client";

import {
  roomAudioActivationManager,
  type PrimeRoomAudioOutputsResult,
  type RoomAudioElementPlayOptions,
  type RoomAudioElementPlayResult
} from "./room-audio-activation-manager";

type PrimeRoomAudioOutputInput = {
  localAudio?: HTMLAudioElement | null;
};

type ApplyRoomAudioVolumeInput = {
  localAudio?: HTMLAudioElement | null;
  volume: number;
};

type LocalAudioElementGraph = {
  element: HTMLAudioElement;
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  localGain: GainNode;
};

export class RoomAudioOutput {
  private broadcastDestination: MediaStreamAudioDestinationNode | null = null;
  private localAudioElementGraph: LocalAudioElementGraph | null = null;
  private readonly localAudioElementSources = new WeakMap<
    HTMLAudioElement,
    { context: AudioContext; source: MediaElementAudioSourceNode }
  >();
  private readonly volumeAnimationFrames = new WeakMap<HTMLAudioElement, number>();

  async primeOutputs(input: PrimeRoomAudioOutputInput): Promise<PrimeRoomAudioOutputsResult> {
    return roomAudioActivationManager.activateOutputs(input);
  }

  async playElement(
    element: HTMLAudioElement | null | undefined,
    options?: RoomAudioElementPlayOptions
  ): Promise<RoomAudioElementPlayResult> {
    return roomAudioActivationManager.playElement(element, options);
  }

  applyVolume(input: ApplyRoomAudioVolumeInput) {
    const safeVolume = normalizeOutputVolume(input.volume);
    if (input.localAudio) {
      const element = input.localAudio;
      const localGraph = this.localAudioElementGraph?.element === element
        ? this.localAudioElementGraph
        : null;
      const previousFrame = this.volumeAnimationFrames.get(element);
      if (previousFrame !== undefined && typeof window !== "undefined") {
        window.cancelAnimationFrame(previousFrame);
      }
      if (localGraph) {
        try {
          const now = localGraph.context.currentTime;
          localGraph.localGain.gain.cancelScheduledValues(now);
          localGraph.localGain.gain.setTargetAtTime(safeVolume, now, 0.02);
        } catch {
          localGraph.localGain.gain.value = safeVolume;
        }
        element.volume = 1;
        return;
      }
      if (
        typeof window === "undefined" ||
        typeof window.requestAnimationFrame !== "function"
      ) {
        element.volume = safeVolume;
        return;
      }
      const startVolume = element.volume;
      const startedAt = performance.now();
      const durationMs = 20;
      const animate = (now: number) => {
        const progress = Math.min(1, Math.max(0, (now - startedAt) / durationMs));
        element.volume = startVolume + (safeVolume - startVolume) * progress;
        if (progress < 1) {
          this.volumeAnimationFrames.set(element, window.requestAnimationFrame(animate));
        } else {
          this.volumeAnimationFrames.delete(element);
        }
      };
      this.volumeAnimationFrames.set(element, window.requestAnimationFrame(animate));
    }
  }

  bindLocalAudioElement(element: HTMLAudioElement | null | undefined) {
    if (!element) {
      return null;
    }

    const context = this.getSharedAudioContext();
    if (
      !context ||
      typeof context.createMediaElementSource !== "function" ||
      typeof context.createGain !== "function"
    ) {
      return null;
    }

    const destination = this.getBroadcastDestination(context);
    if (!destination) {
      return null;
    }

    if (
      this.localAudioElementGraph?.element === element &&
      this.localAudioElementGraph.context === context
    ) {
      return destination.stream;
    }

    this.disposeLocalAudioElementGraph();
    try {
      const cachedSource = this.localAudioElementSources.get(element);
      const source = cachedSource?.context === context
        ? cachedSource.source
        : context.createMediaElementSource(element);
      this.localAudioElementSources.set(element, { context, source });
      source.disconnect();

      const localGain = context.createGain();
      localGain.gain.value = normalizeOutputVolume(element.volume);
      source.connect(localGain);
      localGain.connect(context.destination);
      source.connect(destination);
      this.localAudioElementGraph = {
        element,
        context,
        source,
        localGain
      };
      // Volume is controlled by localGain so the source member's volume does
      // not reduce the level sent to other room members.
      element.volume = 1;
      return destination.stream;
    } catch {
      this.disposeLocalAudioElementGraph();
      return null;
    }
  }

  unbindLocalAudioElement(element?: HTMLAudioElement | null) {
    if (!element || this.localAudioElementGraph?.element === element) {
      this.disposeLocalAudioElementGraph();
    }
  }

  isActivated() {
    return roomAudioActivationManager.isActivated();
  }

  isAudioContextReady() {
    return roomAudioActivationManager.isAudioContextReady();
  }

  getSharedAudioContext() {
    return roomAudioActivationManager.getSharedAudioContext();
  }

  getBroadcastDestination(context = this.getSharedAudioContext()) {
    if (!context) {
      return null;
    }
    if (this.broadcastDestination && this.broadcastDestination.context === context) {
      return this.broadcastDestination;
    }
    this.disposeLocalAudioElementGraph();
    if (typeof context.createMediaStreamDestination !== "function") {
      return null;
    }
    this.disposeBroadcastDestination();
    this.broadcastDestination = context.createMediaStreamDestination();
    return this.broadcastDestination;
  }

  getBroadcastStream() {
    return this.broadcastDestination?.stream ?? null;
  }

  getBroadcastTrackId() {
    return this.broadcastDestination?.stream.getAudioTracks()[0]?.id ?? null;
  }

  releaseRoomAudioSession() {
    this.disposeLocalAudioElementGraph();
    this.disposeBroadcastDestination();
  }

  private disposeLocalAudioElementGraph() {
    const graph = this.localAudioElementGraph;
    if (!graph) {
      return;
    }
    try {
      graph.source.disconnect();
    } catch {
      // The source may already be disconnected during a context transition.
    }
    try {
      graph.localGain.disconnect();
    } catch {
      // The gain may already be disconnected during a context transition.
    }
    this.localAudioElementGraph = null;
  }

  private disposeBroadcastDestination() {
    this.broadcastDestination?.disconnect();
    for (const track of this.broadcastDestination?.stream.getTracks() ?? []) {
      track.stop();
    }
    this.broadcastDestination = null;
  }
}

export const roomAudioOutput = new RoomAudioOutput();

function normalizeOutputVolume(value: number) {
  if (!Number.isFinite(value)) {
    return 0.72;
  }

  return Math.min(1, Math.max(0, value));
}
