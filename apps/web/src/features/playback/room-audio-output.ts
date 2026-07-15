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

export class RoomAudioOutput {
  private broadcastDestination: MediaStreamAudioDestinationNode | null = null;
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
      const previousFrame = this.volumeAnimationFrames.get(element);
      if (previousFrame !== undefined && typeof window !== "undefined") {
        window.cancelAnimationFrame(previousFrame);
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
    this.disposeBroadcastDestination();
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
