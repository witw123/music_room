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

export type RoomAudioElementPlayOptions = {
  force?: boolean;
};

export type PrimeRoomAudioOutputsResult = {
  ok: boolean;
  local: RoomAudioElementPlayResult;
};

export class RoomAudioActivationManager {
  private sharedContext: AudioContext | null = null;
  private activated = false;
  private readonly playedElementSourceKeys = new WeakMap<HTMLAudioElement, string>();
  private readonly sourceObjectIds = new WeakMap<object, number>();
  private nextSourceObjectId = 1;

  async activateOutputs(input: {
    localAudio?: HTMLAudioElement | null;
  }): Promise<PrimeRoomAudioOutputsResult> {
    const [contextReady, local] = await Promise.all([
      this.resumeSharedContext().catch(() => false),
      this.primeAudioElement({ element: input.localAudio })
    ]);
    this.activated = contextReady || local.ok;
    if (local.ok && input.localAudio) {
      this.rememberElementSource(input.localAudio);
    }
    return {
      ok: this.activated,
      local
    };
  }

  async playElement(
    element: HTMLAudioElement | null | undefined,
    options: RoomAudioElementPlayOptions = {}
  ): Promise<RoomAudioElementPlayResult> {
    if (!element) {
      return {
        ok: false,
        error: "missing-audio-element"
      };
    }

    try {
      await this.resumeSharedContext();
      const sourceKey = this.getElementSourceKey(element);
      // If the same concrete media source is already playing, skip play() to
      // avoid a potential NotAllowedError when the user gesture that started
      // playback has expired.  When track switching replaces src/srcObject,
      // the element may still report paused=false from the previous source;
      // in that case we must call play() for the new source or the UI can
      // advance while the new song stays silent.
      if (
        !options.force &&
        !element.paused &&
        this.playedElementSourceKeys.get(element) === sourceKey
      ) {
        this.activated = true;
        return {
          ok: true,
          error: null
        };
      }
      await element.play();
      this.activated = true;
      this.playedElementSourceKeys.set(element, sourceKey);
      return {
        ok: true,
        error: null
      };
    } catch (error) {
      if (!isAutoplayBlockedError(error)) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "play-rejected"
        };
      }

      const originalMuted = element.muted;
      const originalVolume = element.volume;
      try {
        // Chromium permits muted autoplay even after the transient click token
        // has expired. Start the concrete local source muted, then restore
        // its audible state without replacing or reloading the element again.
        element.muted = true;
        await element.play();
        this.activated = true;
        this.playedElementSourceKeys.set(element, this.getElementSourceKey(element));
        return {
          ok: true,
          error: null
        };
      } catch (retryError) {
        return {
          ok: false,
          error: retryError instanceof Error ? retryError.message : "play-rejected"
        };
      } finally {
        element.muted = originalMuted;
        element.volume = originalVolume;
      }
    }
  }

  isActivated() {
    return this.activated;
  }

  isAudioContextReady() {
    return this.sharedContext?.state === "running";
  }

  getSharedAudioContext() {
    return this.getOrCreateSharedContext();
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
      // Keep a bound WebRTC element playing after priming so a later RTP
      // recovery does not need another user gesture.
      // Pausing here would require a new user gesture for the next play(),
      // which browsers block once the gesture token expires. The element
      // should remain in "playing" state so scheduled audio flows naturally
      // through the Web Audio graph without requiring another play() call.
      if (wasPaused && !hadSrcObject && !hadSrc) {
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

  private rememberElementSource(element: HTMLAudioElement) {
    this.playedElementSourceKeys.set(element, this.getElementSourceKey(element));
  }

  private getElementSourceKey(element: HTMLAudioElement) {
    const srcObject = element.srcObject;
    if (srcObject) {
      return `srcObject:${this.getSourceObjectId(srcObject)}`;
    }

    const currentSrc = element.src || this.safeGetAttribute(element, "src") || element.currentSrc;
    return currentSrc ? `src:${currentSrc}` : "src:none";
  }

  private getSourceObjectId(sourceObject: object) {
    const existingId = this.sourceObjectIds.get(sourceObject);
    if (existingId) {
      return existingId;
    }

    const nextId = this.nextSourceObjectId;
    this.nextSourceObjectId += 1;
    this.sourceObjectIds.set(sourceObject, nextId);
    return nextId;
  }

  private safeGetAttribute(element: HTMLAudioElement, name: string) {
    try {
      return element.getAttribute(name);
    } catch {
      return null;
    }
  }
}

export const roomAudioActivationManager = new RoomAudioActivationManager();

function isAutoplayBlockedError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "NotAllowedError"
    : error instanceof Error && /notallowed|autoplay|user gesture|blocked/i.test(error.message);
}
