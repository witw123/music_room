"use client";

const SILENT_WAV_DATA_URI =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=";

export function primePlaybackActivation() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  try {
    const audio = document.createElement("audio");
    audio.preload = "auto";
    audio.muted = true;
    audio.volume = 0;
    audio.src = SILENT_WAV_DATA_URI;

    const playPromise = audio.play();
    void playPromise
      .catch(() => undefined)
      .finally(() => {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      });
  } catch {
    // Best-effort media priming only.
  }

  try {
    const AudioContextCtor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextCtor) {
      return;
    }

    const context = new AudioContextCtor();
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(context.destination);

    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, 22_050);
    source.connect(gain);

    void context
      .resume()
      .then(() => {
        source.start(0);
        source.stop(context.currentTime + 0.01);
      })
      .catch(() => undefined)
      .finally(() => {
        void context.close().catch(() => undefined);
      });
  } catch {
    // Best-effort audio context priming only.
  }
}
