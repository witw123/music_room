"use client";

import type { RoomSnapshot, TrackAvailabilityAnnouncement, TrackMeta } from "@music-room/shared";
import type { TrackPieceManifestRecord } from "@/lib/indexeddb";
import {
  getPriorityChunkIndexes,
  getStartupWindowMs,
  isFlacTrack,
  type ProgressiveSchedulerPolicy
} from "@/features/playback/progressive-playback";
import {
  getRequiredDecodablePrefixChunkCount,
  resolveSlidingWindowChunkOrder
} from "@/features/playback/sliding-window/playback-window-scheduler";
import {
  resolveTrackPieceManifest,
  selectCanonicalTrackAvailabilityAnnouncement,
  type ResolvedTrackPieceManifest
} from "@/features/p2p";
import type { RoomRuntimeEvent } from "./room-runtime-types";
import { isStableFullChunkIndexList } from "./manual-cache-download-progress";

const directRequestBatchSize = 32;
const maxPendingPerTrack = 128;
const providerBootstrapRetryCooldownMs = 1_500;
const providerRestartAfterMs = 6_000;
const providerRestartCooldownMs = 5_000;

export type ManualCacheManifestSource = ResolvedTrackPieceManifest["source"] | "none";
export type ManualCacheBlockedReason =
  | "missing-track"
  | "missing-manifest"
  | "complete"
  | "no-provider"
  | "provider-not-connected"
  | "provider-has-no-requestable-chunks"
  | "pending-window-full";

export type ManualCacheTrackPlan = {
  trackId: string;
  manifest: ResolvedTrackPieceManifest | null;
  manifestSource: ManualCacheManifestSource;
  integrityMode: "strong" | "weak" | null;
  localPieceIndexes: number[];
  providerCandidates: TrackAvailabilityAnnouncement[];
  providerPeerIds: string[];
  connectedProviderPeerIds: string[];
  selectedProviderPeerId: string | null;
  requestableChunks: number[];
  pendingChunkCount: number;
  blockedReason: ManualCacheBlockedReason | null;
};

export type ActivePlaybackCacheWindow = {
  trackId: string;
  positionMs: number;
  revision: number;
  mediaEpoch: number;
  status: RoomSnapshot["room"]["playback"]["status"];
  policy: ProgressiveSchedulerPolicy;
};

export function getActivePlaybackPendingKey(
  activePlaybackWindow: ActivePlaybackCacheWindow | null | undefined
) {
  if (!activePlaybackWindow) {
    return null;
  }

  return [
    activePlaybackWindow.trackId,
    activePlaybackWindow.revision,
    activePlaybackWindow.mediaEpoch
  ].join("|");
}

export function shouldForceManualCacheBootstrap(input: {
  enableManualTrackCaching: boolean;
  manualCacheTrackIds: string[];
  providerPeerIds: string[];
  connectedPeerIds: string[];
  lastBootstrapKey: string | null;
}) {
  if (
    !input.enableManualTrackCaching ||
    input.manualCacheTrackIds.length === 0 ||
    input.providerPeerIds.length === 0
  ) {
    return null;
  }

  const connectedPeerSet = new Set(input.connectedPeerIds);
  const hasConnectedProvider = input.providerPeerIds.some((peerId) => connectedPeerSet.has(peerId));
  if (hasConnectedProvider) {
    return null;
  }

  const nextKey = [
    input.manualCacheTrackIds.join(","),
    input.providerPeerIds.join(",")
  ].join("|");
  return nextKey === input.lastBootstrapKey ? null : nextKey;
}

export function shouldRecordManualCacheBootstrapAttempt(input: {
  syncStarted: boolean;
  previousBootstrapKey: string | null;
  nextBootstrapKey: string | null;
}) {
  return (
    input.syncStarted &&
    !!input.nextBootstrapKey &&
    input.nextBootstrapKey !== input.previousBootstrapKey
  );
}

