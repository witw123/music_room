"use client";

import { useEffect, type MutableRefObject } from "react";
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
    const activeTrackIds = new Set(manualCacheTrackIds);
    for (const trackId of directPendingRef.current.keys()) {
      if (!activeTrackIds.has(trackId)) {
        directPendingRef.current.delete(trackId);
      }
    }

    if (activePlaybackPendingKeyRef.current !== activePlaybackPendingKey) {
      const activeTrackId = activePlaybackWindowRef.current?.trackId;
      if (activeTrackId) {
        directPendingRef.current.delete(activeTrackId);
      }
      activePlaybackPendingKeyRef.current = activePlaybackPendingKey;
    }

    if (pauseDirectRequests) {
      directPendingRef.current.clear();
      return;
    }

    if (manualCacheTrackIds.length === 0) {
      return;
    }

    let stopped = false;
    let inFlight = false;

    const requestMissingPieces = async () => {
      if (stopped || inFlight || !roomSnapshot?.room.id || !peerId || !dataMesh) {
        return;
      }

      inFlight = true;
      try {
        let connectedPeerIds = mergePeerIds(connectedPeers, dataMesh.getConnectedPeerIds());
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
            manualCacheTrackIds,
            providerPeerIds,
            connectedPeerIds,
            lastBootstrapAttemptAt: lastBootstrapAttemptAtRef.current,
            now
          })
        ) {
          lastBootstrapAttemptAtRef.current = now;
          const syncStarted = await dataMesh.syncPeers(providerPeerIds);
          if (!syncStarted) {
            onRuntimeEvent?.({
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
          connectedPeerIds = mergePeerIds(connectedPeers, dataMesh.getConnectedPeerIds());
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
            await dataMesh.restartPeer(providerPeerId).catch((error) => {
              onRuntimeEvent?.({
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
          roomSnapshot,
          manualCacheTrackIds,
          peerId,
          providerPeerIds,
          connectedPeerIds,
          availabilityByTrack: schedulerAvailabilityByTrack,
          pendingByTrack: directPendingRef.current,
          activePlaybackWindow: activePlaybackWindowRef.current,
          now,
          getCachedManifest: async (track) =>
            (await getTrackPieceManifestByFileHash(track.fileHash)) ??
            (await getTrackPieceManifest(track.id)) ??
            null,
          getLocalPieceIndexes: (track, _cachedManifest, manifestHint) =>
            getCachedPieceIndexes(track.id, peerId, {
              fileHash: track.fileHash,
              ownerKey: localCacheOwnerKey,
              chunkSize: manifestHint?.chunkSize
            }),
          requestPieces: (providerPeerId, trackId, chunkIndexes, totalChunks, timeoutMs) =>
            dataMesh.requestPieces(providerPeerId, trackId, chunkIndexes, totalChunks, timeoutMs)
        });

        for (const { plan, didRequest } of requestResults) {
          onManualCachePlan?.(plan);

          if (didRequest === false && plan.selectedProviderPeerId) {
            onRuntimeEvent?.(
              buildManualCacheRequestFailureEvent({
                providerPeerId: plan.selectedProviderPeerId,
                trackId: plan.trackId,
                requestableChunks: plan.requestableChunks
              })
            );
            continue;
          }

          if (didRequest === true && plan.selectedProviderPeerId) {
            onRuntimeEvent?.({
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
            onRuntimeEvent?.({
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

    void requestMissingPieces();
    const timerId = window.setInterval(() => {
      void requestMissingPieces();
    }, directRequestIntervalMs);

    return () => {
      stopped = true;
      window.clearInterval(timerId);
    };
  }, [
    activePlaybackPendingKey,
    activePlaybackPendingKeyRef,
    activePlaybackWindowRef,
    connectedPeers,
    dataMesh,
    directPendingRef,
    lastBootstrapAttemptAtRef,
    lastProviderRestartAtRef,
    manualCacheTrackIds,
    onManualCachePlan,
    onRuntimeEvent,
    pauseDirectRequests,
    peerId,
    providerPeerIds,
    providerUnavailableSinceRef,
    roomSnapshot,
    schedulerAvailabilityByTrack
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
