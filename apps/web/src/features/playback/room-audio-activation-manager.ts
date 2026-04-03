"use client";

type PrimeAudioElementInput = {
  element: HTMLAudioElement | null | undefined;
};

export type RoomAudioElementPlayResult = {
  ok: boolean;
  error: string | null;
};

export class RoomAudioActivationManager {
  private sharedContext: AudioContext | null = null;
  private activated = false;

  async activateOutputs(input: {
    localAudio?: HTMLAudioElement | null;
    remoteAudio?: HTMLAudioElement | null;
  }) {
    await Promise.all([
      this.resumeSharedContext(),
      this.primeAudioElement({ element: input.localAudio }),
      this.primeAudioElement({ element: input.remoteAudio })
    ]);
    this.activated = true;
  }

  async playElement(element: HTMLAudioElement | null | undefined): Promise<RoomAudioElementPlayResult> {
    if (!element) {
      return {
        ok: false,
        error: "missing-audio-element"
      };
    }

    await this.resumeSharedContext();

    try {
      await element.play();
      this.activated = true;
      return {
        ok: true,
        error: null
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "play-rejected"
      };
    }
  }

  isActivated() {
    return this.activated;
  }

  private async primeAudioElement({ element }: PrimeAudioElementInput) {
    if (!element) {
      return;
    }

    const hadSrcObject = !!element.srcObject;
    const hadSrc = !!element.currentSrc || !!element.getAttribute("src");
    const originalMuted = element.muted;
    const originalVolume = element.volume;
    const wasPaused = element.paused;

    if (!hadSrcObject && !hadSrc) {
      return;
    }

    try {
      element.muted = true;
      element.volume = 0;
      await element.play().catch(() => undefined);
    } finally {
      if (wasPaused) {
        element.pause();
      }

      element.muted = originalMuted;
      element.volume = originalVolume;
    }
  }

  private async resumeSharedContext() {
    const context = this.getOrCreateSharedContext();
    if (!context || context.state !== "suspended") {
      return;
    }

    await context.resume().catch(() => undefined);
  }

  private getOrCreateSharedContext() {
    if (typeof window === "undefined") {
      return null;
    }

    if (this.sharedContext) {
      return this.sharedContext;
    }

    const AudioContextCtor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) {
      return null;
    }

    try {
      this.sharedContext = new AudioContextCtor();
      return this.sharedContext;
    } catch {
      return null;
    }
  }
}

export const roomAudioActivationManager = new RoomAudioActivationManager();