export function resolveManualCacheMeshRecoveryMode(input: {
  shouldRecover: boolean;
  remotePeerIds: string[];
  connectedPeerIds: string[];
  recoverySinceAt: number | null;
  now?: number;
}) {
  if (!input.shouldRecover || input.remotePeerIds.length === 0) {
    return "none" as const;
  }

  const now = input.now ?? Date.now();
  const connectedPeerSet = new Set(input.connectedPeerIds);
  const hasConnectedRemotePeer = input.remotePeerIds.some((peerId) => connectedPeerSet.has(peerId));

  if (hasConnectedRemotePeer || input.recoverySinceAt === null) {
    return "sync" as const;
  }

  return now - input.recoverySinceAt >= 10_000 ? "force-reconnect" as const : "sync" as const;
}

export function shouldRecoverManualCacheDataPeers(input: {
  enableManualTrackCaching: boolean;
  manualCacheTrackIds: string[];
  remotePeerIds: string[];
  connectedPeerIds: string[];
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  localPeerId: string | null | undefined;
}) {
  if (!input.enableManualTrackCaching || input.manualCacheTrackIds.length === 0) {
    return false;
  }

  const remotePeerSet = new Set(input.remotePeerIds.filter(Boolean));
  if (remotePeerSet.size === 0) {
    return false;
  }

  const connectedPeerSet = new Set(input.connectedPeerIds.filter((peerId) => remotePeerSet.has(peerId)));
  if (connectedPeerSet.size === 0) {
    return true;
  }

  return input.manualCacheTrackIds.some((trackId) => {
    const remoteAvailabilityOwners = Object.values(input.availabilityByTrack[trackId] ?? {})
      .filter((announcement) => announcement.ownerPeerId !== input.localPeerId)
      .map((announcement) => announcement.ownerPeerId)
      .filter((peerId) => remotePeerSet.has(peerId));

    if (remoteAvailabilityOwners.length === 0) {
      return true;
    }

    return !remoteAvailabilityOwners.some((peerId) => connectedPeerSet.has(peerId));
  });
}

export function shouldRetryManualCacheProviderBootstrap(input: {
  manualCacheTrackIds: string[];
  providerPeerIds: string[];
  connectedPeerIds: string[];
  lastBootstrapAttemptAt: number | null;
  now?: number;
}) {
  if (input.manualCacheTrackIds.length === 0 || input.providerPeerIds.length === 0) {
    return false;
  }

  const connectedPeerSet = new Set(input.connectedPeerIds.filter(Boolean));
  const hasConnectedProvider = input.providerPeerIds.some((peerId) => connectedPeerSet.has(peerId));
  if (hasConnectedProvider) {
    return false;
  }

  const now = input.now ?? Date.now();
  return (
    input.lastBootstrapAttemptAt === null ||
    now - input.lastBootstrapAttemptAt >= providerBootstrapRetryCooldownMs
  );
}

export function shouldRestartManualCacheProviderPeer(input: {
  providerPeerId: string;
  connectedPeerIds: string[];
  unavailableSinceAt: number | null;
  lastRestartAt: number | null;
  now?: number;
}) {
  if (!input.providerPeerId || input.connectedPeerIds.includes(input.providerPeerId)) {
    return false;
  }

  const now = input.now ?? Date.now();
  if (
    input.unavailableSinceAt === null ||
    now - input.unavailableSinceAt < providerRestartAfterMs
  ) {
    return false;
  }

  return input.lastRestartAt === null || now - input.lastRestartAt >= providerRestartCooldownMs;
}

export function buildManualCacheRequestFailureEvent(input: {
  providerPeerId: string;
  trackId: string;
  requestableChunks: number[];
}): RoomRuntimeEvent {
  const chunkSummary =
    input.requestableChunks.length === 0
      ? "none"
      : input.requestableChunks.length === 1
      ? `${input.requestableChunks[0]}`
      : `${input.requestableChunks[0]}-${input.requestableChunks[input.requestableChunks.length - 1]}`;
  return {
    type: "diagnostic",
    peerId: input.providerPeerId,
    channelKind: "data",
    direction: "local",
    event: "manual-cache-request-not-sent",
    summary: `缓存下载请求未发出 ${input.trackId}#${chunkSummary}：DataChannel 未打开`,
    level: "warning",
    recordEvent: false
  };
}

