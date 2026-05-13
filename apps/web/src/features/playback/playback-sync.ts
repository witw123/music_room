const minimumAudibleRate = 0.994;
const maximumAudibleRate = 1.006;
const minimumLocalAudibleRate = 0.992;
const maximumLocalAudibleRate = 1.008;
const minimumGeneralRate = 0.982;
const maximumGeneralRate = 1.018;

type PitchPreservingAudioElement = HTMLAudioElement & {
  preservesPitch?: boolean;
  mozPreservesPitch?: boolean;
  webkitPreservesPitch?: boolean;
};

function enablePitchPreservation(audio: HTMLAudioElement) {
  const pitchPreservingAudio = audio as PitchPreservingAudioElement;
  pitchPreservingAudio.preservesPitch = true;
  pitchPreservingAudio.mozPreservesPitch = true;
  pitchPreservingAudio.webkitPreservesPitch = true;
}

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
      | "shadow-local-catchup"
      | "audible-local-follow";
  }
) {
  enablePitchPreservation(audio);

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
  const disableAudibleRateCorrection = correctionMode === "audible-local-follow";
  const audibleLocalSoftDriftMs = 40;
  const audibleLocalHardDriftMs = 450;
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

  if (correctionMode === "seek-only" || !allowRateCorrection || disableAudibleRateCorrection) {
    if (correctionMode === "audible-local-follow") {
      if (!isPlaying || absDriftMs >= audibleLocalHardDriftMs) {
        audio.currentTime = Math.max(0, expectedSeconds);
        didSeek = true;
        audio.playbackRate = 1;
        return {
          driftMs,
          playbackRate: audio.playbackRate,
          didSeek
        };
      }

      if (absDriftMs <= audibleLocalSoftDriftMs) {
        audio.playbackRate = 1;
        return {
          driftMs,
          playbackRate: audio.playbackRate,
          didSeek
        };
      }

      audio.playbackRate = 1;
      return {
        driftMs,
        playbackRate: audio.playbackRate,
        didSeek
      };
    }

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

  const maxRateDelta = 0.04;
  const boundedPlaybackRate = resolveContinuousPlaybackRate({
    driftMs,
    maxRateDelta
  });
  const minimumRate = minimumGeneralRate;
  const maximumRate = maximumGeneralRate;
  audio.playbackRate = Math.max(minimumRate, Math.min(maximumRate, boundedPlaybackRate));
  return {
    driftMs,
    playbackRate: audio.playbackRate,
    didSeek
  };
}
