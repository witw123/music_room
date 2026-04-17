"use client";

import { useEffect, useMemo, useRef } from "react";
import type { RoomSnapshot, TrackAvailabilityAnnouncement, TrackMeta } from "@music-room/shared";
import {
  getCachedPieceIndexes,
  getTrackPieceManifest,
  getTrackPieceManifestByFileHash,
  localCacheOwnerKey,
  type TrackPieceManifestRecord
} from "@/lib/indexeddb";
import {
  resolveTrackPieceManifest,
  selectCanonicalTrackAvailabilityAnnouncement,
  type ResolvedTrackPieceManifest
} from "@/features/p2p";
import type { DataMeshBridge, RoomRuntimeEvent } from "./room-runtime-types";

const directRequestIntervalMs = 450;
const directRequestBatchSize = 16;
const directRequestTimeoutMs = 5_000;
const directPendingTtlMs = 12_000;
const maxPendingPerTrack = 32;
const maxPendingPerPeer = 8;
const pendingRefillLowWatermark = maxPendingPerTrack - maxPendingPerPeer;
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

export function mergePeerIds(...peerIdGroups: Array<readonly string[]>) {
  const peerIds = new Set<string>();
  for (const group of peerIdGroups) {
    for (const peerId of group) {
      if (peerId) {
        peerIds.add(peerId);
      }
    }
  }
  return [...peerIds].sort();
}

export function resolveManualCacheProviderPeerIds(input: {
  manualCacheTrackIds: string[];
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  localPeerId: string | null | undefined;
  allowedPeerIds?: string[];
}) {
  const allowedPeerSet =
    input.allowedPeerIds && input.allowedPeerIds.length > 0
      ? new Set(input.allowedPeerIds.filter(Boolean))
      : null;
  const providerPeerIds = new Set<string>();

  for (const trackId of input.manualCacheTrackIds) {
    for (const announcement of Object.values(input.availabilityByTrack[trackId] ?? {})) {
      if (!announcement.ownerPeerId || announcement.ownerPeerId === input.localPeerId) {
        continue;
      }
      if (announcement.totalChunks <= 0 || announcement.availableChunks.length === 0) {
        continue;
      }
      if (allowedPeerSet && !allowedPeerSet.has(announcement.ownerPeerId)) {
        continue;
      }
      providerPeerIds.add(announcement.ownerPeerId);
    }
  }

  return [...providerPeerIds].sort();
}

