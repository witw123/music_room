"use client";

import {
  roomAudioActivationManager,
  type PrimeRoomAudioOutputsResult,
  type RoomAudioElementPlayResult
} from "./room-audio-activation-manager";

type PrimeRoomAudioOutputInput = {
  localAudio?: HTMLAudioElement | null;
  remoteAudio?: HTMLAudioElement | null;
};

type ApplyRoomAudioVolumeInput = {
  localAudio?: HTMLAudioElement | null;
  remoteAudio?: HTMLAudioElement | null;
  volume: number;
};

export class RoomAudioOutput {
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

    if (input.remoteAudio) {
      input.remoteAudio.volume = safeVolume;
    }
  }

  isActivated() {
    return roomAudioActivationManager.isActivated();
  }

  getSharedAudioContext() {
    return roomAudioActivationManager.getSharedAudioContext();
  }
}

export const roomAudioOutput = new RoomAudioOutput();

function normalizeOutputVolume(value: number) {
  if (!Number.isFinite(value)) {
    return 0.72;
  }

  return Math.min(1, Math.max(0, value));
}
