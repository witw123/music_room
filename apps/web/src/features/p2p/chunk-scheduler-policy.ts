import type { AssetTransferPolicy, AssetTransferManifest } from "@/features/playback/asset-transfer-scheduler";

/**
 * Derives the effective asset transfer policy for the current room track.
 */
export function resolveCurrentTrackWantedPolicy(input: {
  policy: AssetTransferPolicy;
  shouldEnterOutrunRecovery: boolean;
  manifest: AssetTransferManifest | null;
  isTrackComplete: boolean;
  playbackStatus: string | null | undefined;
  aheadBufferedMs: number;
  comfortableBufferMs: number;
}): AssetTransferPolicy {
  if (input.shouldEnterOutrunRecovery) {
    return "outrun-recovery";
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