function resolveManualCacheRequestOrder(input: {
  manifest: ResolvedTrackPieceManifest;
  track: TrackMeta;
  localPieceIndexes: number[];
  activePlaybackWindow: ActivePlaybackCacheWindow | null;
}) {
  const localPieceSet = new Set(input.localPieceIndexes);
  if (input.activePlaybackWindow?.trackId !== input.track.id) {
    const missingChunks: number[] = [];
    for (let chunkIndex = 0; chunkIndex < input.manifest.totalChunks; chunkIndex += 1) {
      if (!localPieceSet.has(chunkIndex)) {
        missingChunks.push(chunkIndex);
      }
    }
    return missingChunks;
  }

  const startupLookAheadMs = getStartupWindowMs({
    mimeType: input.manifest.pieceMimeType ?? input.track.mimeType ?? "audio/mpeg",
    codec: input.track.codec ?? null
  });
  if (
    isFlacTrack({
      mimeType: input.manifest.pieceMimeType ?? input.track.mimeType ?? "audio/mpeg",
      codec: input.track.codec ?? null
    })
  ) {
    const orderedChunks = getPriorityChunkIndexes({
      manifest: {
        trackId: input.track.id,
        fileHash: input.track.fileHash,
        mimeType: input.manifest.pieceMimeType ?? input.track.mimeType ?? "audio/flac",
        codec: input.track.codec ?? null,
        sizeBytes: input.track.sizeBytes ?? null,
        durationMs: input.track.durationMs,
        totalChunks: input.manifest.totalChunks,
        chunkSize: input.manifest.chunkSize
      },
      availableChunks: input.localPieceIndexes,
      playbackPositionMs: input.activePlaybackWindow.positionMs,
      policy: input.activePlaybackWindow.policy,
      lookBehindMs: 4_000,
      lookAheadMs: input.activePlaybackWindow.policy === "catchup" ? 60_000 : startupLookAheadMs
    });
    const seen = new Set(orderedChunks);
    for (let chunkIndex = 0; chunkIndex < input.manifest.totalChunks; chunkIndex += 1) {
      if (!localPieceSet.has(chunkIndex) && !seen.has(chunkIndex)) {
        orderedChunks.push(chunkIndex);
        seen.add(chunkIndex);
      }
    }
    return orderedChunks;
  }

  const orderedChunks = resolveSlidingWindowChunkOrder({
    manifest: {
      durationMs: input.track.durationMs,
      totalChunks: input.manifest.totalChunks,
      chunkSize: input.manifest.chunkSize
    },
    playbackPositionMs: input.activePlaybackWindow.positionMs,
    availableChunks: input.localPieceIndexes,
    requiredLeadingChunkCount: getRequiredDecodablePrefixChunkCount({
      manifest: {
        durationMs: input.track.durationMs,
        totalChunks: input.manifest.totalChunks
      },
      playbackPositionMs: input.activePlaybackWindow.positionMs,
      lookAheadMs: startupLookAheadMs
    }),
    lookBehindMs: 4_000,
    startupLookAheadMs,
    steadyLookAheadMs: input.activePlaybackWindow.policy === "catchup" ? 60_000 : 30_000
  });
  const seen = new Set(orderedChunks);
  for (let chunkIndex = 0; chunkIndex < input.manifest.totalChunks; chunkIndex += 1) {
    if (!localPieceSet.has(chunkIndex) && !seen.has(chunkIndex)) {
      orderedChunks.push(chunkIndex);
      seen.add(chunkIndex);
    }
  }
  return orderedChunks;
}

function emptyManualCacheTrackPlan(
  trackId: string,
  blockedReason: ManualCacheBlockedReason
): ManualCacheTrackPlan {
  return {
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
    blockedReason
  };
}

