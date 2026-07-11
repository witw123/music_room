"use client";

import type { RoomSnapshot, TrackAvailabilityAnnouncement, TrackMeta } from "@music-room/shared";
import type { TrackPieceManifestRecord } from "@/lib/indexeddb";
import {
  resolvePeerLinkProfile,
  isPeerTransportAllowed,
  resolvePeerTransferWindow,
  resolveTrackPieceManifest,
  type ResolvedTrackPieceManifest
} from "@/features/p2p";
import type { PieceRequestOptions } from "@/features/p2p/piece-request-client";
import {
  getStartupWindowMs,
} from "@/features/playback/progressive-playback";
import { getRequiredDecodablePrefixChunkCount } from "@/features/playback/sliding-window/playback-window-scheduler";
import {
  resolveManualCacheActivePriorityChunks,
  resolveManualCacheTrackPlan,
  resolveManualCacheTrackProviderPeerId,
  type ActivePlaybackCacheWindow,
  type ManualCachePeerSummary,
  type ManualCacheRequestGroup,
  type ManualCacheRequestGroupPriority,
  type ManualCacheTrackPlan
} from "./manual-cache-download-queue";

const directRequestBatchSize = 32;
const directRequestTimeoutMs = 15_000;
const activePlaybackDirectRequestBatchSize = 32;
const activePlaybackDirectRequestTimeoutMs = 45_000;
const directPendingTtlMs = 20_000;
const activePlaybackDirectPendingTtlMs = activePlaybackDirectRequestTimeoutMs + 5_000;
const maxPendingPerTrack = 128;
const maxPendingPerPeer = 32;
const maxRedundantActivePlaybackChunks = 2;
// Keep enough active in-flight work to reach multi-MB/s links without letting
// cache writes starve the PCM reader/decoder during cache completion.
const activePlaybackMaxPendingPerTrack = 256;
const activePlaybackMaxPendingPerPeer = 96;

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

