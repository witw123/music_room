"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type { RoomSnapshot, TrackAvailabilityAnnouncement } from "@music-room/shared";
import {
  getCachedPieceIndexes,
  getTrackPieceManifest,
  getTrackPieceManifestByFileHash,
  localCacheOwnerKey
} from "@/lib/indexeddb";
import type { DataMeshBridge, RoomRuntimeEvent } from "./room-runtime-types";
import {
  buildManualCacheRequestFailureEvent,
  resolveManualCacheMeshRecoveryMode,
  shouldForceManualCacheBootstrap,
  shouldRecoverManualCacheDataPeers,
  shouldRecordManualCacheBootstrapAttempt,
  shouldRestartManualCacheProviderPeer,
  shouldRetryManualCacheProviderBootstrap,
  type ActivePlaybackCacheWindow,
  type ManualCacheTrackPlan
} from "./manual-cache-download-queue";
import { mergePeerIds } from "./manual-cache-download-progress";
import { planManualCacheDirectRequests } from "./manual-cache-piece-fetch";

const directRequestIntervalMs = 750;

type ManualCacheDownloadEffectsInput = {
  activePlaybackPendingKey: string | null;
  activePlaybackPendingKeyRef: MutableRefObject<string | null>;
  activePlaybackWindowRef: MutableRefObject<ActivePlaybackCacheWindow | null>;
  connectedPeers: string[];
  dataMesh: DataMeshBridge | null;
  directPendingRef: MutableRefObject<Map<string, Map<number, number>>>;
  enableManualTrackCaching: boolean;
  lastBootstrapAttemptAtRef: MutableRefObject<number | null>;
  lastBootstrapKeyRef: MutableRefObject<string | null>;
  lastProviderRestartAtRef: MutableRefObject<Map<string, number>>;
  lastRecoveryAtRef: MutableRefObject<number | null>;
  manualCacheTrackIds: string[];
  onManualCachePlan?: (plan: ManualCacheTrackPlan) => void;
  onRuntimeEvent?: (event: RoomRuntimeEvent) => void;
  pauseDirectRequests?: boolean;
  peerId: string;
  providerPeerIds: string[];
  providerUnavailableSinceRef: MutableRefObject<Map<string, number>>;
  recoverySinceAtRef: MutableRefObject<number | null>;
  remotePeerIds: string[];
  roomSnapshot: RoomSnapshot | null;
  schedulerAvailabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
};

export function reconcileManualCacheDirectPendingTracks(input: {
  pendingByTrack: Map<string, Map<number, number>>;
  manualCacheTrackIds: string[];
  previousActivePlaybackPendingKey: string | null;
  nextActivePlaybackPendingKey: string | null;
  previousActivePlaybackTrackId: string | null;
  nextActivePlaybackTrackId: string | null;
}) {
  const activeTrackIds = new Set(input.manualCacheTrackIds);
  for (const trackId of input.pendingByTrack.keys()) {
    if (!activeTrackIds.has(trackId)) {
      input.pendingByTrack.delete(trackId);
    }
  }

  if (input.previousActivePlaybackPendingKey !== input.nextActivePlaybackPendingKey) {
    // Only clear pending when the active playback TRACK changes, not when
    // just the revision or epoch changes on the same track. Pending entries
    // for the current track are still valid — the request ordering already
    // prioritises chunks near the current playback position, and stale
    // entries naturally expire via their TTL.
    if (
      input.previousActivePlaybackTrackId !== input.nextActivePlaybackTrackId
    ) {
      const trackIdToClear =
        input.previousActivePlaybackTrackId ?? input.nextActivePlaybackTrackId;
      if (trackIdToClear) {
        input.pendingByTrack.delete(trackIdToClear);
      }
    }
  }

  return {
    nextActivePlaybackPendingKey: input.nextActivePlaybackPendingKey,
    nextActivePlaybackTrackId: input.nextActivePlaybackTrackId
  };
}

