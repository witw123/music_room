export function syncLocalPlaybackWindow(
  audio: HTMLAudioElement,
  expectedSeconds: number,
  isPlaying: boolean,
  options?: {
    softDriftMs?: number;
    hardDriftMs?: number;
    allowRateCorrection?: boolean;
    correctionMode?: "rate" | "seek-only" | "muted-warmup";
  }
) {
  if (!Number.isFinite(audio.currentTime)) {
    return;
  }

  const softDriftMs = options?.softDriftMs ?? 180;
  const hardDriftMs = options?.hardDriftMs ?? 1_200;
  const allowRateCorrection = options?.allowRateCorrection ?? true;
  const correctionMode = options?.correctionMode ?? (allowRateCorrection ? "rate" : "seek-only");
  const driftMs = (expectedSeconds - audio.currentTime) * 1000;
  const absDriftMs = Math.abs(driftMs);

  if (correctionMode === "muted-warmup") {
    if (absDriftMs >= softDriftMs) {
      audio.currentTime = Math.max(0, expectedSeconds);
    }
    audio.playbackRate = 1;
    return;
  }

  if (correctionMode === "seek-only" || !allowRateCorrection) {
    if (!isPlaying || absDriftMs >= hardDriftMs) {
      audio.currentTime = Math.max(0, expectedSeconds);
    }
    audio.playbackRate = 1;
    return;
  }

  if (absDriftMs <= softDriftMs) {
    audio.playbackRate = 1;
    return;
  }

  audio.playbackRate = driftMs > 0 ? 1.04 : 0.96;
}
