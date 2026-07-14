"use client";

import {
  roomAudioActivationManager,
  type PrimeRoomAudioOutputsResult,
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

  async primeOutputs(input: PrimeRoomAudioOutputInput): Promise<PrimeRoomAudioOutputsResult> {
    return roomAudioActivationManager.activateOutputs(input);
  }

  async playElement(
    element: HTMLAudioElement | null | undefined
  ): Promise<RoomAudioElementPlayResult> {
    return roomAudioActivationManager.playElement(element);
  }

  applyVolume(input: ApplyRoomAudioVolumeInput) {
    const safeVolume = normalizeOutputVolume(input.volume);
    if (input.localAudio) {
      input.localAudio.volume = safeVolume;
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
    this.broadcastDestination?.disconnect();
    this.broadcastDestination = context.createMediaStreamDestination();
    return this.broadcastDestination;
  }

  getBroadcastStream() {
    return this.broadcastDestination?.stream ?? null;
  }

  clearBroadcastDestination() {
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
