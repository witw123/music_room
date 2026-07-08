"use client";

import type { RoomSnapshot, TrackAvailabilityAnnouncement, TrackMeta } from "@music-room/shared";
import type { TrackPieceManifestRecord } from "@/lib/indexeddb";
import { resolveTrackPieceManifest, type ResolvedTrackPieceManifest } from "@/features/p2p";
import {
  getStartupWindowMs,
  isFlacTrack
} from "@/features/playback/progressive-playback";
import { getRequiredDecodablePrefixChunkCount } from "@/features/playback/sliding-window/playback-window-scheduler";
import {
  resolveManualCacheActivePriorityChunks,
  resolveManualCacheTrackPlan,
  resolveManualCacheTrackProviderPeerId,
  type ActivePlaybackCacheWindow,
  type ManualCacheTrackPlan
} from "./manual-cache-download-queue";

const directRequestBatchSize = 32;
const directRequestTimeoutMs = 15_000;
const activePlaybackDirectRequestBatchSize = 128;
const activePlaybackDirectRequestTimeoutMs = 45_000;
const directPendingTtlMs = 20_000;
const activePlaybackDirectPendingTtlMs = activePlaybackDirectRequestTimeoutMs + 5_000;
const maxPendingPerTrack = 128;
const maxPendingPerPeer = 32;
// Large in-flight windows to saturate the P2P data channel bandwidth.
// 512 chunks @ 128 KB = 64 MB in-flight per peer is enough for even
// lossless FLAC streams (1-3 Mbps) to stream while downloading at
// multi-megabyte-per-second rates.
const activePlaybackMaxPendingPerTrack = 1024;
const activePlaybackMaxPendingPerPeer = 512;

export type ManualCacheRequestPriority = "active" | "background";

export type ManualCachePeerRequestWindow = {
  currentRoundTripTimeMs?: number | null;
  downloadRateKbps?: number | null;
  uploadRateKbps?: number | null;
  candidateType?: string | null;
  protocol?: string | null;
  transportScore?: "healthy" | "degraded" | "unstable" | "failed" | null;
  bufferedAmountBytes?: number | null;
};

export type ManualCacheDirectRequestResult = {
  plan: ManualCacheTrackPlan;
  didRequest: boolean | null;
};

type ManualCacheLinkProfile = "fast" | "standard" | "constrained" | "severe";

type ManualCacheDirectRequestBudget = {
  batchSize: number;
  maxPendingPerTrack: number;
  maxPendingPerPeer: number;
  pendingTtlMs: number;
  timeoutMs: number;
};

type ManualCacheAdaptiveBudgetShape = Omit<ManualCacheDirectRequestBudget, "pendingTtlMs">;

const adaptiveActivePlaybackBudgets: Record<ManualCacheLinkProfile, ManualCacheAdaptiveBudgetShape> = {
  fast: {
    batchSize: activePlaybackDirectRequestBatchSize,
    maxPendingPerTrack: activePlaybackMaxPendingPerTrack,
    maxPendingPerPeer: activePlaybackMaxPendingPerPeer,
    timeoutMs: activePlaybackDirectRequestTimeoutMs
  },
  standard: {
    batchSize: 48,
    maxPendingPerTrack: 384,
    maxPendingPerPeer: 96,
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
    timeoutMs: directRequestTimeoutMs
  },
  standard: {
    batchSize: 24,
    maxPendingPerTrack: 96,
    maxPendingPerPeer: 24,
    timeoutMs: 18_000
  },
  constrained: {
    batchSize: 8,
    maxPendingPerTrack: 32,
    maxPendingPerPeer: 8,
    timeoutMs: 20_000
  },
  severe: {
    batchSize: 4,
    maxPendingPerTrack: 16,
    maxPendingPerPeer: 4,
    timeoutMs: 25_000
  }
};

function finitePositiveNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function resolveManualCacheLinkProfile(
  window: ManualCachePeerRequestWindow
): ManualCacheLinkProfile {
  const bufferedAmountBytes = finitePositiveNumber(window.bufferedAmountBytes) ?? 0;
  const roundTripTimeMs = finitePositiveNumber(window.currentRoundTripTimeMs);
  const downloadRateKbps = finitePositiveNumber(window.downloadRateKbps);
  const constrainedTransport =
    window.protocol === "tcp" || window.candidateType === "relay";

  if (
    window.transportScore === "failed" ||
    window.transportScore === "unstable" ||
    bufferedAmountBytes >= 1024 * 1024 ||
    (roundTripTimeMs !== null && roundTripTimeMs >= 400) ||
    (downloadRateKbps !== null && downloadRateKbps < 800)
  ) {
    return "severe";
  }

  if (
    window.transportScore === "degraded" ||
    constrainedTransport ||
    bufferedAmountBytes >= 512 * 1024 ||
    (roundTripTimeMs !== null && roundTripTimeMs >= 250) ||
    (downloadRateKbps !== null && downloadRateKbps < 1_500)
  ) {
    return "constrained";
  }

  if (
    window.transportScore === "healthy" &&
    bufferedAmountBytes < 128 * 1024 &&
    (roundTripTimeMs === null || roundTripTimeMs <= 120) &&
    downloadRateKbps !== null &&
    downloadRateKbps >= 4_000
  ) {
    return "fast";
  }

  return "standard";
}

function withPendingTtl(budget: ManualCacheAdaptiveBudgetShape): ManualCacheDirectRequestBudget {
  return {
    ...budget,
    pendingTtlMs: budget.timeoutMs + 5_000
  };
}

