"use client";

import { useRef } from "react";
import type { ProgressiveMseEngine } from "../progressive-mse-engine";
import type { ProgressivePcmEngine } from "../progressive-pcm-engine";

export function usePlaybackRuntimeRefs() {
  const progressiveEngineRef = useRef<ProgressiveMseEngine | null>(null);
  const progressivePcmEngineRef = useRef<ProgressivePcmEngine | null>(null);
  const progressiveWarmupReadyAtRef = useRef<number | null>(null);
  const fullLocalWarmupReadyAtRef = useRef<number | null>(null);
  const pcmLastBlockedReasonRef = useRef<string | null>(null);
  const pcmRuntimeFailureRef = useRef<{ trackId: string; reason: string } | null>(null);
  const previousPlaybackSurfaceKeyRef = useRef<string | null>(null);
  const lastPcmSlidingWindowPlayAttemptAtRef = useRef<number | null>(null);
  const activeSourceActivatedAtRef = useRef<number>(Date.now());
  const localTakeoverCooldownUntilRef = useRef<number>(0);
  const lastStablePlaybackAtRef = useRef<string | null>(null);

  return {
    activeSourceActivatedAtRef,
    fullLocalWarmupReadyAtRef,
    lastPcmSlidingWindowPlayAttemptAtRef,
    lastStablePlaybackAtRef,
    localTakeoverCooldownUntilRef,
    pcmLastBlockedReasonRef,
    pcmRuntimeFailureRef,
    previousPlaybackSurfaceKeyRef,
    progressiveEngineRef,
    progressivePcmEngineRef,
    progressiveWarmupReadyAtRef
  };
}
