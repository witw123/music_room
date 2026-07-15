import type { TrackMeta } from "@music-room/shared";
import { resolvePeerLinkProfile } from "@/features/p2p";
import type { ResolvedTrackPieceManifest } from "@/features/p2p";
import type { ActiveAssetTransferWindow } from "./manual-cache-download-queue";

type ManualCacheLinkProfile = "fast" | "standard" | "constrained" | "severe";

export type ManualCachePeerRequestWindow = {
  currentRoundTripTimeMs?: number | null;
  downloadRateKbps?: number | null;
  uploadRateKbps?: number | null;
  candidateType?: string | null;
  protocol?: string | null;
  transportScore?: "healthy" | "degraded" | "unstable" | "failed" | null;
  bufferedAmountBytes?: number | null;
};

export type ManualCacheDirectRequestBudget = {
  batchSize: number;
  maxPendingPerTrack: number;
  maxPendingPerPeer: number;
  pendingTtlMs: number;
  timeoutMs: number;
};

type ManualCacheAdaptiveBudgetShape = Omit<ManualCacheDirectRequestBudget, "pendingTtlMs">;

const directRequestBatchSize = 32;
const directRequestTimeoutMs = 15_000;
const activePlaybackDirectRequestBatchSize = 32;
const activePlaybackDirectRequestTimeoutMs = 45_000;
const directPendingTtlMs = 20_000;
const activePlaybackDirectPendingTtlMs = activePlaybackDirectRequestTimeoutMs + 5_000;
const maxPendingPerTrack = 128;
const maxPendingPerPeer = 32;
const activePlaybackMaxPendingPerTrack = 256;
const activePlaybackMaxPendingPerPeer = 96;

const adaptiveActivePlaybackBudgets: Record<ManualCacheLinkProfile, ManualCacheAdaptiveBudgetShape> = {
  fast: {
    batchSize: 48,
    maxPendingPerTrack: activePlaybackMaxPendingPerTrack,
    maxPendingPerPeer: activePlaybackMaxPendingPerPeer,
    timeoutMs: activePlaybackDirectRequestTimeoutMs
  },
  standard: {
    batchSize: activePlaybackDirectRequestBatchSize,
    maxPendingPerTrack: 192,
    maxPendingPerPeer: 64,
    timeoutMs: 35_000
  },
  constrained: {
    batchSize: 16,
    maxPendingPerTrack: 128,
    maxPendingPerPeer: 32,
    timeoutMs: 40_000
  },
  severe: {
    batchSize: 8,
    maxPendingPerTrack: 64,
    maxPendingPerPeer: 16,
    timeoutMs: activePlaybackDirectRequestTimeoutMs
  }
};

const adaptiveBackgroundBudgets: Record<ManualCacheLinkProfile, ManualCacheAdaptiveBudgetShape> = {
  fast: {
    batchSize: 64,
    maxPendingPerTrack: 192,
    maxPendingPerPeer: 64,
    timeoutMs: 30_000
  },
  standard: {
    batchSize: directRequestBatchSize,
    maxPendingPerTrack: 96,
    maxPendingPerPeer: 32,
    timeoutMs: directRequestTimeoutMs
  },
  constrained: {
    batchSize: 12,
    maxPendingPerTrack: 64,
    maxPendingPerPeer: 16,
    timeoutMs: 25_000
  },
  severe: {
    batchSize: 4,
    maxPendingPerTrack: 32,
    maxPendingPerPeer: 4,
    timeoutMs: 25_000
  }
};

function resolveManualCacheLinkProfile(
  window: ManualCachePeerRequestWindow
): ManualCacheLinkProfile {
  const profile = resolvePeerLinkProfile(window);
  if (profile === "fast-direct") {
    return "fast";
  }
  if (profile === "severe") {
    return "severe";
  }
  if (profile === "constrained" || profile === "relay-udp") {
    return "constrained";
  }
  return "standard";
}

function withPendingTtl(budget: ManualCacheAdaptiveBudgetShape): ManualCacheDirectRequestBudget {
  return {
    ...budget,
    pendingTtlMs: budget.timeoutMs + 5_000
  };
}

export function resolveManualCacheDirectRequestBudget(input: {
  trackId: string;
  track?: TrackMeta | null;
  manifest?: ResolvedTrackPieceManifest | null;
  activePlaybackWindow?: ActiveAssetTransferWindow | null;
  peerWindow?: ManualCachePeerRequestWindow | null;
  resolveActivePlaybackDecodablePrefixChunkCount: (input: {
    track: TrackMeta | null;
    manifest: ResolvedTrackPieceManifest | null;
    activePlaybackWindow: ActiveAssetTransferWindow | null | undefined;
  }) => number;
}): ManualCacheDirectRequestBudget {
  if (input.activePlaybackWindow?.trackId === input.trackId) {
    const activePrefixChunkCount = input.resolveActivePlaybackDecodablePrefixChunkCount({
      track: input.track ?? null,
      manifest: input.manifest ?? null,
      activePlaybackWindow: input.activePlaybackWindow
    });
    if (input.peerWindow) {
      const profile = resolveManualCacheLinkProfile(input.peerWindow);
      const profileBudget = adaptiveActivePlaybackBudgets[profile];
      const activePendingWindow = Math.max(
        profileBudget.maxPendingPerTrack,
        activePrefixChunkCount + profileBudget.maxPendingPerPeer
      );

      return withPendingTtl({
        ...profileBudget,
        maxPendingPerTrack: activePendingWindow
      });
    }

    const activePendingWindow = Math.max(
      activePlaybackMaxPendingPerTrack,
      activePrefixChunkCount + activePlaybackMaxPendingPerPeer
    );

    return {
      batchSize: activePlaybackDirectRequestBatchSize,
      maxPendingPerTrack: activePendingWindow,
      maxPendingPerPeer: activePlaybackMaxPendingPerPeer,
      pendingTtlMs: activePlaybackDirectPendingTtlMs,
      timeoutMs: activePlaybackDirectRequestTimeoutMs
    };
  }

  if (input.peerWindow) {
    const profile = resolveManualCacheLinkProfile(input.peerWindow);
    const profileBudget = adaptiveBackgroundBudgets[profile];
    const hasActivePlaybackWindow = Boolean(input.activePlaybackWindow?.trackId);
    const playbackAwareBudget = hasActivePlaybackWindow
      ? {
          ...profileBudget,
          batchSize: Math.min(profileBudget.batchSize, 8),
          maxPendingPerTrack: Math.min(profileBudget.maxPendingPerTrack, 32),
          maxPendingPerPeer: Math.min(profileBudget.maxPendingPerPeer, 8)
        }
      : profileBudget;

    return withPendingTtl(playbackAwareBudget);
  }

  return {
    batchSize: directRequestBatchSize,
    maxPendingPerTrack,
    maxPendingPerPeer,
    pendingTtlMs: directPendingTtlMs,
    timeoutMs: directRequestTimeoutMs
  };
}