function resolveManualCacheDirectRequestBudget(input: {
  trackId: string;
  track?: TrackMeta | null;
  manifest?: ResolvedTrackPieceManifest | null;
  activePlaybackWindow?: ActivePlaybackCacheWindow | null;
  peerWindow?: ManualCachePeerRequestWindow | null;
}): ManualCacheDirectRequestBudget {
  if (input.activePlaybackWindow?.trackId === input.trackId) {
    const activePrefixChunkCount = resolveActivePlaybackDecodablePrefixChunkCount({
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

function resolveManualCacheTrackRequestOrder(input: {
  trackIds: string[];
  activeTrackId: string | null;
}) {
  const seen = new Set<string>();
  const orderedTrackIds: string[] = [];
  if (input.activeTrackId && input.trackIds.includes(input.activeTrackId)) {
    orderedTrackIds.push(input.activeTrackId);
    seen.add(input.activeTrackId);
  }

  for (const trackId of input.trackIds) {
    if (!trackId || seen.has(trackId)) {
      continue;
    }
    orderedTrackIds.push(trackId);
    seen.add(trackId);
  }

  return orderedTrackIds;
}

function resolveActivePlaybackDecodablePrefixChunkCount(input: {
  track: TrackMeta | null;
  manifest: ResolvedTrackPieceManifest | null;
  activePlaybackWindow: ActivePlaybackCacheWindow | null;
}) {
  if (!input.track || !input.manifest || !input.activePlaybackWindow) {
    return 0;
  }

  if (isFlacTrack({
    mimeType: input.manifest.pieceMimeType ?? input.track.mimeType ?? null,
    codec: input.track.codec ?? null
  })) {
    return 0;
  }

  return getRequiredDecodablePrefixChunkCount({
    manifest: {
      durationMs: input.track.durationMs,
      totalChunks: input.manifest.totalChunks
    },
    playbackPositionMs: input.activePlaybackWindow.positionMs,
    lookAheadMs: getStartupWindowMs({
      mimeType: input.manifest.pieceMimeType ?? input.track.mimeType ?? null,
      codec: input.track.codec ?? null
    })
  });
}

function releaseStaleActivePlaybackPendingChunks(input: {
  track: TrackMeta;
  manifest: ResolvedTrackPieceManifest;
  localPieceIndexes: number[];
  pendingForTrack: Map<number, number>;
  activePlaybackWindow: ActivePlaybackCacheWindow | null | undefined;
  maxPendingChunks: number;
  targetFreeSlots: number;
}) {
  if (
    input.activePlaybackWindow?.trackId !== input.track.id ||
    input.pendingForTrack.size < input.maxPendingChunks ||
    input.targetFreeSlots <= 0
  ) {
    return false;
  }

  const localPieceSet = new Set(input.localPieceIndexes);
  const activePriorityChunks = resolveManualCacheActivePriorityChunks({
    manifest: input.manifest,
    track: input.track,
    localPieceIndexes: input.localPieceIndexes,
    activePlaybackWindow: input.activePlaybackWindow
  });
  const missingPriorityChunks = activePriorityChunks.filter(
    (chunkIndex) => !localPieceSet.has(chunkIndex) && !input.pendingForTrack.has(chunkIndex)
  );
  if (missingPriorityChunks.length === 0) {
    return false;
  }

  const priorityChunkSet = new Set(activePriorityChunks);
  const requiredFreeSlots = Math.min(input.targetFreeSlots, missingPriorityChunks.length);
  const targetPendingSize = Math.max(0, input.maxPendingChunks - requiredFreeSlots);
  for (const chunkIndex of [...input.pendingForTrack.keys()]) {
    if (priorityChunkSet.has(chunkIndex)) {
      continue;
    }

    input.pendingForTrack.delete(chunkIndex);
    if (input.pendingForTrack.size <= targetPendingSize) {
      break;
    }
  }
  return input.pendingForTrack.size <= targetPendingSize;
}

export async function planManualCacheDirectRequests(input: {
  roomSnapshot: RoomSnapshot | null;
  manualCacheTrackIds: string[];
  peerId: string;
  providerPeerIds: string[];
  connectedPeerIds: string[];
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  pendingByTrack: Map<string, Map<number, number>>;
  activePlaybackWindow?: ActivePlaybackCacheWindow | null;
  now?: number;
  getCachedManifest: (track: TrackMeta) => Promise<TrackPieceManifestRecord | null>;
  getLocalPieceIndexes: (
    track: TrackMeta,
    cachedManifest: TrackPieceManifestRecord | null,
    manifestHint: ResolvedTrackPieceManifest | null
  ) => Promise<number[]>;
  requestPieces: (
    providerPeerId: string,
    trackId: string,
    chunkIndexes: number[],
    totalChunks: number,
    timeoutMs: number
  ) => boolean;
  resolvePeerRequestWindow?: (
    providerPeerId: string,
    trackId: string,
    priority: ManualCacheRequestPriority
  ) => ManualCachePeerRequestWindow | null | undefined;
}) {
  const results: ManualCacheDirectRequestResult[] = [];
  const roomId = input.roomSnapshot?.room.id ?? null;
  if (!roomId || !input.peerId || input.manualCacheTrackIds.length === 0) {
    return results;
  }

  const now = input.now ?? Date.now();
  const requestedChunkCountByPeer = new Map<string, number>();
  const orderedTrackIds = resolveManualCacheTrackRequestOrder({
    trackIds: input.manualCacheTrackIds,
    activeTrackId: input.activePlaybackWindow?.trackId ?? null
  });
  for (const trackId of orderedTrackIds) {
    const track = input.roomSnapshot?.tracks.find((entry) => entry.id === trackId) ?? null;
    if (!track) {
      results.push({
        plan: {
          trackId,
          manifest: null,
          manifestSource: "none",
          integrityMode: null,
          localPieceIndexes: [],
          providerCandidates: [],
          providerPeerIds: [],
          connectedProviderPeerIds: [],
          selectedProviderPeerId: null,
          requestableChunks: [],
          pendingChunkCount: 0,
          blockedReason: "missing-track"
        },
        didRequest: null
      });
      continue;
    }

    const cachedManifest = await input.getCachedManifest(track);
    const manifestHint = resolveTrackPieceManifest({
      track,
      cacheManifest: cachedManifest
    });
    const localPieceIndexes = await input.getLocalPieceIndexes(
      track,
      cachedManifest,
      manifestHint
    );
    const pendingForTrack = input.pendingByTrack.get(trackId) ?? new Map<number, number>();
    for (const [chunkIndex, expiresAt] of pendingForTrack.entries()) {
      if (expiresAt <= now || localPieceIndexes.includes(chunkIndex)) {
        pendingForTrack.delete(chunkIndex);
      }
    }
    input.pendingByTrack.set(trackId, pendingForTrack);

    const requestPriority: ManualCacheRequestPriority =
      input.activePlaybackWindow?.trackId === trackId ? "active" : "background";
    const expectedProviderPeerId = resolveManualCacheTrackProviderPeerId({
      trackId,
      roomSnapshot: input.roomSnapshot,
      availabilityByTrack: input.availabilityByTrack,
      connectedPeerIds: input.connectedPeerIds,
      localPeerId: input.peerId
    });
    const expectedPeerWindow = expectedProviderPeerId
      ? input.resolvePeerRequestWindow?.(expectedProviderPeerId, trackId, requestPriority) ?? null
      : null;
    const requestBudget = resolveManualCacheDirectRequestBudget({
      trackId,
      track,
      manifest: manifestHint,
      activePlaybackWindow: input.activePlaybackWindow ?? null,
      peerWindow: expectedPeerWindow
    });
    const releasedActivePrioritySlots = manifestHint
      ? releaseStaleActivePlaybackPendingChunks({
        track,
        manifest: manifestHint,
        localPieceIndexes,
        pendingForTrack,
        activePlaybackWindow: input.activePlaybackWindow ?? null,
        maxPendingChunks: requestBudget.maxPendingPerTrack,
        targetFreeSlots: requestBudget.batchSize
      })
      : false;
    const pendingRefillLowWatermark =
      requestBudget.maxPendingPerTrack - requestBudget.maxPendingPerPeer;
    const remainingTrackSlots = Math.max(0, requestBudget.maxPendingPerTrack - pendingForTrack.size);
    const shouldRefillPendingWindow =
      releasedActivePrioritySlots ||
      pendingForTrack.size === 0 ||
      pendingForTrack.size <= pendingRefillLowWatermark;
    const plan = resolveManualCacheTrackPlan({
      track,
      roomId,
      localPeerId: input.peerId,
      availabilityByTrack: input.availabilityByTrack,
      connectedPeerIds: input.connectedPeerIds,
      cachedManifest,
      localPieceIndexes,
      pendingChunkIndexes: [...pendingForTrack.keys()],
      activePlaybackWindow: input.activePlaybackWindow ?? null,
      maxPendingChunks: requestBudget.maxPendingPerTrack,
      maxRequestChunks: shouldRefillPendingWindow
        ? Math.min(
            requestBudget.batchSize,
            remainingTrackSlots,
            requestBudget.maxPendingPerPeer
          )
        : 0
    });

    if (!plan.selectedProviderPeerId || plan.requestableChunks.length === 0 || !plan.manifest) {
      results.push({ plan, didRequest: null });
      continue;
    }

    const selectedProviderPeerId = plan.selectedProviderPeerId;
    const selectedManifest = plan.manifest;
    const selectedPeerWindow =
      selectedProviderPeerId === expectedProviderPeerId
        ? expectedPeerWindow
        : input.resolvePeerRequestWindow?.(
            selectedProviderPeerId,
            trackId,
            requestPriority
          ) ?? null;
    const selectedRequestBudget =
      selectedProviderPeerId === expectedProviderPeerId
        ? requestBudget
        : resolveManualCacheDirectRequestBudget({
            trackId,
            track,
            manifest: manifestHint,
            activePlaybackWindow: input.activePlaybackWindow ?? null,
            peerWindow: selectedPeerWindow
          });
    const remainingPeerSlots = Math.max(
      0,
      selectedRequestBudget.maxPendingPerPeer -
        (requestedChunkCountByPeer.get(selectedProviderPeerId) ?? 0)
    );
    const requestableChunks = plan.requestableChunks.slice(
      0,
      Math.min(plan.requestableChunks.length, selectedRequestBudget.batchSize, remainingPeerSlots)
    );
    if (requestableChunks.length === 0) {
      results.push({
        plan: {
          ...plan,
          requestableChunks,
          blockedReason: null
        },
        didRequest: null
      });
      continue;
    }

    const requestPlan =
      requestableChunks.length === plan.requestableChunks.length
        ? plan
        : {
            ...plan,
            requestableChunks
          };
    const didRequest = input.requestPieces(
      selectedProviderPeerId,
      trackId,
      requestPlan.requestableChunks,
      selectedManifest.totalChunks,
      selectedRequestBudget.timeoutMs
    );
    if (didRequest) {
      requestedChunkCountByPeer.set(
        selectedProviderPeerId,
        (requestedChunkCountByPeer.get(selectedProviderPeerId) ?? 0) +
          requestPlan.requestableChunks.length
      );
      const expiresAt = now + selectedRequestBudget.pendingTtlMs;
      for (const chunkIndex of requestPlan.requestableChunks) {
        pendingForTrack.set(chunkIndex, expiresAt);
      }
    }

    results.push({ plan: requestPlan, didRequest });
  }

  return results;
}