function adaptManualCacheBudgetToLink(input: {
  budget: ManualCacheAdaptiveBudgetShape;
  window: ManualCachePeerRequestWindow;
  chunkSize: number;
}) {
  const transferWindow = resolvePeerTransferWindow(input.window, input.chunkSize);
  const maxPendingPerPeer = Math.max(
    input.budget.maxPendingPerPeer,
    transferWindow.maxPendingChunks
  );
  return withPendingTtl({
    batchSize: Math.min(
      maxPendingPerPeer,
      Math.max(input.budget.batchSize, Math.ceil(maxPendingPerPeer / 2))
    ),
    maxPendingPerTrack: Math.max(input.budget.maxPendingPerTrack, maxPendingPerPeer * 2),
    maxPendingPerPeer,
    timeoutMs: transferWindow.requestTimeoutMs
  });
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

      return adaptManualCacheBudgetToLink({
        window: input.peerWindow,
        chunkSize: input.manifest?.chunkSize ?? 256 * 1024,
        budget: {
          ...profileBudget,
          maxPendingPerTrack: activePendingWindow
        }
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

    return adaptManualCacheBudgetToLink({
      budget: playbackAwareBudget,
      window: input.peerWindow,
      chunkSize: input.manifest?.chunkSize ?? 256 * 1024
    });
  }

  return {
    batchSize: directRequestBatchSize,
    maxPendingPerTrack,
    maxPendingPerPeer,
    pendingTtlMs: directPendingTtlMs,
    timeoutMs: directRequestTimeoutMs
  };
}

function resolveRequestGroupPriority(
  requestPriority: ManualCacheRequestPriority
): ManualCacheRequestGroupPriority {
  return requestPriority === "active" ? "active-critical" : "background";
}

function scoreManualCacheProvider(input: {
  providerPeerId: string;
  window: ManualCachePeerRequestWindow | null;
  availableChunkCount: number;
}) {
  const window = input.window;
  const profile = window ? resolveManualCacheLinkProfile(window) : "standard";
  const profileBonus =
    profile === "fast" ? 4_000 : profile === "standard" ? 2_000 : profile === "constrained" ? 500 : 0;
  const downloadBonus = Math.min(2_000, finitePositiveNumber(window?.downloadRateKbps) ?? 0);
  const rttPenalty = Math.min(1_000, finitePositiveNumber(window?.currentRoundTripTimeMs) ?? 150);
  const bufferedPenalty = Math.round((finitePositiveNumber(window?.bufferedAmountBytes) ?? 0) / 1024);
  return profileBonus + downloadBonus + input.availableChunkCount / 10 - rttPenalty - bufferedPenalty;
}

function isProviderEligibleForRequest(input: {
  requestPriority: ManualCacheRequestPriority;
  window: ManualCachePeerRequestWindow | null;
}) {
  if (!input.window) {
    return true;
  }

  if (!isPeerTransportAllowed(input.window)) {
    return false;
  }

  if (input.requestPriority !== "active") {
    return true;
  }

  return resolveManualCacheLinkProfile(input.window) !== "severe";
}

function resolveCurrentPlaybackChunkIndex(input: {
  track: TrackMeta;
  manifest: ResolvedTrackPieceManifest;
  activePlaybackWindow: ActivePlaybackCacheWindow;
}) {
  if (
    !Number.isFinite(input.track.durationMs) ||
    input.track.durationMs <= 0 ||
    input.manifest.totalChunks <= 0
  ) {
    return 0;
  }

  const progressRatio = Math.max(
    0,
    Math.min(1, input.activePlaybackWindow.positionMs / input.track.durationMs)
  );
  return Math.max(
    0,
    Math.min(input.manifest.totalChunks - 1, Math.floor(progressRatio * input.manifest.totalChunks))
  );
}

function resolveRedundantActivePlaybackChunks(input: {
  plan: ManualCacheTrackPlan;
  track: TrackMeta;
  manifest: ResolvedTrackPieceManifest;
  activePlaybackWindow: ActivePlaybackCacheWindow | null;
}) {
  if (
    input.activePlaybackWindow?.trackId !== input.track.id ||
    input.activePlaybackWindow.status !== "playing"
  ) {
    return [];
  }

  const currentChunkIndex = resolveCurrentPlaybackChunkIndex({
    track: input.track,
    manifest: input.manifest,
    activePlaybackWindow: input.activePlaybackWindow
  });
  const nearDeadlineChunks = new Set([
    currentChunkIndex,
    currentChunkIndex + 1,
    currentChunkIndex + 2
  ]);
  const currentWindowChunks = input.plan.requestableChunks
    .filter((chunkIndex) => nearDeadlineChunks.has(chunkIndex))
    .slice(0, maxRedundantActivePlaybackChunks);

  return (
    currentWindowChunks.length > 0
      ? currentWindowChunks
      : input.plan.requestableChunks.slice(0, maxRedundantActivePlaybackChunks)
  );
}

function resolveActiveCacheAheadMs(input: {
  track: TrackMeta;
  manifest: ResolvedTrackPieceManifest;
  localPieceIndexes: readonly number[];
  activePlaybackWindow: ActivePlaybackCacheWindow | null;
}) {
  if (
    input.activePlaybackWindow?.trackId !== input.track.id ||
    !Number.isFinite(input.track.durationMs) ||
    input.track.durationMs <= 0 ||
    input.manifest.totalChunks <= 0
  ) {
    return null;
  }

  const chunkDurationMs = input.track.durationMs / input.manifest.totalChunks;
  const localPieceSet = new Set(input.localPieceIndexes);
  let chunkIndex = resolveCurrentPlaybackChunkIndex({
    track: input.track,
    manifest: input.manifest,
    activePlaybackWindow: input.activePlaybackWindow
  });
  const startChunkIndex = chunkIndex;
  while (chunkIndex < input.manifest.totalChunks && localPieceSet.has(chunkIndex)) {
    chunkIndex += 1;
  }
  return Math.max(0, Math.round((chunkIndex - startChunkIndex) * chunkDurationMs));
}

function mergeManualCacheRequestPriority(
  current: ManualCacheRequestGroupPriority,
  next: ManualCacheRequestGroupPriority
): ManualCacheRequestGroupPriority {
  if (current === "active-critical" || next === "active-critical") {
    return "active-critical";
  }
  if (current === "active-fill" || next === "active-fill") {
    return "active-fill";
  }
  return "background";
}

function buildManualCachePlanRuntimeMetrics(input: {
  track: TrackMeta;
  manifest: ResolvedTrackPieceManifest;
  localPieceIndexes: readonly number[];
  requestGroups: readonly ManualCacheRequestGroup[];
  activePlaybackWindow: ActivePlaybackCacheWindow | null;
  resolvePeerRequestWindow?: (
    providerPeerId: string,
    trackId: string,
    priority: ManualCacheRequestPriority
  ) => ManualCachePeerRequestWindow | null | undefined;
}) {
  const peerSummaryById = new Map<string, ManualCachePeerSummary>();
  for (const group of input.requestGroups) {
    const requestPriority: ManualCacheRequestPriority =
      group.priority === "background" ? "background" : "active";
    const window =
      input.resolvePeerRequestWindow?.(group.providerPeerId, input.track.id, requestPriority) ??
      null;
    const existing = peerSummaryById.get(group.providerPeerId);
    peerSummaryById.set(group.providerPeerId, {
      peerId: group.providerPeerId,
      requestedChunkCount:
        (existing?.requestedChunkCount ?? 0) + group.chunkIndexes.length,
      priority: existing
        ? mergeManualCacheRequestPriority(existing.priority, group.priority)
        : group.priority,
      downloadRateKbps:
        finitePositiveNumber(window?.downloadRateKbps) ?? existing?.downloadRateKbps ?? null,
      roundTripTimeMs:
        finitePositiveNumber(window?.currentRoundTripTimeMs) ?? existing?.roundTripTimeMs ?? null,
      bufferedAmountBytes:
        finitePositiveNumber(window?.bufferedAmountBytes) ?? existing?.bufferedAmountBytes ?? null,
      transportScore: window?.transportScore ?? existing?.transportScore ?? null,
      candidateType: window?.candidateType ?? existing?.candidateType ?? null,
      protocol: window?.protocol ?? existing?.protocol ?? null
    });
  }

  const peerSummaries = [...peerSummaryById.values()];
  const downloadRates = peerSummaries
    .map((summary) => finitePositiveNumber(summary.downloadRateKbps))
    .filter((rate): rate is number => rate !== null);
  return {
    downloadRateKbps:
      downloadRates.length > 0
        ? Math.round(downloadRates.reduce((total, rate) => total + rate, 0))
        : null,
    activeAheadMs: resolveActiveCacheAheadMs({
      track: input.track,
      manifest: input.manifest,
      localPieceIndexes: input.localPieceIndexes,
      activePlaybackWindow: input.activePlaybackWindow
    }),
    activePeerCount: peerSummaries.filter((summary) => summary.priority !== "background").length,
    peerSummaries
  };
}

function buildManualCacheRequestGroups(input: {
  plan: ManualCacheTrackPlan;
  track: TrackMeta;
  manifest: ResolvedTrackPieceManifest;
  requestPriority: ManualCacheRequestPriority;
  activePlaybackWindow: ActivePlaybackCacheWindow | null;
  requestedChunkCountByPeer: Map<string, number>;
  resolvePeerRequestWindow?: (
    providerPeerId: string,
    trackId: string,
    priority: ManualCacheRequestPriority
  ) => ManualCachePeerRequestWindow | null | undefined;
}) {
  if (input.plan.requestableChunks.length === 0) {
    return [] as ManualCacheRequestGroup[];
  }

  const connectedProviderSet = new Set(input.plan.connectedProviderPeerIds);
  const allProviderEntries = input.plan.providerCandidates
    .filter((provider) => connectedProviderSet.has(provider.ownerPeerId))
    .map((provider) => {
      const window =
        input.resolvePeerRequestWindow?.(
          provider.ownerPeerId,
          input.track.id,
          input.requestPriority
        ) ?? null;
      const budget = resolveManualCacheDirectRequestBudget({
        trackId: input.track.id,
        track: input.track,
        manifest: input.manifest,
        activePlaybackWindow: input.activePlaybackWindow,
        peerWindow: window
      });
      const remainingPeerSlots = Math.max(
        0,
        budget.maxPendingPerPeer -
          (input.requestedChunkCountByPeer.get(provider.ownerPeerId) ?? 0)
      );
      return {
        provider,
        availableChunkSet: new Set(provider.availableChunks),
        window,
        budget,
        capacity: Math.min(budget.batchSize, remainingPeerSlots),
        score: scoreManualCacheProvider({
          providerPeerId: provider.ownerPeerId,
          window,
          availableChunkCount: provider.availableChunks.length
        })
      };
    })
    .filter((entry) => entry.capacity > 0)
    .sort((left, right) => {
      const scoreDifference = right.score - left.score;
      if (scoreDifference !== 0) {
        return scoreDifference;
      }
      return right.provider.availableChunks.length - left.provider.availableChunks.length;
    });
  const healthyProviderEntries = allProviderEntries.filter((entry) =>
    isProviderEligibleForRequest({
      requestPriority: input.requestPriority,
      window: entry.window
    })
  );
  const providerEntries =
    input.requestPriority === "active" && healthyProviderEntries.length === 0
      ? allProviderEntries
      : healthyProviderEntries;

  const assignedChunks = new Set<number>();
  const primaryProviderByChunk = new Map<number, string>();
  const requestGroups: ManualCacheRequestGroup[] = [];
  for (const entry of providerEntries) {
    const chunkIndexes = input.plan.requestableChunks
      .filter(
        (chunkIndex) =>
          !assignedChunks.has(chunkIndex) && entry.availableChunkSet.has(chunkIndex)
      )
      .slice(0, entry.capacity);
    if (chunkIndexes.length === 0) {
      continue;
    }
    for (const chunkIndex of chunkIndexes) {
      assignedChunks.add(chunkIndex);
      primaryProviderByChunk.set(chunkIndex, entry.provider.ownerPeerId);
    }
    requestGroups.push({
      providerPeerId: entry.provider.ownerPeerId,
      chunkIndexes,
      timeoutMs: entry.budget.timeoutMs,
      priority: resolveRequestGroupPriority(input.requestPriority)
    });
  }

  if (input.requestPriority === "active" && providerEntries.length > 1) {
    for (const chunkIndex of resolveRedundantActivePlaybackChunks({
      plan: input.plan,
      track: input.track,
      manifest: input.manifest,
      activePlaybackWindow: input.activePlaybackWindow
    })) {
      const primaryProviderPeerId = primaryProviderByChunk.get(chunkIndex);
      if (!primaryProviderPeerId) {
        continue;
      }
      const backupEntry = providerEntries.find(
        (entry) =>
          entry.provider.ownerPeerId !== primaryProviderPeerId &&
          entry.availableChunkSet.has(chunkIndex)
      );
      if (!backupEntry) {
        continue;
      }

      const existingGroup = requestGroups.find(
        (group) => group.providerPeerId === backupEntry.provider.ownerPeerId
      );
      if (existingGroup) {
        existingGroup.chunkIndexes = [...new Set([...existingGroup.chunkIndexes, chunkIndex])].sort(
          (left, right) => left - right
        );
      } else {
        requestGroups.push({
          providerPeerId: backupEntry.provider.ownerPeerId,
          chunkIndexes: [chunkIndex],
          timeoutMs: backupEntry.budget.timeoutMs,
          priority: "active-critical"
        });
      }
    }
  }

  return requestGroups;
}

function resolveAggregateRequestBatchSize(input: {
  trackId: string;
  track: TrackMeta;
  manifest: ResolvedTrackPieceManifest | null;
  activePlaybackWindow: ActivePlaybackCacheWindow | null;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  connectedPeerIds: string[];
  requestPriority: ManualCacheRequestPriority;
  resolvePeerRequestWindow?: (
    providerPeerId: string,
    trackId: string,
    priority: ManualCacheRequestPriority
  ) => ManualCachePeerRequestWindow | null | undefined;
}) {
  const connectedPeerSet = new Set(input.connectedPeerIds);
  let aggregateBatchSize = 0;
  for (const provider of Object.values(input.availabilityByTrack[input.trackId] ?? {})) {
    if (!connectedPeerSet.has(provider.ownerPeerId)) {
      continue;
    }
    const window =
      input.resolvePeerRequestWindow?.(provider.ownerPeerId, input.trackId, input.requestPriority) ??
      null;
    if (
      !isProviderEligibleForRequest({
        requestPriority: input.requestPriority,
        window
      })
    ) {
      continue;
    }
    const budget = resolveManualCacheDirectRequestBudget({
      trackId: input.trackId,
      track: input.track,
      manifest: input.manifest,
      activePlaybackWindow: input.activePlaybackWindow,
      peerWindow: window
    });
    aggregateBatchSize += Math.min(budget.batchSize, budget.maxPendingPerPeer);
  }

  return Math.max(1, aggregateBatchSize || directRequestBatchSize);
}

function resolveBackgroundRequestChunkLimit(input: {
  requestPriority: ManualCacheRequestPriority;
  activePlaybackWindow: ActivePlaybackCacheWindow | null;
  activeAheadMs: number | null;
}) {
  if (input.requestPriority !== "background" || !input.activePlaybackWindow?.trackId) {
    return Number.MAX_SAFE_INTEGER;
  }

  if (input.activeAheadMs === null) {
    return 0;
  }

  if (input.activeAheadMs < 45_000) {
    return 0;
  }

  if (input.activeAheadMs < 90_000) {
    return 8;
  }

  return Number.MAX_SAFE_INTEGER;
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

function resolveActivePlaybackPendingPriorityState(input: {
  track: TrackMeta;
  manifest: ResolvedTrackPieceManifest;
  localPieceIndexes: number[];
  pendingForTrack: Map<number, number>;
  activePlaybackWindow: ActivePlaybackCacheWindow | null | undefined;
}) {
  if (input.activePlaybackWindow?.trackId !== input.track.id) {
    return {
      activePriorityChunks: [] as number[],
      missingPriorityChunks: [] as number[]
    };
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

  return {
    activePriorityChunks,
    missingPriorityChunks
  };
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
    input.targetFreeSlots <= 0
  ) {
    return false;
  }

  const { activePriorityChunks, missingPriorityChunks } =
    resolveActivePlaybackPendingPriorityState(input);
  if (missingPriorityChunks.length === 0) {
    return false;
  }

  const priorityChunkSet = new Set(activePriorityChunks);
  const requiredFreeSlots = Math.min(input.targetFreeSlots, missingPriorityChunks.length);
  const targetPendingSize = Math.max(0, input.maxPendingChunks - requiredFreeSlots);
  if (input.pendingForTrack.size <= targetPendingSize) {
    return false;
  }

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
    timeoutMs: number,
    options?: PieceRequestOptions
  ) => boolean;
  resolvePeerRequestWindow?: (
    providerPeerId: string,
    trackId: string,
    priority: ManualCacheRequestPriority
  ) => ManualCachePeerRequestWindow | null | undefined;
  isProviderChunkUnavailable?: (
    providerPeerId: string,
    trackId: string,
    chunkIndex: number,
    now: number
  ) => boolean;
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
  let activeTrackAheadMs: number | null = null;
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
          requestGroups: [],
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
    const activePlaybackPriorityState = manifestHint
      ? resolveActivePlaybackPendingPriorityState({
          track,
          manifest: manifestHint,
          localPieceIndexes,
          pendingForTrack,
          activePlaybackWindow: input.activePlaybackWindow ?? null
        })
      : null;
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
    const aggregateRequestBatchSize = resolveAggregateRequestBatchSize({
      trackId,
      track,
      manifest: manifestHint,
      activePlaybackWindow: input.activePlaybackWindow ?? null,
      availabilityByTrack: input.availabilityByTrack,
      connectedPeerIds: input.connectedPeerIds,
      requestPriority,
      resolvePeerRequestWindow: input.resolvePeerRequestWindow
    });
    const shouldRefillPendingWindow =
      releasedActivePrioritySlots ||
      pendingForTrack.size === 0 ||
      pendingForTrack.size <= pendingRefillLowWatermark ||
      (
        requestPriority === "active" &&
        (activePlaybackPriorityState?.missingPriorityChunks.length ?? 0) > 0 &&
        remainingTrackSlots > 0
      );
    const backgroundRequestChunkLimit = resolveBackgroundRequestChunkLimit({
      requestPriority,
      activePlaybackWindow: input.activePlaybackWindow ?? null,
      activeAheadMs: activeTrackAheadMs
    });
    const trackAvailability = Object.fromEntries(
      Object.entries(input.availabilityByTrack[trackId] ?? {})
        .map(([providerPeerId, announcement]) => [
          providerPeerId,
          {
            ...announcement,
            availableChunks: announcement.availableChunks.filter(
              (chunkIndex) =>
                !input.isProviderChunkUnavailable?.(
                  providerPeerId,
                  trackId,
                  chunkIndex,
                  now
                )
            )
          }
        ] as const)
        .filter(([, announcement]) => announcement.availableChunks.length > 0)
    );
    const plan = resolveManualCacheTrackPlan({
      track,
      roomId,
      localPeerId: input.peerId,
      availabilityByTrack: {
        ...input.availabilityByTrack,
        [trackId]: trackAvailability
      },
      connectedPeerIds: input.connectedPeerIds,
      cachedManifest,
      localPieceIndexes,
      pendingChunkIndexes: [...pendingForTrack.keys()],
      activePlaybackWindow: input.activePlaybackWindow ?? null,
      maxPendingChunks: requestBudget.maxPendingPerTrack,
      maxRequestChunks: shouldRefillPendingWindow
        ? Math.min(
            aggregateRequestBatchSize,
            remainingTrackSlots,
            requestBudget.maxPendingPerTrack,
            backgroundRequestChunkLimit
          )
        : 0
    });

    if (!plan.selectedProviderPeerId || plan.requestableChunks.length === 0 || !plan.manifest) {
      results.push({ plan, didRequest: null });
      continue;
    }

    const selectedManifest = plan.manifest;
    const requestGroups = buildManualCacheRequestGroups({
      plan,
      track,
      manifest: selectedManifest,
      requestPriority,
      activePlaybackWindow: input.activePlaybackWindow ?? null,
      requestedChunkCountByPeer,
      resolvePeerRequestWindow: input.resolvePeerRequestWindow
    });
    const requestableChunks = [
      ...new Set(requestGroups.flatMap((group) => group.chunkIndexes))
    ].sort((left, right) => left - right);
    const runtimeMetrics = buildManualCachePlanRuntimeMetrics({
      track,
      manifest: selectedManifest,
      localPieceIndexes,
      requestGroups,
      activePlaybackWindow: input.activePlaybackWindow ?? null,
      resolvePeerRequestWindow: input.resolvePeerRequestWindow
    });
    if (requestPriority === "active") {
      activeTrackAheadMs = runtimeMetrics.activeAheadMs ?? null;
    }
    if (requestableChunks.length === 0) {
      results.push({
        plan: {
          ...plan,
          requestableChunks,
          requestGroups,
          blockedReason: null,
          ...runtimeMetrics
        },
        didRequest: null
      });
      continue;
    }

    const requestPlan = {
      ...plan,
      selectedProviderPeerId: requestGroups[0]?.providerPeerId ?? plan.selectedProviderPeerId,
      requestableChunks,
      requestGroups,
      ...runtimeMetrics
    };
    let didRequestAny = false;
    let didRequestFailed = false;
    const expiresAt = now + requestBudget.pendingTtlMs;
    const requestedChunkIndexes = new Set<number>();
    for (const group of requestGroups) {
      const hasRedundantChunks = group.chunkIndexes.some((chunkIndex) =>
        requestedChunkIndexes.has(chunkIndex)
      );
      const didRequestGroup = hasRedundantChunks
        ? input.requestPieces(
            group.providerPeerId,
            trackId,
            group.chunkIndexes,
            selectedManifest.totalChunks,
          group.timeoutMs,
            { allowRedundant: true, maxReplicas: 2, priority: "critical" }
          )
        : input.requestPieces(
            group.providerPeerId,
            trackId,
            group.chunkIndexes,
            selectedManifest.totalChunks,
            group.timeoutMs,
            {
              priority: group.priority === "background" ? "bulk" : "critical"
            }
          );
      if (didRequestGroup) {
        didRequestAny = true;
        for (const chunkIndex of group.chunkIndexes) {
          requestedChunkIndexes.add(chunkIndex);
        }
        requestedChunkCountByPeer.set(
          group.providerPeerId,
          (requestedChunkCountByPeer.get(group.providerPeerId) ?? 0) + group.chunkIndexes.length
        );
        for (const chunkIndex of group.chunkIndexes) {
          pendingForTrack.set(chunkIndex, expiresAt);
        }
      } else {
        didRequestFailed = true;
      }
    }

    results.push({
      plan: requestPlan,
      didRequest: didRequestAny ? true : didRequestFailed ? false : null
    });
  }

  return results;
}
