"use client";

import { useMemo, useRef } from "react";
import type { RoomSnapshot, TrackAvailabilityAnnouncement } from "@music-room/shared";
import type { DataMeshBridge, RoomRuntimeEvent } from "./room-runtime-types";
import {
  getActivePlaybackPendingKey,
  type ActiveAssetTransferWindow,
  type ManualCacheTrackPlan
} from "./manual-cache-download-queue";
import {
  buildManualCacheSchedulerAvailability,
  mergePeerIds,
  resolveManualCacheProviderPeerIds,
  resolveManualCacheUploaderPeerIds
} from "./manual-cache-download-progress";
import { useManualCacheDownloadEffects } from "./manual-cache-download-effects";
import type {
  ManualCachePeerRequestWindow,
  ManualCacheRequestPriority
} from "./manual-cache-piece-fetch";

export {
  buildManualCacheRequestFailureEvent,
  getActivePlaybackPendingKey,
  resolveManualCacheMeshRecoveryMode,
  resolveManualCacheTrackPlan,
  resolveManualCacheTrackProviderPeerId,
  shouldForceManualCacheBootstrap,
  shouldRecoverManualCacheDataPeers,
  shouldRecordManualCacheBootstrapAttempt,
  shouldRestartManualCacheProviderPeer,
  shouldRetryManualCacheProviderBootstrap
} from "./manual-cache-download-queue";
export type {
  ActiveAssetTransferWindow,
  ManualCacheBlockedReason,
  ManualCacheManifestSource,
  ManualCacheTrackPlan
} from "./manual-cache-download-queue";
export { planManualCacheDirectRequests } from "./manual-cache-piece-fetch";
export type {
  ManualCacheDirectRequestResult,
  ManualCachePeerRequestWindow,
  ManualCacheRequestPriority
} from "./manual-cache-piece-fetch";
export { reconcileManualCacheDirectPendingTracks } from "./manual-cache-download-effects";
export {
  buildManualCacheSchedulerAvailability,
  buildManualCacheSchedulerAvailabilityFromParts,
  mergePeerIds,
  resolveManualCacheProviderPeerIds,
  resolveManualCacheUploaderPeerIds
} from "./manual-cache-download-progress";

