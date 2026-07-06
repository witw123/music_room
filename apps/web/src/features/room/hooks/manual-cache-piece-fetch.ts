"use client";

import type { RoomSnapshot, TrackAvailabilityAnnouncement, TrackMeta } from "@music-room/shared";
import type { TrackPieceManifestRecord } from "@/lib/indexeddb";
import { resolveTrackPieceManifest, type ResolvedTrackPieceManifest } from "@/features/p2p";
import {
  resolveManualCacheTrackPlan,
  type ActivePlaybackCacheWindow,
  type ManualCacheTrackPlan
} from "./manual-cache-download-queue";

const directRequestBatchSize = 32;
const activePlaybackDirectRequestBatchSize = 12;
const directRequestTimeoutMs = 15_000;
const directPendingTtlMs = 20_000;
const maxPendingPerTrack = 128;
const maxPendingPerPeer = 32;
const activePlaybackMaxPendingPerTrack = 48;
const activePlaybackMaxPendingPerPeer = 12;

export type ManualCacheDirectRequestResult = {
  plan: ManualCacheTrackPlan;
  didRequest: boolean | null;
};

type ManualCacheDirectRequestBudget = {
  batchSize: number;
  maxPendingPerTrack: number;
  maxPendingPerPeer: number;
};

function resolveManualCacheDirectRequestBudget(input: {
  trackId: string;
  activePlaybackWindow?: ActivePlaybackCacheWindow | null;
}): ManualCacheDirectRequestBudget {
  if (input.activePlaybackWindow?.trackId === input.trackId) {
    return {
      batchSize: activePlaybackDirectRequestBatchSize,
      maxPendingPerTrack: activePlaybackMaxPendingPerTrack,
      maxPendingPerPeer: activePlaybackMaxPendingPerPeer
    };
  }

  return {
    batchSize: directRequestBatchSize,
    maxPendingPerTrack,
    maxPendingPerPeer
  };
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
}) {
  const results: ManualCacheDirectRequestResult[] = [];
  const roomId = input.roomSnapshot?.room.id ?? null;
  if (!roomId || !input.peerId || input.manualCacheTrackIds.length === 0) {
    return results;
  }

  const now = input.now ?? Date.now();
  for (const trackId of input.manualCacheTrackIds) {
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

    const requestBudget = resolveManualCacheDirectRequestBudget({
      trackId,
      activePlaybackWindow: input.activePlaybackWindow ?? null
    });
    const pendingRefillLowWatermark =
      requestBudget.maxPendingPerTrack - requestBudget.maxPendingPerPeer;
    const remainingTrackSlots = Math.max(0, requestBudget.maxPendingPerTrack - pendingForTrack.size);
    const shouldRefillPendingWindow =
      pendingForTrack.size === 0 || pendingForTrack.size <= pendingRefillLowWatermark;
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

    const didRequest = input.requestPieces(
      plan.selectedProviderPeerId,
      trackId,
      plan.requestableChunks,
      plan.manifest.totalChunks,
      directRequestTimeoutMs
    );
    if (didRequest) {
      const expiresAt = now + directPendingTtlMs;
      for (const chunkIndex of plan.requestableChunks) {
        pendingForTrack.set(chunkIndex, expiresAt);
      }
    }

    results.push({ plan, didRequest });
  }

  return results;
}