export function resolveManualCacheUploaderPeerIds(input: {
  manualCacheTrackIds: string[];
  roomSnapshot: RoomSnapshot | null | undefined;
  localPeerId: string | null | undefined;
}) {
  if (!input.roomSnapshot || input.manualCacheTrackIds.length === 0) {
    return [] as string[];
  }

  const tracksById = new Map(input.roomSnapshot.tracks.map((track) => [track.id, track] as const));
  const membersBySessionId = new Map(
    input.roomSnapshot.room.members.map((member) => [member.id, member] as const)
  );
  const peerIds = new Set<string>();

  for (const trackId of input.manualCacheTrackIds) {
    const track = tracksById.get(trackId);
    if (!track) {
      continue;
    }

    const owner = membersBySessionId.get(track.ownerSessionId);
    if (
      !owner?.peerId ||
      owner.peerId === input.localPeerId ||
      owner.presenceState === "offline"
    ) {
      continue;
    }
    peerIds.add(owner.peerId);
  }

  return [...peerIds].sort();
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

export function buildManualCacheSchedulerAvailability(input: {
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  manualCacheTrackIds: string[];
  roomSnapshot: RoomSnapshot | null | undefined;
  localPeerId: string | null | undefined;
}) {
  if (!input.roomSnapshot || input.manualCacheTrackIds.length === 0) {
    return input.availabilityByTrack;
  }

  const activeMemberPeerIds = new Set(
    input.roomSnapshot.room.members
      .map((member) => member.peerId)
      .filter((peerId): peerId is string => !!peerId)
  );
  const membersBySessionId = new Map(
    input.roomSnapshot.room.members.map((member) => [member.id, member] as const)
  );
  const tracksById = new Map(input.roomSnapshot.tracks.map((track) => [track.id, track] as const));
  const nextAvailabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>> = {};

  for (const trackId of input.manualCacheTrackIds) {
    const track = tracksById.get(trackId) ?? null;
    const currentAvailability = input.availabilityByTrack[trackId] ?? {};
    const nextTrackAvailability: Record<string, TrackAvailabilityAnnouncement> = {};

    for (const announcement of Object.values(currentAvailability)) {
      if (
        announcement.roomId === input.roomSnapshot.room.id &&
        activeMemberPeerIds.has(announcement.ownerPeerId)
      ) {
        nextTrackAvailability[announcement.ownerPeerId] = announcement;
      }
    }

    if (!track) {
      if (Object.keys(nextTrackAvailability).length > 0) {
        nextAvailabilityByTrack[trackId] = nextTrackAvailability;
      }
      continue;
    }

    const owner = membersBySessionId.get(track.ownerSessionId) ?? null;
    const ownerPeerId = owner?.peerId ?? null;
    const manifest = track.relayManifest ?? track.pieceManifest ?? null;
    if (
      owner &&
      ownerPeerId &&
      ownerPeerId !== input.localPeerId &&
      owner.presenceState !== "offline" &&
      manifest &&
      !nextTrackAvailability[ownerPeerId]
    ) {
      nextTrackAvailability[ownerPeerId] = {
        roomId: input.roomSnapshot.room.id,
        trackId: track.id,
        ownerPeerId,
        nickname: owner.nickname,
        assetKind: "relay",
        assetHash: track.fileHash,
        totalChunks: manifest.totalChunks,
        chunkSize: manifest.chunkSize,
        availableChunks: Array.from({ length: manifest.totalChunks }, (_, chunkIndex) => chunkIndex),
        source: "live_upload",
        announcedAt: "1970-01-01T00:00:00.000Z"
      };
    }

    if (Object.keys(nextTrackAvailability).length > 0) {
      nextAvailabilityByTrack[trackId] = nextTrackAvailability;
    }
  }

  return nextAvailabilityByTrack;
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
  const missingChunks: number[] = [];
  for (let chunkIndex = 0; chunkIndex < manifest.totalChunks; chunkIndex += 1) {
    if (!localPieceSet.has(chunkIndex)) {
      missingChunks.push(chunkIndex);
    }
  }

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
    const availableChunkSet = new Set(provider.availableChunks);
    const requestableChunks = missingChunks
      .filter((chunkIndex) => availableChunkSet.has(chunkIndex) && !pendingChunkSet.has(chunkIndex))
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
      (pendingChunkSet.size >= maxPendingPerTrack || (input.maxRequestChunks ?? directRequestBatchSize) <= 0)
        ? "pending-window-full"
        : "provider-has-no-requestable-chunks"
  };
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

export function useManualCacheDownloader(input: {
  enableManualTrackCaching: boolean;
  manualCacheTrackIds: string[];
  roomSnapshot: RoomSnapshot | null;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  peerId: string;
  connectedPeers: string[];
  dataMesh: DataMeshBridge | null;
  onRuntimeEvent?: (event: RoomRuntimeEvent) => void;
  onManualCachePlan?: (plan: ManualCacheTrackPlan) => void;
}) {
  const lastBootstrapKeyRef = useRef<string | null>(null);
  const lastBootstrapAttemptAtRef = useRef<number | null>(null);
  const recoverySinceAtRef = useRef<number | null>(null);
  const lastRecoveryAtRef = useRef<number | null>(null);
  const directPendingRef = useRef<Map<string, Map<number, number>>>(new Map());
  const providerUnavailableSinceRef = useRef<Map<string, number>>(new Map());
  const lastProviderRestartAtRef = useRef<Map<string, number>>(new Map());

  const schedulerAvailabilityByTrack = useMemo(
    () =>
      buildManualCacheSchedulerAvailability({
        availabilityByTrack: input.availabilityByTrack,
        manualCacheTrackIds: input.manualCacheTrackIds,
        roomSnapshot: input.roomSnapshot,
        localPeerId: input.peerId
      }),
    [input.availabilityByTrack, input.manualCacheTrackIds, input.peerId, input.roomSnapshot]
  );
  const availabilityProviderPeerIds = useMemo(
    () =>
      resolveManualCacheProviderPeerIds({
        manualCacheTrackIds: input.manualCacheTrackIds,
        availabilityByTrack: schedulerAvailabilityByTrack,
        localPeerId: input.peerId
      }),
    [input.manualCacheTrackIds, input.peerId, schedulerAvailabilityByTrack]
  );
  const uploaderPeerIds = useMemo(
    () =>
      resolveManualCacheUploaderPeerIds({
        manualCacheTrackIds: input.manualCacheTrackIds,
        roomSnapshot: input.roomSnapshot,
        localPeerId: input.peerId
      }),
    [input.manualCacheTrackIds, input.peerId, input.roomSnapshot]
  );
  const providerPeerIds = useMemo(
    () => mergePeerIds(uploaderPeerIds, availabilityProviderPeerIds),
    [availabilityProviderPeerIds, uploaderPeerIds]
  );
  const remotePeerIds = useMemo(
    () => mergePeerIds(providerPeerIds),
    [providerPeerIds]
  );

  useEffect(() => {
    if (!input.enableManualTrackCaching || providerPeerIds.length === 0 || !input.dataMesh) {
      lastBootstrapKeyRef.current = null;
      return;
    }

    const bootstrapKey = shouldForceManualCacheBootstrap({
      enableManualTrackCaching: input.enableManualTrackCaching,
      manualCacheTrackIds: input.manualCacheTrackIds,
      providerPeerIds,
      connectedPeerIds: input.connectedPeers,
      lastBootstrapKey: lastBootstrapKeyRef.current
    });
    if (!bootstrapKey) {
      return;
    }

    lastBootstrapKeyRef.current = bootstrapKey;
    lastBootstrapAttemptAtRef.current = Date.now();
    void input.dataMesh.syncPeers(providerPeerIds).catch((error) => {
      input.onRuntimeEvent?.({
        type: "diagnostic",
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: "manual-cache-provider-sync-failed",
        summary: `Failed to bootstrap manual cache providers: ${String(error)}`,
        level: "error"
      });
    });
  }, [
    input.connectedPeers,
    input.dataMesh,
    input.enableManualTrackCaching,
    input.manualCacheTrackIds,
    input.onRuntimeEvent,
    providerPeerIds
  ]);

  useEffect(() => {
    if (!input.dataMesh) {
      return;
    }

    const shouldRecover = shouldRecoverManualCacheDataPeers({
      enableManualTrackCaching: input.enableManualTrackCaching,
      manualCacheTrackIds: input.manualCacheTrackIds,
      remotePeerIds,
      connectedPeerIds: input.connectedPeers,
      availabilityByTrack: schedulerAvailabilityByTrack,
      localPeerId: input.peerId
    });

    if (!shouldRecover) {
      recoverySinceAtRef.current = null;
      lastRecoveryAtRef.current = null;
      return;
    }

    const now = Date.now();
    if (recoverySinceAtRef.current === null) {
      recoverySinceAtRef.current = now;
    }

    const recoveryMode = resolveManualCacheMeshRecoveryMode({
      shouldRecover,
      remotePeerIds,
      connectedPeerIds: input.connectedPeers,
      recoverySinceAt: recoverySinceAtRef.current,
      now
    });
    if (recoveryMode === "none") {
      return;
    }

    const cooldownMs = recoveryMode === "force-reconnect" ? 8_000 : 3_000;
    if (lastRecoveryAtRef.current !== null && now - lastRecoveryAtRef.current < cooldownMs) {
      return;
    }

    lastRecoveryAtRef.current = now;
    void input.dataMesh
      .syncPeers(providerPeerIds, recoveryMode === "force-reconnect" ? { forceReconnectDegraded: true } : undefined)
      .catch((error) => {
        input.onRuntimeEvent?.({
          type: "diagnostic",
          peerId: "system",
          channelKind: "system",
          direction: "local",
          event: "manual-cache-mesh-sync-failed",
          summary: `Failed to sync data peers for manual cache download: ${String(error)}`,
          level: "error"
        });
      });
  }, [
    input.connectedPeers,
    input.dataMesh,
    input.enableManualTrackCaching,
    input.manualCacheTrackIds,
    input.onRuntimeEvent,
    input.peerId,
    providerPeerIds,
    remotePeerIds,
    schedulerAvailabilityByTrack
  ]);

  useEffect(() => {
    const activeTrackIds = new Set(input.manualCacheTrackIds);
    for (const trackId of directPendingRef.current.keys()) {
      if (!activeTrackIds.has(trackId)) {
        directPendingRef.current.delete(trackId);
      }
    }

    if (input.manualCacheTrackIds.length === 0) {
      return;
    }

    let stopped = false;
    let inFlight = false;

    const requestMissingPieces = async () => {
      if (stopped || inFlight || !input.roomSnapshot?.room.id || !input.peerId || !input.dataMesh) {
        return;
      }

      inFlight = true;
      try {
        let connectedPeerIds = mergePeerIds(input.connectedPeers, input.dataMesh.getConnectedPeerIds());
        const now = Date.now();
        for (const providerPeerId of providerPeerIds) {
          if (connectedPeerIds.includes(providerPeerId)) {
            providerUnavailableSinceRef.current.delete(providerPeerId);
            continue;
          }

          if (!providerUnavailableSinceRef.current.has(providerPeerId)) {
            providerUnavailableSinceRef.current.set(providerPeerId, now);
          }
        }
        if (
          shouldRetryManualCacheProviderBootstrap({
            manualCacheTrackIds: input.manualCacheTrackIds,
            providerPeerIds,
            connectedPeerIds,
            lastBootstrapAttemptAt: lastBootstrapAttemptAtRef.current,
            now
          })
        ) {
          lastBootstrapAttemptAtRef.current = now;
          await input.dataMesh.syncPeers(providerPeerIds);
          connectedPeerIds = mergePeerIds(input.connectedPeers, input.dataMesh.getConnectedPeerIds());
        }
        for (const providerPeerId of providerPeerIds) {
          if (
            shouldRestartManualCacheProviderPeer({
              providerPeerId,
              connectedPeerIds,
              unavailableSinceAt:
                providerUnavailableSinceRef.current.get(providerPeerId) ?? null,
              lastRestartAt: lastProviderRestartAtRef.current.get(providerPeerId) ?? null,
              now
            })
          ) {
            lastProviderRestartAtRef.current.set(providerPeerId, now);
            await input.dataMesh.restartPeer(providerPeerId).catch((error) => {
              input.onRuntimeEvent?.({
                type: "diagnostic",
                peerId: providerPeerId,
                channelKind: "data",
                direction: "local",
                event: "manual-cache-provider-restart-failed",
                summary: `Failed to restart stalled manual cache provider ${providerPeerId}: ${String(error)}`,
                level: "error"
              });
            });
          }
        }

        for (const trackId of input.manualCacheTrackIds) {
          const track = input.roomSnapshot.tracks.find((entry) => entry.id === trackId) ?? null;
          if (!track) {
            input.onManualCachePlan?.(emptyManualCacheTrackPlan(trackId, "missing-track"));
            continue;
          }

          const cachedManifest =
            (await getTrackPieceManifestByFileHash(track.fileHash)) ??
            (await getTrackPieceManifest(trackId)) ??
            null;
          const localPieceIndexes = await getCachedPieceIndexes(trackId, input.peerId, {
            fileHash: track.fileHash,
            ownerKey: localCacheOwnerKey
          });
          const pendingForTrack = directPendingRef.current.get(trackId) ?? new Map<number, number>();
          for (const [chunkIndex, expiresAt] of pendingForTrack.entries()) {
            if (expiresAt <= now || localPieceIndexes.includes(chunkIndex)) {
              pendingForTrack.delete(chunkIndex);
            }
          }
          directPendingRef.current.set(trackId, pendingForTrack);

          const remainingTrackSlots = Math.max(0, maxPendingPerTrack - pendingForTrack.size);
          const shouldRefillPendingWindow =
            pendingForTrack.size === 0 || pendingForTrack.size <= pendingRefillLowWatermark;
          const plan = resolveManualCacheTrackPlan({
            track,
            roomId: input.roomSnapshot.room.id,
            localPeerId: input.peerId,
            availabilityByTrack: schedulerAvailabilityByTrack,
            connectedPeerIds,
            cachedManifest,
            localPieceIndexes,
            pendingChunkIndexes: [...pendingForTrack.keys()],
            maxRequestChunks: shouldRefillPendingWindow
              ? Math.min(directRequestBatchSize, remainingTrackSlots, maxPendingPerPeer)
              : 0
          });
          input.onManualCachePlan?.(plan);

          if (!plan.selectedProviderPeerId || plan.requestableChunks.length === 0 || !plan.manifest) {
            if (plan.blockedReason && plan.blockedReason !== "complete") {
              input.onRuntimeEvent?.({
                type: "diagnostic",
                peerId: "system",
                channelKind: "data",
                direction: "local",
                event: "manual-cache-blocked",
                summary: `缓存下载 ${trackId} 阻塞：${plan.blockedReason}`,
                recordEvent: false
              });
            }
            continue;
          }

          const didRequest = input.dataMesh.requestPieces(
            plan.selectedProviderPeerId,
            trackId,
            plan.requestableChunks,
            plan.manifest.totalChunks,
            directRequestTimeoutMs
          );
          if (!didRequest) {
            continue;
          }

          const expiresAt = Date.now() + directPendingTtlMs;
          for (const chunkIndex of plan.requestableChunks) {
            pendingForTrack.set(chunkIndex, expiresAt);
          }
          input.onRuntimeEvent?.({
            type: "diagnostic",
            peerId: plan.selectedProviderPeerId,
            channelKind: "data",
            direction: "sent",
            event: "manual-cache-request",
            summary: `缓存下载请求分片 ${trackId}#${plan.requestableChunks[0]}-${plan.requestableChunks[plan.requestableChunks.length - 1]}`,
            recordEvent: false
          });
        }
      } finally {
        inFlight = false;
      }
    };

    void requestMissingPieces();
    const timerId = window.setInterval(() => {
      void requestMissingPieces();
    }, directRequestIntervalMs);

    return () => {
      stopped = true;
      window.clearInterval(timerId);
    };
  }, [
    input.connectedPeers,
    input.dataMesh,
    input.manualCacheTrackIds,
    input.onManualCachePlan,
    input.onRuntimeEvent,
    input.peerId,
    input.roomSnapshot,
    schedulerAvailabilityByTrack
  ]);

  useEffect(() => {
    if (input.manualCacheTrackIds.length === 0) {
      return;
    }

    for (const trackId of input.manualCacheTrackIds) {
      const availability = schedulerAvailabilityByTrack[trackId] ?? {};
      const hasProviderWithChunks = Object.values(availability).some(
        (announcement) =>
          announcement.ownerPeerId !== input.peerId &&
          announcement.totalChunks > 0 &&
          announcement.availableChunks.length > 0
      );
      if (!hasProviderWithChunks) {
        input.onRuntimeEvent?.({
          type: "diagnostic",
          peerId: "system",
          channelKind: "data",
          direction: "local",
          event: "manual-cache-provider-unavailable",
          summary: `缓存下载 ${trackId} 暂无可请求分片的在线提供者`,
          recordEvent: false
        });
      }
    }
  }, [
    input.manualCacheTrackIds,
    input.onRuntimeEvent,
    input.peerId,
    schedulerAvailabilityByTrack
  ]);

  const clearPendingPiece = (trackId: string, chunkIndex: number) => {
    directPendingRef.current.get(trackId)?.delete(chunkIndex);
  };

  return {
    availabilityProviderPeerIds,
    uploaderPeerIds,
    providerPeerIds,
    remotePeerIds,
    schedulerAvailabilityByTrack,
    clearPendingPiece
  };
}
