"use client";

const SILENT_WAV_DATA_URI =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=";

type PrimeAudioElementInput = {
  element: HTMLAudioElement | null | undefined;
};

export type RoomAudioElementPlayResult = {
  ok: boolean;
  error: string | null;
};

export type PrimeRoomAudioOutputsResult = {
  ok: boolean;
  local: RoomAudioElementPlayResult;
  remote: RoomAudioElementPlayResult;
};

export class RoomAudioActivationManager {
  private sharedContext: AudioContext | null = null;
  private activated = false;

  async activateOutputs(input: {
    localAudio?: HTMLAudioElement | null;
    remoteAudio?: HTMLAudioElement | null;
  }): Promise<PrimeRoomAudioOutputsResult> {
    const [contextReady, local, remote] = await Promise.all([
      this.resumeSharedContext().catch(() => false),
      this.primeAudioElement({ element: input.localAudio }),
      this.primeAudioElement({ element: input.remoteAudio })
    ]);
    this.activated = contextReady || local.ok || remote.ok;
    return {
      ok: this.activated,
      local,
      remote
    };
  }

  async playElement(element: HTMLAudioElement | null | undefined): Promise<RoomAudioElementPlayResult> {
    if (!element) {
      return {
        ok: false,
        error: "missing-audio-element"
      };
    }

    try {
      await this.resumeSharedContext();
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

  private async primeAudioElement({
    element
  }: PrimeAudioElementInput): Promise<RoomAudioElementPlayResult> {
    if (!element) {
      return {
        ok: false,
        error: "missing-audio-element"
      };
    }

    const hadSrcObject = !!element.srcObject;
    const hadSrc = !!element.currentSrc || !!element.getAttribute("src");
    const originalMuted = element.muted;
    const originalVolume = element.volume;
    const originalPreload = element.preload;
    const wasPaused = element.paused;
    let usedSilentSource = false;

    try {
      element.muted = true;
      element.volume = 0;
      element.preload = "auto";

      // Prime the concrete media element inside the user gesture even before the
      // real room audio source is attached, otherwise the later async play() can
      // be treated as autoplay and produce "progress is moving but no sound yet".
      if (!hadSrcObject && !hadSrc) {
        element.src = SILENT_WAV_DATA_URI;
        this.safeCall(() => element.load());
        usedSilentSource = true;
      }

      await element.play();
      return {
        ok: true,
        error: null
      };
    } catch (error) {
      // Priming is best-effort only. Some embedded webviews and custom shells
      // throw synchronously on media mutations; callers should continue without
      // letting playback gestures crash the whole app.
      return {
        ok: false,
        error: error instanceof Error ? error.message : "play-rejected"
      };
    } finally {
      if (wasPaused) {
        this.safeCall(() => element.pause());
      }

      if (usedSilentSource) {
        this.safeCall(() => element.removeAttribute("src"));
        this.safeCall(() => element.load());
      }

      element.preload = originalPreload;
      element.muted = originalMuted;
      element.volume = originalVolume;
    }
  }

  private async resumeSharedContext() {
    const context = this.getOrCreateSharedContext();
    if (!context || context.state !== "suspended") {
      return context !== null;
    }

    try {
      await context.resume();
      return true;
    } catch {
      return false;
    }
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

  private safeCall(action: () => void) {
    try {
      action();
    } catch {
      // Ignore one-off media element failures during priming cleanup.
    }
  }
}

export const roomAudioActivationManager = new RoomAudioActivationManager();
