"use client";

export type SilentPrewarmHandle = {
  stream: MediaStream;
  track: MediaStreamTrack | null;
  close: () => void;
};

export function createSilentPrewarmHandle(): SilentPrewarmHandle | null {
  if (typeof window === "undefined") {
    return null;
  }

  const AudioContextCtor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    return null;
  }

  const context = new AudioContextCtor();
  const destination = context.createMediaStreamDestination();
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.value = 440;
  gain.gain.value = 0.00001;
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start();

  const track = destination.stream.getAudioTracks()[0] ?? null;

  return {
    stream: destination.stream,
    track,
    close: () => {
      try {
        oscillator.stop();
      } catch {
        // Ignore repeated close calls.
      }
      try {
        oscillator.disconnect();
      } catch {
        // Ignore.
      }
      try {
        gain.disconnect();
      } catch {
        // Ignore.
      }
      for (const streamTrack of destination.stream.getTracks()) {
        streamTrack.stop();
      }
      void context.close().catch(() => undefined);
    }
  };
}
