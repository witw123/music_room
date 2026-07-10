import type { ProgressiveSchedulerPolicy } from "@/features/playback/progressive-playback";
import { getProgressiveEngineType, type ProgressiveTrackManifest } from "@/features/playback/progressive-playback";

/**
 * Derives the effective scheduler policy for requesting chunks of the current
 * playback track based on engine capability, buffer state, and track completion.
 *
 * This is the chunk-scheduler-side counterpart to resolveSchedulerPolicy() —
 * it translates the playback-layer policy into a concrete chunk request policy
 * that respects PCM/MSE engine differences.
 */
export function resolveCurrentTrackWantedPolicy(input: {
  policy: ProgressiveSchedulerPolicy;
  shouldEnterOutrunRecovery: boolean;
  manifest: ProgressiveTrackManifest | null;
  isTrackComplete: boolean;
  playbackStatus: string | null | undefined;
  aheadBufferedMs: number;
  comfortableBufferMs: number;
}): ProgressiveSchedulerPolicy {
  if (input.shouldEnterOutrunRecovery) {
    return "outrun-recovery";
  }

  // Engine type "none" means no progressive engine can decode this format
  // (e.g. unsupported codec in this browser). Fall back to pause-fill to
  // download the whole file.
  if (input.manifest && getProgressiveEngineType(input.manifest) === "none") {
    return input.policy === "startup" ? "startup" : "pause-fill";
  }

  // While playing and comfortably buffered, switch to pause-fill to pull
  // ahead of the playback window.
  if (
    input.playbackStatus === "playing" &&
    !input.isTrackComplete &&
    input.aheadBufferedMs >= input.comfortableBufferMs &&
    (input.policy === "steady" || input.policy === "background")
  ) {
    return "pause-fill";
  }

  // Background policy without comfortable buffer falls back to steady.
  if (input.policy === "background") {
    return "steady";
  }

  return input.policy;
}