export function resolveManualCacheTrackProviderPeerId(input: {
  trackId: string;
  roomSnapshot: RoomSnapshot | null | undefined;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  connectedPeerIds: string[];
  localPeerId: string | null | undefined;
}) {
  const track = input.roomSnapshot?.tracks.find((entry) => entry.id === input.trackId) ?? null;
  const owner = track
    ? input.roomSnapshot?.room.members.find((member) => member.id === track.ownerSessionId) ?? null
    : null;
  if (
    owner?.peerId &&
    owner.peerId !== input.localPeerId &&
    owner.presenceState !== "offline" &&
    input.connectedPeerIds.includes(owner.peerId)
  ) {
    return owner.peerId;
  }

  return (
    Object.values(input.availabilityByTrack[input.trackId] ?? {})
      .filter(
        (announcement) =>
          announcement.ownerPeerId !== input.localPeerId &&
          announcement.totalChunks > 0 &&
          announcement.availableChunks.length > 0 &&
          input.connectedPeerIds.includes(announcement.ownerPeerId)
      )
      .sort((left, right) => {
        const chunkDifference = right.availableChunks.length - left.availableChunks.length;
        if (chunkDifference !== 0) {
          return chunkDifference;
        }
        return new Date(right.announcedAt).getTime() - new Date(left.announcedAt).getTime();
      })[0]?.ownerPeerId ?? null
  );
}

