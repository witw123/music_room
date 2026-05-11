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
    if (input.localAudio) {
      input.localAudio.volume = input.volume;
    }

    if (input.remoteAudio) {
      input.remoteAudio.volume = input.volume;
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