export function useManualCacheDownloader(input: {
  enableManualTrackCaching: boolean;
  manualCacheTrackIds: string[];
  roomSnapshot: RoomSnapshot | null;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  peerId: string;
  connectedPeers: string[];
  dataMesh: DataMeshBridge | null;
  pauseDirectRequests?: boolean;
  activePlaybackWindow?: ActiveAssetTransferWindow | null;
  onRuntimeEvent?: (event: RoomRuntimeEvent) => void;
  onManualCachePlan?: (plan: ManualCacheTrackPlan) => void;
  resolvePeerRequestWindow?: (
    providerPeerId: string,
    trackId: string,
    priority: ManualCacheRequestPriority
  ) => ManualCachePeerRequestWindow | null | undefined;
}) {
  const {
    activePlaybackWindow,
    availabilityByTrack,
    connectedPeers,
    dataMesh,
    enableManualTrackCaching,
    manualCacheTrackIds,
    onManualCachePlan,
    onRuntimeEvent,
    pauseDirectRequests,
    peerId,
    resolvePeerRequestWindow,
    roomSnapshot
  } = input;
  const lastBootstrapKeyRef = useRef<string | null>(null);
  const lastBootstrapAttemptAtRef = useRef<number | null>(null);
  const recoverySinceAtRef = useRef<number | null>(null);
  const lastRecoveryAtRef = useRef<number | null>(null);
  const directPendingRef = useRef<Map<string, Map<number, number>>>(new Map());
  const triggerDirectRequestRef = useRef<() => void>(() => {});
  const activePlaybackPendingKeyRef = useRef<string | null>(null);
  const activePlaybackWindowRef = useRef<ActiveAssetTransferWindow | null>(
    activePlaybackWindow ?? null
  );
  const providerUnavailableSinceRef = useRef<Map<string, number>>(new Map());
  const lastProviderRestartAtRef = useRef<Map<string, number>>(new Map());
  const unavailableProviderChunksRef = useRef<Map<string, number>>(new Map());
  activePlaybackWindowRef.current = activePlaybackWindow ?? null;

  const schedulerAvailabilityByTrack = useMemo(
    () =>
      buildManualCacheSchedulerAvailability({
        availabilityByTrack,
        manualCacheTrackIds,
        roomSnapshot,
        localPeerId: peerId
      }),
    [availabilityByTrack, manualCacheTrackIds, peerId, roomSnapshot]
  );
  const availabilityProviderPeerIds = useMemo(
    () =>
      resolveManualCacheProviderPeerIds({
        manualCacheTrackIds,
        availabilityByTrack: schedulerAvailabilityByTrack,
        localPeerId: peerId
      }),
    [manualCacheTrackIds, peerId, schedulerAvailabilityByTrack]
  );
  const uploaderPeerIds = useMemo(
    () =>
      resolveManualCacheUploaderPeerIds({
        manualCacheTrackIds,
        roomSnapshot,
        localPeerId: peerId
      }),
    [manualCacheTrackIds, peerId, roomSnapshot]
  );
  const providerPeerIds = useMemo(
    () => mergePeerIds(uploaderPeerIds, availabilityProviderPeerIds),
    [availabilityProviderPeerIds, uploaderPeerIds]
  );
  const remotePeerIds = useMemo(
    () => mergePeerIds(providerPeerIds),
    [providerPeerIds]
  );
  const activePlaybackPendingKey = getActivePlaybackPendingKey(activePlaybackWindow);

  useManualCacheDownloadEffects({
    activePlaybackPendingKey,
    activePlaybackPendingKeyRef,
    activePlaybackWindowRef,
    connectedPeers,
    dataMesh,
    directPendingRef,
    enableManualTrackCaching,
    lastBootstrapAttemptAtRef,
    lastBootstrapKeyRef,
    lastProviderRestartAtRef,
    lastRecoveryAtRef,
    manualCacheTrackIds,
    onManualCachePlan,
    onRuntimeEvent,
    pauseDirectRequests,
    peerId,
    providerPeerIds,
    providerUnavailableSinceRef,
    resolvePeerRequestWindow,
    recoverySinceAtRef,
    remotePeerIds,
    roomSnapshot,
    schedulerAvailabilityByTrack,
    triggerDirectRequestRef,
    unavailableProviderChunksRef
  });
  const clearPendingPiece = (trackId: string, chunkIndex: number) => {
    directPendingRef.current.get(trackId)?.delete(chunkIndex);
    queueMicrotask(() => triggerDirectRequestRef.current());
  };
  const deferPendingPiece = (
    trackId: string,
    chunkIndex: number,
    options: { delayMs: number; providerPeerId?: string }
  ) => {
    const pendingForTrack = directPendingRef.current.get(trackId) ?? new Map<number, number>();
    pendingForTrack.set(chunkIndex, Date.now() + options.delayMs);
    directPendingRef.current.set(trackId, pendingForTrack);
    if (options.providerPeerId) {
      unavailableProviderChunksRef.current.set(
        `${options.providerPeerId}\u0000${trackId}\u0000${chunkIndex}`,
        Date.now() + 30_000
      );
    }
    queueMicrotask(() => triggerDirectRequestRef.current());
  };

  const clearPendingPieces = () => {
    directPendingRef.current.clear();
    unavailableProviderChunksRef.current.clear();
    queueMicrotask(() => triggerDirectRequestRef.current());
  };

  return {
    availabilityProviderPeerIds,
    uploaderPeerIds,
    providerPeerIds,
    remotePeerIds,
    schedulerAvailabilityByTrack,
    clearPendingPiece,
    deferPendingPiece,
    clearPendingPieces
  };
}