export function resolveManualCacheTrackPlan(input: {
  track: TrackMeta | null;
  roomId: string;
  localPeerId: string;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  connectedPeerIds: string[];
  cachedManifest: TrackPieceManifestRecord | null;
  localPieceIndexes: number[];
  pendingChunkIndexes: number[];
  maxRequestChunks?: number;
  maxPendingChunks?: number;
  activePlaybackWindow?: ActivePlaybackCacheWindow | null;
}): ManualCacheTrackPlan {
  const trackId = input.track?.id ?? "";
  if (!input.track) {
    return emptyManualCacheTrackPlan(trackId, "missing-track");
  }

  const connectedPeerSet = new Set(input.connectedPeerIds);
  const pendingChunkSet = new Set(input.pendingChunkIndexes);
  const availabilityCandidates = Object.values(input.availabilityByTrack[input.track.id] ?? {}).filter(
    (announcement) =>
      announcement.roomId === input.roomId &&
      announcement.ownerPeerId !== input.localPeerId &&
      announcement.totalChunks > 0 &&
      announcement.chunkSize > 0 &&
      announcement.availableChunks.length > 0
  );
  const canonicalAvailability = selectCanonicalTrackAvailabilityAnnouncement(availabilityCandidates);
  const manifest = resolveTrackPieceManifest({
    track: input.track,
    cacheManifest: input.cachedManifest,
    availability: canonicalAvailability
  });
  if (!manifest) {
    return {
      ...emptyManualCacheTrackPlan(input.track.id, "missing-manifest"),
      providerCandidates: availabilityCandidates,
      providerPeerIds: availabilityCandidates.map((announcement) => announcement.ownerPeerId),
      connectedProviderPeerIds: availabilityCandidates
        .map((announcement) => announcement.ownerPeerId)
        .filter((peerId) => connectedPeerSet.has(peerId)),
      pendingChunkCount: pendingChunkSet.size
    };
  }

  const localPieceSet = new Set(
    input.localPieceIndexes.filter(
      (chunkIndex) => chunkIndex >= 0 && chunkIndex < manifest.totalChunks
    )
  );
  if (localPieceSet.size >= manifest.totalChunks) {
    return {
      ...emptyManualCacheTrackPlan(input.track.id, "complete"),
      manifest,
      manifestSource: manifest.source,
      integrityMode: manifest.pieceHashes?.length === manifest.totalChunks ? "strong" : "weak",
      localPieceIndexes: [...localPieceSet].sort((left, right) => left - right),
      pendingChunkCount: pendingChunkSet.size
    };
  }

  const providerCandidates = availabilityCandidates
    .filter(
      (announcement) =>
        announcement.totalChunks === manifest.totalChunks &&
        announcement.chunkSize === manifest.chunkSize
    )
    .sort((left, right) => {
      const connectedDifference =
        Number(connectedPeerSet.has(right.ownerPeerId)) - Number(connectedPeerSet.has(left.ownerPeerId));
      if (connectedDifference !== 0) {
        return connectedDifference;
      }
      const chunkDifference = right.availableChunks.length - left.availableChunks.length;
      if (chunkDifference !== 0) {
        return chunkDifference;
      }
      return new Date(right.announcedAt).getTime() - new Date(left.announcedAt).getTime();
    });
  const connectedProviderCandidates = providerCandidates.filter((announcement) =>
    connectedPeerSet.has(announcement.ownerPeerId)
  );
  const providerPeerIds = [...new Set(providerCandidates.map((announcement) => announcement.ownerPeerId))];
  const connectedProviderPeerIds = [
    ...new Set(connectedProviderCandidates.map((announcement) => announcement.ownerPeerId))
  ];
  const missingChunks = resolveManualCacheRequestOrder({
    manifest,
    track: input.track,
    localPieceIndexes: [...localPieceSet],
    activePlaybackWindow: input.activePlaybackWindow ?? null
  });

  if (providerCandidates.length === 0) {
    return {
      trackId: input.track.id,
      manifest,
      manifestSource: manifest.source,
      integrityMode: manifest.pieceHashes?.length === manifest.totalChunks ? "strong" : "weak",
      localPieceIndexes: [...localPieceSet].sort((left, right) => left - right),
      providerCandidates,
      providerPeerIds,
      connectedProviderPeerIds,
      selectedProviderPeerId: null,
      requestableChunks: [],
      pendingChunkCount: pendingChunkSet.size,
      blockedReason: "no-provider"
    };
  }

  if (connectedProviderCandidates.length === 0) {
    return {
      trackId: input.track.id,
      manifest,
      manifestSource: manifest.source,
      integrityMode: manifest.pieceHashes?.length === manifest.totalChunks ? "strong" : "weak",
      localPieceIndexes: [...localPieceSet].sort((left, right) => left - right),
      providerCandidates,
      providerPeerIds,
      connectedProviderPeerIds,
      selectedProviderPeerId: null,
      requestableChunks: [],
      pendingChunkCount: pendingChunkSet.size,
      blockedReason: "provider-not-connected"
    };
  }

  for (const provider of connectedProviderCandidates) {
    const providerHasFullTrack = isStableFullChunkIndexList(
      provider.availableChunks,
      manifest.totalChunks
    );
    const availableChunkSet = providerHasFullTrack ? null : new Set(provider.availableChunks);
    const requestableChunks = missingChunks
      .filter(
        (chunkIndex) =>
          (providerHasFullTrack || availableChunkSet?.has(chunkIndex)) &&
          !pendingChunkSet.has(chunkIndex)
      )
      .slice(0, input.maxRequestChunks ?? directRequestBatchSize);
    if (requestableChunks.length > 0) {
      return {
        trackId: input.track.id,
        manifest,
        manifestSource: manifest.source,
        integrityMode: manifest.pieceHashes?.length === manifest.totalChunks ? "strong" : "weak",
        localPieceIndexes: [...localPieceSet].sort((left, right) => left - right),
        providerCandidates,
        providerPeerIds,
        connectedProviderPeerIds,
        selectedProviderPeerId: provider.ownerPeerId,
        requestableChunks,
        pendingChunkCount: pendingChunkSet.size,
        blockedReason: null
      };
    }
  }

  return {
    trackId: input.track.id,
    manifest,
    manifestSource: manifest.source,
    integrityMode: manifest.pieceHashes?.length === manifest.totalChunks ? "strong" : "weak",
    localPieceIndexes: [...localPieceSet].sort((left, right) => left - right),
    providerCandidates,
    providerPeerIds,
    connectedProviderPeerIds,
    selectedProviderPeerId: null,
    requestableChunks: [],
    pendingChunkCount: pendingChunkSet.size,
    blockedReason:
      pendingChunkSet.size > 0 &&
      (pendingChunkSet.size >= (input.maxPendingChunks ?? maxPendingPerTrack) ||
        (input.maxRequestChunks ?? directRequestBatchSize) <= 0)
        ? "pending-window-full"
        : "provider-has-no-requestable-chunks"
  };
}