export function useManualCacheDownloadEffects({
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
  recoverySinceAtRef,
  remotePeerIds,
  roomSnapshot,
  schedulerAvailabilityByTrack
}: ManualCacheDownloadEffectsInput) {
  const triggerDirectRequestRef = useRef<() => void>(() => {});

  const directRequestLoopInputRef = useRef({
    activePlaybackPendingKey,
    connectedPeers,
    dataMesh,
    enableManualTrackCaching,
    manualCacheTrackIds,
    onManualCachePlan,
    onRuntimeEvent,
    pauseDirectRequests,
    peerId,
    providerPeerIds,
    roomSnapshot,
    schedulerAvailabilityByTrack
  });
  const activePlaybackTrackIdRef = useRef<string | null>(
    activePlaybackWindowRef.current?.trackId ?? null
  );
  directRequestLoopInputRef.current = {
    activePlaybackPendingKey,
    connectedPeers,
    dataMesh,
    enableManualTrackCaching,
    manualCacheTrackIds,
    onManualCachePlan,
    onRuntimeEvent,
    pauseDirectRequests,
    peerId,
    providerPeerIds,
    roomSnapshot,
    schedulerAvailabilityByTrack
  };

  useEffect(() => {
    if (
      pauseDirectRequests ||
      !enableManualTrackCaching ||
      providerPeerIds.length === 0 ||
      !dataMesh
    ) {
      lastBootstrapKeyRef.current = null;
      return;
    }

    const bootstrapKey = shouldForceManualCacheBootstrap({
      enableManualTrackCaching,
      manualCacheTrackIds,
      providerPeerIds,
      connectedPeerIds: connectedPeers,
      lastBootstrapKey: lastBootstrapKeyRef.current
    });
    if (!bootstrapKey) {
      return;
    }

    void dataMesh
      .syncPeers(providerPeerIds)
      .then((syncStarted) => {
        if (
          shouldRecordManualCacheBootstrapAttempt({
            syncStarted,
            previousBootstrapKey: lastBootstrapKeyRef.current,
            nextBootstrapKey: bootstrapKey
          })
        ) {
          lastBootstrapKeyRef.current = bootstrapKey;
          lastBootstrapAttemptAtRef.current = Date.now();
          // Data channel established — fire an immediate download
          // request instead of waiting for the next interval tick.
          triggerDirectRequestRef.current();
          return;
        }

        if (!syncStarted) {
          onRuntimeEvent?.({
            type: "diagnostic",
            peerId: "system",
            channelKind: "system",
            direction: "local",
            event: "manual-cache-mesh-not-ready",
            summary: "缓存下载等待 Data mesh 初始化",
            level: "warning",
            recordEvent: false
          });
        }
      })
      .catch((error) => {
        onRuntimeEvent?.({
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
    connectedPeers,
    dataMesh,
    enableManualTrackCaching,
    lastBootstrapAttemptAtRef,
    lastBootstrapKeyRef,
    manualCacheTrackIds,
    onRuntimeEvent,
    pauseDirectRequests,
    providerPeerIds
  ]);

  useEffect(() => {
    if (pauseDirectRequests || !dataMesh) {
      recoverySinceAtRef.current = null;
      lastRecoveryAtRef.current = null;
      return;
    }

    const shouldRecover = shouldRecoverManualCacheDataPeers({
      enableManualTrackCaching,
      manualCacheTrackIds,
      remotePeerIds,
      connectedPeerIds: connectedPeers,
      availabilityByTrack: schedulerAvailabilityByTrack,
      localPeerId: peerId
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
      connectedPeerIds: connectedPeers,
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
    void dataMesh
      .syncPeers(providerPeerIds, recoveryMode === "force-reconnect" ? { forceReconnectDegraded: true } : undefined)
      .then((syncStarted) => {
        if (syncStarted) {
          // Connection recovered — fire an immediate download request.
          triggerDirectRequestRef.current();
          return;
        }
        if (!syncStarted) {
          onRuntimeEvent?.({
            type: "diagnostic",
            peerId: "system",
            channelKind: "system",
            direction: "local",
            event: "manual-cache-mesh-not-ready",
            summary: "缓存下载恢复等待 Data mesh 初始化",
            level: "warning",
            recordEvent: false
          });
        }
      })
      .catch((error) => {
        onRuntimeEvent?.({
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
    connectedPeers,
    dataMesh,
    enableManualTrackCaching,
    lastRecoveryAtRef,
    manualCacheTrackIds,
    onRuntimeEvent,
    peerId,
    pauseDirectRequests,
    providerPeerIds,
    recoverySinceAtRef,
    remotePeerIds,
    schedulerAvailabilityByTrack
  ]);

  useEffect(() => {
    let stopped = false;
    let inFlight = false;

    const requestMissingPieces = async () => {
      if (stopped || inFlight) {
        return;
      }

      const latest = directRequestLoopInputRef.current;
      const pendingReconcileResult = reconcileManualCacheDirectPendingTracks({
        pendingByTrack: directPendingRef.current,
        manualCacheTrackIds: latest.manualCacheTrackIds,
        previousActivePlaybackPendingKey: activePlaybackPendingKeyRef.current,
        nextActivePlaybackPendingKey: latest.activePlaybackPendingKey,
        previousActivePlaybackTrackId: activePlaybackTrackIdRef.current,
        nextActivePlaybackTrackId: activePlaybackWindowRef.current?.trackId ?? null
      });
      activePlaybackPendingKeyRef.current =
        pendingReconcileResult.nextActivePlaybackPendingKey;
      activePlaybackTrackIdRef.current = pendingReconcileResult.nextActivePlaybackTrackId;

      if (latest.pauseDirectRequests) {
        directPendingRef.current.clear();
        return;
      }

      if (
        latest.manualCacheTrackIds.length === 0 ||
        !latest.enableManualTrackCaching ||
        !latest.roomSnapshot?.room.id ||
        !latest.peerId ||
        !latest.dataMesh
      ) {
        return;
      }

      const dataMesh = latest.dataMesh;
      inFlight = true;
      try {
        let connectedPeerIds = mergePeerIds(
          latest.connectedPeers,
          dataMesh.getConnectedPeerIds()
        );
        const now = Date.now();
        for (const providerPeerId of latest.providerPeerIds) {
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
            manualCacheTrackIds: latest.manualCacheTrackIds,
            providerPeerIds: latest.providerPeerIds,
            connectedPeerIds,
            lastBootstrapAttemptAt: lastBootstrapAttemptAtRef.current,
            now
          })
        ) {
          lastBootstrapAttemptAtRef.current = now;
          const syncStarted = await dataMesh.syncPeers(latest.providerPeerIds);
          if (!syncStarted) {
            latest.onRuntimeEvent?.({
              type: "diagnostic",
              peerId: "system",
              channelKind: "system",
              direction: "local",
              event: "manual-cache-mesh-not-ready",
              summary: "缓存下载请求前等待 Data mesh 初始化",
              level: "warning",
              recordEvent: false
            });
          }
          connectedPeerIds = mergePeerIds(
            latest.connectedPeers,
            dataMesh.getConnectedPeerIds()
          );
        }
        for (const providerPeerId of latest.providerPeerIds) {
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
            await dataMesh.restartPeer(providerPeerId).catch((error) => {
              latest.onRuntimeEvent?.({
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

        const requestResults = await planManualCacheDirectRequests({
          roomSnapshot: latest.roomSnapshot,
          manualCacheTrackIds: latest.manualCacheTrackIds,
          peerId: latest.peerId,
          providerPeerIds: latest.providerPeerIds,
          connectedPeerIds,
          availabilityByTrack: latest.schedulerAvailabilityByTrack,
          pendingByTrack: directPendingRef.current,
          activePlaybackWindow: activePlaybackWindowRef.current,
          now,
          getCachedManifest: async (track) =>
            (await getTrackPieceManifestByFileHash(track.fileHash)) ??
            (await getTrackPieceManifest(track.id)) ??
            null,
          getLocalPieceIndexes: (track, _cachedManifest, manifestHint) =>
            getCachedPieceIndexes(track.id, latest.peerId, {
              fileHash: track.fileHash,
              ownerKey: localCacheOwnerKey,
              chunkSize: manifestHint?.chunkSize
            }),
          requestPieces: (providerPeerId, trackId, chunkIndexes, totalChunks, timeoutMs) =>
            dataMesh.requestPieces(
              providerPeerId,
              trackId,
              chunkIndexes,
              totalChunks,
              timeoutMs
            )
        });

        for (const { plan, didRequest } of requestResults) {
          latest.onManualCachePlan?.(plan);

          if (didRequest === false && plan.selectedProviderPeerId) {
            latest.onRuntimeEvent?.(
              buildManualCacheRequestFailureEvent({
                providerPeerId: plan.selectedProviderPeerId,
                trackId: plan.trackId,
                requestableChunks: plan.requestableChunks
              })
            );
            continue;
          }

          if (didRequest === true && plan.selectedProviderPeerId) {
            latest.onRuntimeEvent?.({
              type: "diagnostic",
              peerId: plan.selectedProviderPeerId,
              channelKind: "data",
              direction: "sent",
              event: "manual-cache-request",
              summary: `缓存下载请求分片 ${plan.trackId}#${plan.requestableChunks[0]}-${plan.requestableChunks[plan.requestableChunks.length - 1]}`
            });
            continue;
          }

          if (plan.blockedReason && plan.blockedReason !== "complete") {
            latest.onRuntimeEvent?.({
              type: "diagnostic",
              peerId: "system",
              channelKind: "data",
              direction: "local",
              event: "manual-cache-blocked",
              summary: `缓存下载 ${plan.trackId} 阻塞：${plan.blockedReason}`,
              recordEvent: false
            });
          }
        }
      } finally {
        inFlight = false;
      }
    };

    triggerDirectRequestRef.current = () => {
      void requestMissingPieces();
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
    activePlaybackPendingKeyRef,
    activePlaybackWindowRef,
    directRequestLoopInputRef,
    directPendingRef,
    lastBootstrapAttemptAtRef,
    lastProviderRestartAtRef,
    providerUnavailableSinceRef
  ]);

  useEffect(() => {
    if (manualCacheTrackIds.length === 0) {
      return;
    }

    for (const trackId of manualCacheTrackIds) {
      const availability = schedulerAvailabilityByTrack[trackId] ?? {};
      const hasProviderWithChunks = Object.values(availability).some(
        (announcement) =>
          announcement.ownerPeerId !== peerId &&
          announcement.totalChunks > 0 &&
          announcement.availableChunks.length > 0
      );
      if (!hasProviderWithChunks) {
        onRuntimeEvent?.({
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
    manualCacheTrackIds,
    onRuntimeEvent,
    peerId,
    schedulerAvailabilityByTrack
  ]);
}
