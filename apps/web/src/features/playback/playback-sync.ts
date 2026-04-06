const minimumAudibleRate = 0.985;
const maximumAudibleRate = 1.015;
const minimumLocalAudibleRate = 0.982;
const maximumLocalAudibleRate = 1.018;

export function resolveContinuousPlaybackRate(input: {
  driftMs: number;
  maxRateDelta: number;
}) {
  const absoluteDriftMs = Math.abs(input.driftMs);
  let normalizedDelta = 0;

  if (absoluteDriftMs >= 320) {
    normalizedDelta = absoluteDriftMs / 4000;
  } else if (absoluteDriftMs >= 120) {
    normalizedDelta = absoluteDriftMs / 10_000;
  } else if (absoluteDriftMs >= 35) {
    normalizedDelta = absoluteDriftMs / 16_000;
  }

  normalizedDelta = Math.min(input.maxRateDelta, normalizedDelta);
  const direction = input.driftMs >= 0 ? 1 : -1;
  return 1 + direction * normalizedDelta;
}

export function syncLocalPlaybackWindow(
  audio: HTMLAudioElement,
  expectedSeconds: number,
  isPlaying: boolean,
  options?: {
    softDriftMs?: number;
    hardDriftMs?: number;
    allowRateCorrection?: boolean;
    correctionMode?:
      | "rate"
      | "seek-only"
      | "muted-warmup"
      | "audible-remote-follow"
      | "shadow-local-catchup"
      | "audible-local-follow";
  }
) {
  if (!Number.isFinite(audio.currentTime)) {
    return {
      driftMs: Number.NaN,
      playbackRate: audio.playbackRate,
      didSeek: false
    };
  }

  const softDriftMs = options?.softDriftMs ?? 180;
  const hardDriftMs = options?.hardDriftMs ?? 1_200;
  const allowRateCorrection = options?.allowRateCorrection ?? true;
  const correctionMode = options?.correctionMode ?? (allowRateCorrection ? "rate" : "seek-only");
  const driftMs = (expectedSeconds - audio.currentTime) * 1000;
  const absDriftMs = Math.abs(driftMs);
  let didSeek = false;

  if (correctionMode === "muted-warmup" || correctionMode === "shadow-local-catchup") {
    if (absDriftMs >= softDriftMs) {
      audio.currentTime = Math.max(0, expectedSeconds);
      didSeek = true;
    }
    audio.playbackRate = 1;
    return {
      driftMs,
      playbackRate: audio.playbackRate,
      didSeek
    };
  }

  if (correctionMode === "seek-only" || !allowRateCorrection) {
    if (!isPlaying || absDriftMs >= hardDriftMs) {
      audio.currentTime = Math.max(0, expectedSeconds);
      didSeek = true;
    }
    audio.playbackRate = 1;
    return {
      driftMs,
      playbackRate: audio.playbackRate,
      didSeek
    };
  }

  if (absDriftMs >= hardDriftMs) {
    audio.currentTime = Math.max(0, expectedSeconds);
    audio.playbackRate = 1;
    return {
      driftMs,
      playbackRate: audio.playbackRate,
      didSeek: true
    };
  }

  if (absDriftMs <= softDriftMs) {
    audio.playbackRate = 1;
    return {
      driftMs,
      playbackRate: audio.playbackRate,
      didSeek
    };
  }

  const maxRateDelta =
    correctionMode === "audible-remote-follow"
      ? 0.012
      : correctionMode === "audible-local-follow"
        ? 0.015
        : 0.04;
  const boundedPlaybackRate = resolveContinuousPlaybackRate({
    driftMs,
    maxRateDelta
  });
  const minimumRate =
    correctionMode === "audible-remote-follow" ? minimumAudibleRate : minimumLocalAudibleRate;
  const maximumRate =
    correctionMode === "audible-remote-follow" ? maximumAudibleRate : maximumLocalAudibleRate;
  audio.playbackRate = Math.max(minimumRate, Math.min(maximumRate, boundedPlaybackRate));
  return {
    driftMs,
    playbackRate: audio.playbackRate,
    didSeek
  };
}
