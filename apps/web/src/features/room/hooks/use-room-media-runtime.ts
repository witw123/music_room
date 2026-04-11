"use client";

import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction
} from "react";
import type { RoomMediaClockPayload, RoomSnapshot } from "@music-room/shared";
import type { ProgressivePlaybackSource } from "@/features/playback/progressive-playback";
import { toUserFacingError } from "@/lib/music-room-ui";
import {
  captureAudioStream,
  getCapturedAudioStreamMode
} from "@/features/upload/audio-utils";
import {
  hasUsableHostMediaStreamTrack,
  getHostMediaStreamTrackState,
  isAudioElementEffectivelyPlaying,
  isHostRelayAudioReadyForCapture,
  resolveHostCaptureRefresh,
  shouldDeferHostMediaStreamSync
} from "@/features/playback/host-media-sync";
import { roomAudioOutput } from "@/features/playback/room-audio-output";
import { shouldForceSourceOwnerLocalPlayback } from "@/features/playback/progressive-source-controller";
import {
  RoomMediaMesh,
  resolvePreferredIceTransportPolicy
} from "@/features/p2p";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import {
  resolveHostPublishSource,
  type HostPublishReadiness,
  type HostPublishSourceTarget,
  type HostPublishTrackKind,
  type ResolvedPublishElement,
  type ResolvedPublishStreamKind
} from "@/features/room/host-relay-audio";

const listenerBootstrapGraceMs = 1_800;
const hostCaptureHealthCheckIntervalMs = 2_000;
const hostCaptureRefreshCooldownMs = 1_200;
const hostMediaSyncRetryDelayMs = 75;
const steadyRoomMediaClockEmitIntervalMs = 120;
const recoveryRoomMediaClockEmitIntervalMs = 60;

type MediaTransportState = "idle" | "prewarming" | "connected" | "publishing" | "failed";
type HostPublishedTrackKind = HostPublishTrackKind | "none";
export type HostPublishStage = "idle" | "waiting-source-audio" | "capture-ready" | "published";

export function shouldManagePublishedMediaTransport(input: {
  roomId: string | null | undefined;
  peerId: string | null | undefined;
  isCurrentSourceOwner: boolean;
}) {
  return !!input.roomId && !!input.peerId && input.isCurrentSourceOwner;
}

export function shouldForceRemoteAudioElementRebind(input: {
  incomingStream: MediaStream | null;
  boundStream: MediaStream | null;
  currentGeneration: string | null;
  boundGeneration: string | null;
}) {
  return (
    !!input.incomingStream &&
    !!input.boundStream &&
    input.incomingStream === input.boundStream &&
    !!input.currentGeneration &&
    input.boundGeneration !== input.currentGeneration
  );
}

export function shouldKickRemotePlaybackFromAudioEvent(input: {
  eventName:
    | "playing"
    | "waiting"
    | "loadedmetadata"
    | "canplay"
    | "pause"
    | "stalled"
    | "ended"
    | "emptied"
    | "error";
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  activePlaybackSource: ProgressivePlaybackSource;
  isCurrentSourceOwner: boolean;
  traceKey: string | null;
  hasSrcObject: boolean;
  remoteAudioPaused: boolean | null;
  currentGeneration: string | null;
  playingGeneration: string | null;
}) {
  if (
    input.isCurrentSourceOwner ||
    input.activePlaybackSource !== "remote-stream" ||
    input.playbackStatus !== "playing" ||
    !input.traceKey ||
    !input.currentGeneration ||
    !input.hasSrcObject
  ) {
    return false;
  }

  switch (input.eventName) {
    case "playing":
    case "waiting":
      return false;
    case "loadedmetadata":
    case "canplay":
      return input.remoteAudioPaused !== false;
    case "pause":
      return (
        input.remoteAudioPaused !== false ||
        input.playingGeneration !== input.currentGeneration
      );
    case "stalled":
    case "ended":
    case "emptied":
    case "error":
      return true;
    default:
      return false;
  }
}

function resolveRoomMediaClockEmitIntervalMs(input: {
  playbackStatus: RoomSnapshot["room"]["playback"]["status"];
  sourceStartState: "idle" | "awaiting-unlock" | "starting" | "live" | "failed";
  relayPlayoutState: "playing" | "buffering" | "paused" | null;
}) {
  if (input.playbackStatus !== "playing" || input.sourceStartState !== "live") {
    return recoveryRoomMediaClockEmitIntervalMs;
  }

  return input.relayPlayoutState === "buffering"
    ? recoveryRoomMediaClockEmitIntervalMs
    : steadyRoomMediaClockEmitIntervalMs;
}

export function createRoomMediaMeshRuntime(input: {
  roomId: string;
  peerId: string;
  emitPeerSignal: (payload: any) => boolean | void;
  iceServers: RTCIceServer[];
  remoteAudioRef: RefObject<HTMLAudioElement | null>;
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  mediaMeshRef: MutableRefObject<RoomMediaMesh | null>;
  listenerMediaLifecycleRef: MutableRefObject<any>;
  armListenerMediaRecoveryRef: MutableRefObject<(generation?: string | null) => void>;
  scheduleRemotePlaybackRetryRef: MutableRefObject<
    (attempt?: number, generation?: string | null) => void
  >;
  mediaTransportEpochRef: MutableRefObject<number>;
  connectionSupervisorStatesRef: MutableRefObject<Map<string, any>>;
  updateConnectionSupervisorSignalState: (input: any) => any;
  withResolvedTransportHealth: (snapshot: any) => any;
  withSupervisorDiagnosticPatch: (snapshot: any, supervisorState: any) => any;
  recordPeerDiagnosticRef: MutableRefObject<(event: any) => void>;
  updateRemoteMediaDiagnostic: (
    summary: string,
    update?: (snapshot: any) => any,
    options?: { event?: string; recordEvent?: boolean; level?: "info" | "warning" | "error" }
  ) => void;
  getRemoteMediaTraceContext: (remotePeerId?: string | null) => any;
  getRemoteAudioDiagnostics: () => any;
  resetRemoteAudioElement: (stream: MediaStream | null, options?: any) => void;
  resolveMediaDiagnosticPeerId: (input: {
    remotePeerId: string;
    connectedPeerIds: string[];
    currentSourcePeerId: string | null;
  }) => string;
  resolveSoftRecoveryMediaState: (state: any) => any;
  setMediaConnectedPeers: Dispatch<SetStateAction<string[]>>;
  setMediaConnectionState: Dispatch<SetStateAction<any>>;
  updateMediaTransportStatsRef: MutableRefObject<(input: { peerId: string; sample: any }) => void>;
  isCurrentSourceOwner: boolean;
  enableTrackCaching: boolean;
  isPageVisible: boolean;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  currentTrackId: string | null | undefined;
  activePlaybackSource: ProgressivePlaybackSource;
  bufferHealth: "healthy" | "low" | "critical";
}) {
  const mediaMesh = new RoomMediaMesh(
    input.roomId,
    input.peerId,
    input.emitPeerSignal,
    input.iceServers,
    {
      onPeerRuntimeState: ({
        peerId: remotePeerId,
        transportEpoch,
        negotiationRole,
        publishGeneration,
        attachedTrackId,
        negotiatedTrackId,
        makingOffer,
        signalingState,
        pendingRestart,
        ignoreOffer,
        listenerAwaitingPublisherOffer,
        lastIgnoredOfferReason
      }) => {
        input.recordPeerDiagnosticRef.current({
          peerId: remotePeerId,
          channelKind: "media",
          direction: "local",
          event: "peer-runtime-state",
          summary: `媒体协商状态：${signalingState}${makingOffer ? " · making-offer" : ""}`,
          recordEvent: false,
          update: (snapshot: any) => ({
            ...snapshot,
            remoteTrackStatus: {
              ...snapshot.remoteTrackStatus,
              publishGeneration,
              attachedTrackId,
              negotiatedTrackId,
              makingOffer,
              signalingState
            },
            progressivePlaybackStatus: {
              ...(
                snapshot.progressivePlaybackStatus ??
                createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
              ),
              transportEpoch,
              mediaNegotiationRole: negotiationRole,
              listenerAwaitingPublisherOffer,
              lastIgnoredOfferReason,
              publishGeneration,
              attachedTrackId,
              negotiatedTrackId,
              makingOffer,
              signalingState
            },
            lastError: ignoreOffer
              ? `媒体 offer 已被忽略：${lastIgnoredOfferReason}`
              : listenerAwaitingPublisherOffer
                ? "等待房主重新发起音频协商"
                : pendingRestart
                  ? "媒体协商等待当前轮完成后重启"
                  : snapshot.lastError
          })
        });
        if (input.isCurrentSourceOwner) {
          input.recordPeerDiagnosticRef.current({
            peerId: "system",
            channelKind: "system",
            direction: "local",
            event: "host-media-publish-state",
            summary: `房主媒体发布代次 ${publishGeneration}`,
            recordEvent: false,
            update: (snapshot: any) => ({
              ...snapshot,
              progressivePlaybackStatus: {
                ...(
                  snapshot.progressivePlaybackStatus ??
                  createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
                ),
                transportEpoch,
                mediaNegotiationRole: negotiationRole,
                listenerAwaitingPublisherOffer,
                lastIgnoredOfferReason,
                publishGeneration,
                attachedTrackId,
                negotiatedTrackId,
                makingOffer,
                signalingState
              }
            })
          });
          return;
        }

        input.updateRemoteMediaDiagnostic(
          `成员端媒体协商状态：${signalingState}`,
          (snapshot) => ({
            ...snapshot,
            remoteTrackStatus: {
              ...snapshot.remoteTrackStatus,
              ...input.getRemoteMediaTraceContext(remotePeerId),
              publishGeneration,
              attachedTrackId,
              negotiatedTrackId,
              makingOffer,
              signalingState,
              listenerAwaitingPublisherOffer,
              currentGeneration: input.listenerMediaLifecycleRef.current.currentGeneration,
              boundGeneration: input.listenerMediaLifecycleRef.current.boundGeneration,
              playingGeneration: input.listenerMediaLifecycleRef.current.playingGeneration,
              recoveryStage: input.listenerMediaLifecycleRef.current.recoveryStage,
              restartAttempt: input.listenerMediaLifecycleRef.current.restartAttempt
            },
            progressivePlaybackStatus: {
              ...(
                snapshot.progressivePlaybackStatus ??
                createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
              ),
              transportEpoch,
              mediaNegotiationRole: negotiationRole,
              listenerAwaitingPublisherOffer,
              lastIgnoredOfferReason
            }
          }),
          {
            event: "remote-peer-runtime"
          }
        );
      },
      onRemoteStream: (stream) => {
        const remoteAudio = input.remoteAudioRef.current;
        if (!remoteAudio) {
          return;
        }
        const traceContext = input.getRemoteMediaTraceContext();
        input.listenerMediaLifecycleRef.current.latestStream = stream;

        const boundStream = (remoteAudio.srcObject as MediaStream | null | undefined) ?? null;
        const forceRebind = shouldForceRemoteAudioElementRebind({
          incomingStream: stream,
          boundStream,
          currentGeneration: input.listenerMediaLifecycleRef.current.currentGeneration,
          boundGeneration: input.listenerMediaLifecycleRef.current.boundGeneration
        });

        if (remoteAudio.srcObject !== stream || forceRebind) {
          input.resetRemoteAudioElement(stream, {
            deferNullReset:
              !stream && input.currentRoomRef.current?.room.playback.status === "playing",
            generation: input.listenerMediaLifecycleRef.current.currentGeneration,
            forceRebind
          });
          input.updateRemoteMediaDiagnostic(
            stream ? "远端媒体流已绑定到音频元素" : "远端媒体流已清空",
            (snapshot) => ({
              ...snapshot,
              remoteTrackStatus: {
                ...snapshot.remoteTrackStatus,
                ...traceContext,
                ...input.getRemoteAudioDiagnostics(),
                boundToAudioElement: !!stream,
                lastBoundAt: stream
                  ? new Date().toISOString()
                  : snapshot.remoteTrackStatus.lastBoundAt,
                currentGeneration: input.listenerMediaLifecycleRef.current.currentGeneration,
                boundGeneration: input.listenerMediaLifecycleRef.current.boundGeneration,
                playingGeneration: input.listenerMediaLifecycleRef.current.playingGeneration,
                recoveryStage: input.listenerMediaLifecycleRef.current.recoveryStage,
                restartAttempt: input.listenerMediaLifecycleRef.current.restartAttempt
              }
            }),
            {
              event: "remote-stream-bound"
            }
          );
        }

        if (stream) {
          input.armListenerMediaRecoveryRef.current(
            input.listenerMediaLifecycleRef.current.currentGeneration
          );
          input.scheduleRemotePlaybackRetryRef.current(
            0,
            input.listenerMediaLifecycleRef.current.currentGeneration
          );
        }
      },
      onConnectionStateChange: ({
        peerId: remotePeerId,
        state,
        connectedPeerIds,
        recoverableFailure
      }) => {
        const currentSourcePeerId = input.currentRoomRef.current?.room.playback.sourcePeerId ?? null;
        const diagnosticPeerId = input.resolveMediaDiagnosticPeerId({
          remotePeerId,
          connectedPeerIds,
          currentSourcePeerId
        });
        const supervisorState =
          diagnosticPeerId !== "remote-media"
            ? input.updateConnectionSupervisorSignalState({
                peerId: diagnosticPeerId,
                channelKind: "media",
                mediaConnectionState: state,
                lastFailureReason:
                  state === "failed" || state === "closed" ? "media-failed" : undefined
              })
            : null;
        input.recordPeerDiagnosticRef.current({
          peerId: diagnosticPeerId,
          channelKind: "media",
          direction: "local",
          event: "connection-state",
          summary: `Media 连接状态：${state}`,
          update: (snapshot: any) => ({
            ...input.withResolvedTransportHealth({
              ...input.withSupervisorDiagnosticPatch(snapshot, supervisorState),
              mediaConnectionState: state
            }),
            progressivePlaybackStatus: {
              ...(
                snapshot.progressivePlaybackStatus ??
                createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
              ),
              mediaBootstrapState:
                state === "connected"
                  ? "steady"
                  : state === "connecting" || state === "new"
                    ? "bootstrapping"
                    : recoverableFailure || state === "disconnected"
                      ? "recovering"
                      : state === "failed" || state === "closed"
                        ? "failed"
                        : snapshot.progressivePlaybackStatus?.mediaBootstrapState ?? "idle",
              mediaFailureReason:
                state === "disconnected"
                  ? "ice-disconnected-grace"
                  : state === "closed" && recoverableFailure
                    ? "peer-closed-before-stream"
                    : state === "failed" && recoverableFailure
                      ? "no-playout-progress"
                      : snapshot.progressivePlaybackStatus?.mediaFailureReason ?? null,
              mediaTransportState:
                state === "connected"
                  ? "connected"
                  : state === "failed" || state === "closed"
                    ? "failed"
                    : state === "connecting" || state === "new"
                      ? "prewarming"
                      : snapshot.progressivePlaybackStatus?.mediaTransportState ?? "idle",
              transportEpoch: input.mediaTransportEpochRef.current,
              dataRequiredForPlayback: input.enableTrackCaching,
              firstTransportConnectedAt:
                state === "connected"
                  ? snapshot.progressivePlaybackStatus?.firstTransportConnectedAt ??
                    new Date().toISOString()
                  : snapshot.progressivePlaybackStatus?.firstTransportConnectedAt ?? null
            }
          })
        });
        input.setMediaConnectedPeers(connectedPeerIds);

        if (state === "connected") {
          input.setMediaConnectionState((current: any) =>
            current === "live" ? current : "buffering"
          );
          input.armListenerMediaRecoveryRef.current(
            input.listenerMediaLifecycleRef.current.currentGeneration
          );
          input.scheduleRemotePlaybackRetryRef.current(
            0,
            input.listenerMediaLifecycleRef.current.currentGeneration
          );
          return;
        }

        if (state === "connecting" || state === "new") {
          input.setMediaConnectionState((current: any) =>
            current === "live" || current === "buffering" ? current : "connecting"
          );
          return;
        }

        if (state === "failed") {
          input.setMediaConnectionState(input.resolveSoftRecoveryMediaState("reconnecting"));
          return;
        }

        if (state === "disconnected" || state === "closed") {
          input.setMediaConnectionState((current: any) =>
            recoverableFailure || current === "live" || current === "buffering"
              ? input.resolveSoftRecoveryMediaState("reconnecting")
              : "idle"
          );
        }
      },
      onIceConnectionStateChange: ({ peerId: remotePeerId, state }) => {
        const supervisorState = input.updateConnectionSupervisorSignalState({
          peerId: remotePeerId,
          channelKind: "media",
          mediaIceState: state,
          lastFailureReason: state === "failed" ? "ice-failed" : undefined
        });
        input.recordPeerDiagnosticRef.current({
          peerId: remotePeerId,
          channelKind: "media",
          direction: "local",
          event: "ice-state",
          summary: `Media ICE 状态：${state}`,
          update: (snapshot: any) => ({
            ...input.withResolvedTransportHealth({
              ...input.withSupervisorDiagnosticPatch(snapshot, supervisorState),
              mediaIceState: state
            })
          })
        });
      },
      onRemoteTrack: ({ peerId: remotePeerId, trackId, trackMuted, trackEnabled, trackReadyState }) => {
        const now = new Date().toISOString();
        const traceContext = input.getRemoteMediaTraceContext(remotePeerId);
        input.listenerMediaLifecycleRef.current.lastTrackTraceKey = traceContext.traceKey;
        input.listenerMediaLifecycleRef.current.recoveryStage = "waiting-track";
        input.recordPeerDiagnosticRef.current({
          peerId: remotePeerId,
          channelKind: "media",
          direction: "local",
          event: "remote-track",
          summary: traceContext.traceKey
            ? `收到远端 track ${trackId} · ${traceContext.traceKey}`
            : `收到远端 track ${trackId}`,
          update: (snapshot: any) => ({
            ...snapshot,
            remoteTrackStatus: {
              ...snapshot.remoteTrackStatus,
              ...traceContext,
              trackId,
              trackMuted,
              trackEnabled,
              trackReadyState,
              received: true,
              lastTrackAt: now,
              currentGeneration: input.listenerMediaLifecycleRef.current.currentGeneration,
              boundGeneration: input.listenerMediaLifecycleRef.current.boundGeneration,
              playingGeneration: input.listenerMediaLifecycleRef.current.playingGeneration,
              recoveryStage: input.listenerMediaLifecycleRef.current.recoveryStage,
              restartAttempt: input.listenerMediaLifecycleRef.current.restartAttempt
            }
          })
        });
        input.updateRemoteMediaDiagnostic(
          `成员端收到远端 track ${trackId}`,
          (snapshot) => ({
            ...snapshot,
            remoteTrackStatus: {
              ...snapshot.remoteTrackStatus,
              ...traceContext,
              trackId,
              trackMuted,
              trackEnabled,
              trackReadyState,
              received: true,
              lastTrackAt: now,
              currentGeneration: input.listenerMediaLifecycleRef.current.currentGeneration,
              boundGeneration: input.listenerMediaLifecycleRef.current.boundGeneration,
              playingGeneration: input.listenerMediaLifecycleRef.current.playingGeneration,
              recoveryStage: input.listenerMediaLifecycleRef.current.recoveryStage,
              restartAttempt: input.listenerMediaLifecycleRef.current.restartAttempt
            }
          }),
          {
            event: "remote-track"
          }
        );
        input.armListenerMediaRecoveryRef.current(
          input.listenerMediaLifecycleRef.current.currentGeneration
        );
      },
      onSourcePeerFailed: ({ peerId: remotePeerId, mediaEpoch }) => {
        input.updateConnectionSupervisorSignalState({
          peerId: remotePeerId,
          channelKind: "media",
          mediaConnectionState: "failed",
          lastFailureReason: "media-failed"
        });
        if (input.currentRoomRef.current?.room.playback.sourcePeerId === remotePeerId) {
          input.listenerMediaLifecycleRef.current.latestStream = null;
          input.listenerMediaLifecycleRef.current.boundGeneration = null;
          input.listenerMediaLifecycleRef.current.lastBoundTraceKey = null;
          input.resetRemoteAudioElement(null, {
            generation: input.listenerMediaLifecycleRef.current.currentGeneration,
            reason: "source-peer-failed"
          });
        }
        input.recordPeerDiagnosticRef.current({
          peerId: remotePeerId,
          channelKind: "media",
          direction: "local",
          event: "source-peer-failed",
          level: "warning",
          summary: `媒体源 ${remotePeerId} 失效，mediaEpoch=${mediaEpoch}`,
          update: (snapshot: any) => ({
            ...snapshot,
            lastError: `媒体源 ${remotePeerId} 已失效`
          })
        });
        input.setMediaConnectionState(input.resolveSoftRecoveryMediaState("reconnecting"));
      },
      onStatsSample: ({ peerId: remotePeerId, sample }) => {
        input.updateMediaTransportStatsRef.current({
          peerId: remotePeerId,
          sample
        });
      }
    },
    {
      resolveConnectionConfig: (remotePeerId) => ({
        iceTransportPolicy: resolvePreferredIceTransportPolicy(
          input.connectionSupervisorStatesRef.current.get(remotePeerId)
        )
      })
    }
  );

  input.mediaMeshRef.current = mediaMesh;
  mediaMesh.setStatsSamplingMode(
    !input.currentTrackId || (!input.isPageVisible && input.playbackStatus !== "playing")
      ? "off"
      : input.isCurrentSourceOwner ||
          input.activePlaybackSource !== "remote-stream" ||
          input.bufferHealth !== "healthy"
        ? "active"
        : "steady"
  );

  return {
    mediaMesh
  };
}

export function useRoomMediaPublicationRuntime(input: {
  roomSnapshot: RoomSnapshot | null;
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  activeRouteRoomIdRef: MutableRefObject<string | null>;
  peerId: string;
  roomListenerCount: number;
  activePlaybackSource: ProgressivePlaybackSource;
  isCurrentSourceOwner: boolean;
  audioUnlocked: boolean;
  sourceStartState: "idle" | "awaiting-unlock" | "starting" | "live" | "failed";
  uploadedTracks: Record<string, any>;
  audioRef: RefObject<HTMLAudioElement | null>;
  remoteAudioRef: RefObject<HTMLAudioElement | null>;
  socketRef: MutableRefObject<any>;
  mediaMeshRef: MutableRefObject<RoomMediaMesh | null>;
  hostStreamRef: MutableRefObject<MediaStream | null>;
  mediaTransportEpochRef: MutableRefObject<number>;
  transportResetReasonRef: MutableRefObject<
    "source-changed" | "socket-reconnect" | "explicit-hard-reset" | "none"
  >;
  hostMediaSyncRetryRef: MutableRefObject<number | null>;
  hostMediaClockSequenceRef: MutableRefObject<number>;
  hostMediaSyncStateRef: MutableRefObject<{
    inFlight: boolean;
    lastAppliedKey: string | null;
    pendingKey: string | null;
    lastCaptureRefreshKey: string | null;
    lastPublishKey: string | null;
    retryKey: string | null;
    publishGeneration: number;
    stage: HostPublishStage;
    lastPublishedListenerSet: string | null;
  }>;
  lastHostCaptureRefreshAtRef: MutableRefObject<number>;
  ensureMediaTransportConnectedRef: MutableRefObject<
    (options?: {
      preferPublishedTrack?: boolean;
      forceResync?: boolean;
      reason?: string;
    }) => Promise<void>
  >;
  syncHostMediaStreamRef: MutableRefObject<
    (options?: { forceResync?: boolean; reason?: string }) => Promise<void>
  >;
  ensureSourcePlaybackStartedRef: MutableRefObject<() => Promise<void>>;
  audioUnlockedRef: MutableRefObject<boolean>;
  setAudioUnlockedRef: MutableRefObject<Dispatch<SetStateAction<boolean>>>;
  setAuthoritativeMediaClock: Dispatch<SetStateAction<any>>;
  recordPeerDiagnosticRef: MutableRefObject<(event: any) => void>;
  clearHostMediaSyncRetry: () => void;
  getSilentPrewarmHandle: () => { stream: MediaStream | null } | null;
  getHostRelayStream?: () => MediaStream | null;
  getHostRelayClockState?: () => {
    mediaTimeMs: number;
    bufferedAheadMs: number;
    playoutState: "playing" | "buffering" | "paused";
  } | null;
  getLocalPlaybackPositionMs?: () => number | null;
  setStatusMessage: (value: string) => void;
  updateSourceStartState: (
    nextState: "idle" | "awaiting-unlock" | "starting" | "live" | "failed",
    options?: { error?: string | null; recordEvent?: boolean; summary?: string; level?: "info" | "warning" | "error" }
  ) => void;
  updateHostCaptureDiagnostics: (input: any) => void;
  enableTrackCaching: boolean;
}) {
  const ensureMediaTransportConnected = useCallback(
    async (options?: { forceResync?: boolean; reason?: string; preferPublishedTrack?: boolean }) => {
      const forceResync = options?.forceResync ?? false;
      const currentRoom = input.currentRoomRef.current;
      if (
        !shouldManagePublishedMediaTransport({
          roomId: currentRoom?.room.id,
          peerId: input.peerId,
          isCurrentSourceOwner: input.isCurrentSourceOwner
        })
      ) {
        input.clearHostMediaSyncRetry();
        return;
      }
      if (!currentRoom) {
        input.clearHostMediaSyncRetry();
        return;
      }

      const playback = currentRoom.room.playback;
      const listenerPeerIds =
        currentRoom.room.members
          .map((member) => member.peerId)
          .filter((memberPeerId): memberPeerId is string => !!memberPeerId && memberPeerId !== input.peerId) ?? [];
      const listenerSetHash = [...listenerPeerIds].sort().join(",");
      const transportEpoch = input.mediaTransportEpochRef.current;
      const syncState = input.hostMediaSyncStateRef.current;
      const { captureRefreshKey, forceRefresh: shouldForceCaptureRefresh } = resolveHostCaptureRefresh({
        currentTrackId: playback.currentTrackId,
        mediaEpoch: playback.mediaEpoch,
        activePlaybackSource: input.activePlaybackSource,
        lastCaptureRefreshKey: syncState.lastCaptureRefreshKey
      });

      let publishKey: string | null = [
        currentRoom.room.id,
        transportEpoch,
        listenerSetHash,
        options?.preferPublishedTrack ? "publish" : "transport"
      ].join("|");

      if (!forceResync && (syncState.lastAppliedKey === publishKey || syncState.pendingKey === publishKey)) {
        return;
      }

      if (syncState.inFlight) {
        syncState.pendingKey = publishKey;
        return;
      }

      syncState.inFlight = true;
      syncState.pendingKey = publishKey;
      let awaitingLocalAudioTrack = false;
      let blockedUntilSourcePlaybackReady = false;

      try {
        if (listenerPeerIds.length === 0) {
          syncState.lastCaptureRefreshKey = null;
          syncState.lastPublishKey = null;
          syncState.lastPublishedListenerSet = null;
          syncState.stage = "idle";
          input.hostStreamRef.current = null;
          input.updateHostCaptureDiagnostics({
            refreshKey: null,
            forcedRefresh: false,
            captureMode: null,
            mediaEpoch: playback.mediaEpoch,
            transportEpoch,
            mediaTransportState: "idle",
            usingSilentPrewarmTrack: false,
            publishedTrackKind: "none",
            hostPublishSource: "none",
            hostPublishReadiness: "idle",
            hostPublishFailureReason: null,
            resolvedPublishElement: "none",
            resolvedPublishStreamKind: "none",
            mediaBootstrapState: "idle",
            mediaFailureReason: null,
            transportResetReason: input.transportResetReasonRef.current,
            hostPublishingReady: false,
            dataRequiredForPlayback: input.enableTrackCaching,
            captureTrackState: null,
            publishGeneration: syncState.publishGeneration,
            publishKey: null,
            publishStage: "idle",
            publishedListenerSet: null,
            summary: "房主媒体传输已停止，当前没有在线监听成员"
          });
          await input.mediaMeshRef.current?.syncHostPeers([], null, playback.mediaEpoch, transportEpoch);
          syncState.lastAppliedKey = publishKey;
          return;
        }

        const directRelayStream =
          typeof input.getHostRelayStream === "function" ? input.getHostRelayStream() : null;
        const shouldPublishCurrentTrack =
          options?.preferPublishedTrack !== false &&
          playback.status === "playing" &&
          !!playback.currentTrackId &&
          input.isCurrentSourceOwner;

        const currentTrackUpload =
          playback.currentTrackId ? input.uploadedTracks[playback.currentTrackId] ?? null : null;
        const hasPlayableLiveUpload = !!currentTrackUpload;
        const forceSourceOwnerLocalPublish = shouldForceSourceOwnerLocalPlayback({
          isCurrentSourceOwner: input.isCurrentSourceOwner,
          activePlaybackSource: input.activePlaybackSource,
          hasFullLocalTrack: hasPlayableLiveUpload
        });
        const currentTrackObjectUrl = currentTrackUpload?.objectUrl ?? null;
        const publishSource = resolveHostPublishSource({
          activePlaybackSource: input.activePlaybackSource,
          isCurrentSourceOwner: input.isCurrentSourceOwner,
          forceSourceOwnerLocalPlayback: forceSourceOwnerLocalPublish,
          localAudio: input.audioRef.current,
          remoteAudio: input.remoteAudioRef.current,
          hostRelayStream: directRelayStream,
          hasPlayableLiveUpload
        });
        const relayAudio = publishSource.audioElement;

        let usedForcedRefresh = shouldForceCaptureRefresh || forceResync;
        let selectedStream: MediaStream | null = null;
        let captureTrackState: ReturnType<typeof getHostMediaStreamTrackState> | null = null;
        let captureMode: "native" | "audio-context" | null =
          relayAudio ? getCapturedAudioStreamMode(relayAudio) : null;
        let mediaTransportState: MediaTransportState = "connected";
        let publishedTrackKind: HostPublishedTrackKind = "none";
        let usingSilentPrewarmTrack = false;
        let hostPublishSource: HostPublishSourceTarget = publishSource.publishTarget;
        let hostPublishReadiness: HostPublishReadiness = publishSource.readiness;
        let hostPublishFailureReason = publishSource.reason;
        let resolvedPublishElement: ResolvedPublishElement = publishSource.resolvedPublishElement;
        let resolvedPublishStreamKind: ResolvedPublishStreamKind =
          publishSource.resolvedPublishStreamKind;

        if (shouldPublishCurrentTrack && hostPublishReadiness !== "ready") {
          awaitingLocalAudioTrack = hostPublishReadiness === "awaiting-audio";
          blockedUntilSourcePlaybackReady = hostPublishReadiness !== "failed";
        }

        if (
          shouldPublishCurrentTrack &&
          !blockedUntilSourcePlaybackReady &&
          publishSource.publishTarget === "local-audio" &&
          relayAudio &&
          !isHostRelayAudioReadyForCapture({
            activePlaybackSource: "full-local",
            relayAudio,
            currentTrackObjectUrl
          })
        ) {
          blockedUntilSourcePlaybackReady = true;
          hostPublishReadiness = "awaiting-audio";
          hostPublishFailureReason = "local-audio-not-ready-for-capture";
        }

        if (shouldPublishCurrentTrack && !blockedUntilSourcePlaybackReady && (publishSource.stream || relayAudio)) {
          const preferAudioContextCapture = true;
          let capture =
            publishSource.stream ??
            captureAudioStream(relayAudio!, {
              forceRefresh: usedForcedRefresh,
              preferAudioContext: preferAudioContextCapture
            });
          captureTrackState = getHostMediaStreamTrackState(capture);

          if (
            playback.status === "playing" &&
            (publishSource.stream || isAudioElementEffectivelyPlaying(relayAudio)) &&
            !hasUsableHostMediaStreamTrack(capture)
          ) {
            usedForcedRefresh = true;
            capture =
              publishSource.stream ??
              captureAudioStream(relayAudio!, {
                forceRefresh: true,
                preferAudioContext: preferAudioContextCapture
              });
            captureTrackState = getHostMediaStreamTrackState(capture);
          }

          if (capture && hasUsableHostMediaStreamTrack(capture)) {
            selectedStream = capture;
            publishedTrackKind = publishSource.trackKind;
            mediaTransportState = "publishing";
            hostPublishReadiness = "ready";
          } else {
            awaitingLocalAudioTrack = true;
            blockedUntilSourcePlaybackReady = true;
            hostPublishReadiness = "awaiting-audio";
            hostPublishFailureReason = `${publishSource.publishTarget}-capture-track-unavailable`;
          }
        }

        if (!selectedStream) {
          const silentPrewarmHandle = input.getSilentPrewarmHandle();
          if (!silentPrewarmHandle?.stream) {
            syncState.stage = "idle";
            input.updateHostCaptureDiagnostics({
              refreshKey: captureRefreshKey,
              forcedRefresh: usedForcedRefresh,
              captureMode,
              mediaEpoch: playback.mediaEpoch,
              transportEpoch,
              mediaTransportState: "failed",
              usingSilentPrewarmTrack: false,
              publishedTrackKind: "none",
              hostPublishSource,
              hostPublishReadiness: "failed",
              hostPublishFailureReason: "silent-prewarm-creation-failed",
              resolvedPublishElement,
              resolvedPublishStreamKind,
              mediaBootstrapState: "failed",
              mediaFailureReason: "peer-closed-before-stream",
              transportResetReason: input.transportResetReasonRef.current,
              hostPublishingReady: false,
              dataRequiredForPlayback: input.enableTrackCaching,
              captureTrackState,
              publishGeneration: syncState.publishGeneration,
              publishKey: syncState.lastPublishKey,
              publishStage: "idle",
              publishedListenerSet: syncState.lastPublishedListenerSet,
              summary: "房主媒体预热失败，未能创建静音预热轨"
            });
            input.setStatusMessage("当前浏览器无法创建音频预热流，请使用最新版 Chrome 或 Edge。");
            return;
          }

          selectedStream = silentPrewarmHandle.stream;
          captureTrackState = getHostMediaStreamTrackState(selectedStream);
          usingSilentPrewarmTrack = true;
          publishedTrackKind = "silent-prewarm";
          mediaTransportState = "prewarming";
          resolvedPublishStreamKind = "silent-prewarm";
          syncState.stage = blockedUntilSourcePlaybackReady ? "waiting-source-audio" : "capture-ready";
          publishKey = [
            currentRoom.room.id,
            transportEpoch,
            listenerSetHash,
            "silent-prewarm"
          ].join("|");
          syncState.pendingKey = publishKey;
        } else {
          syncState.stage = "published";
          publishKey = [
            playback.currentTrackId ?? "none",
            playback.mediaEpoch,
            playback.sourcePeerId ?? "none",
            captureTrackState?.trackId ?? "none",
            ...listenerPeerIds
          ].join("|");
          syncState.pendingKey = publishKey;
        }

        if (
          !usingSilentPrewarmTrack &&
          selectedStream &&
          shouldDeferHostMediaStreamSync({
            stream: selectedStream,
            listenerPeerCount: listenerPeerIds.length,
            playbackStatus: playback.status === "playing" ? "playing" : "idle"
          })
        ) {
          awaitingLocalAudioTrack = true;
          blockedUntilSourcePlaybackReady = true;
          const silentPrewarmHandle = input.getSilentPrewarmHandle();
          if (silentPrewarmHandle?.stream) {
            selectedStream = silentPrewarmHandle.stream;
            captureTrackState = getHostMediaStreamTrackState(selectedStream);
            usingSilentPrewarmTrack = true;
            publishedTrackKind = "silent-prewarm";
            mediaTransportState = "prewarming";
            resolvedPublishStreamKind = "silent-prewarm";
            syncState.stage = "waiting-source-audio";
            publishKey = [
              currentRoom.room.id,
              transportEpoch,
              listenerSetHash,
              "silent-prewarm"
            ].join("|");
            syncState.pendingKey = publishKey;
          }
        }

        syncState.lastCaptureRefreshKey = captureRefreshKey;
        input.hostStreamRef.current = selectedStream;
        input.lastHostCaptureRefreshAtRef.current = Date.now();
        await input.mediaMeshRef.current?.syncHostPeers(
          listenerPeerIds,
          selectedStream,
          playback.mediaEpoch,
          transportEpoch
        );

        if (publishKey && publishKey !== syncState.lastPublishKey) {
          syncState.publishGeneration += 1;
        }
        syncState.lastPublishKey = publishKey;
        syncState.lastPublishedListenerSet = listenerSetHash;

        input.updateHostCaptureDiagnostics({
          refreshKey: captureRefreshKey,
          forcedRefresh: usedForcedRefresh,
          captureMode,
          mediaEpoch: playback.mediaEpoch,
          transportEpoch,
          mediaTransportState,
          usingSilentPrewarmTrack,
          publishedTrackKind,
          hostPublishSource,
          hostPublishReadiness,
          hostPublishFailureReason,
          resolvedPublishElement,
          resolvedPublishStreamKind,
          mediaBootstrapState:
            publishedTrackKind === "host-capture" || publishedTrackKind === "relay-stream"
              ? "steady"
              : blockedUntilSourcePlaybackReady
                ? "recovering"
                : "bootstrapping",
          mediaFailureReason:
            blockedUntilSourcePlaybackReady ? hostPublishFailureReason ?? "no-playout-progress" : null,
          transportResetReason: input.transportResetReasonRef.current,
          hostPublishingReady:
            publishedTrackKind === "host-capture" || publishedTrackKind === "relay-stream",
          dataRequiredForPlayback: input.enableTrackCaching,
          captureTrackState,
          publishGeneration: syncState.publishGeneration,
          publishKey,
          publishStage: syncState.stage,
          publishedListenerSet: listenerSetHash,
          summary:
            publishedTrackKind === "host-capture" || publishedTrackKind === "relay-stream"
              ? "房主真实音轨已发布到当前监听集合"
              : blockedUntilSourcePlaybackReady
                ? `房主媒体链路已预热，等待真实音轨切入：${hostPublishFailureReason ?? hostPublishSource}`
                : "房主媒体链路已预连，当前使用静音预热轨保持连接"
        });

        input.clearHostMediaSyncRetry();
        syncState.lastAppliedKey = publishKey;
      } catch (error) {
        const message = toUserFacingError(error);
        input.recordPeerDiagnosticRef.current({
          peerId: "system",
          channelKind: "system",
          direction: "local",
          event: "host-media-sync-failed",
          level: "error",
          summary: `房主实时音频同步失败：${message}`,
          update: (snapshot: any) => ({
            ...snapshot,
            lastError: `房主实时音频同步失败：${message}`
          })
        });
        input.setStatusMessage("房主实时音频同步失败，已停止本次推流重试。");
        await input.mediaMeshRef.current?.syncHostPeers([], null, playback.mediaEpoch, transportEpoch).catch(
          () => undefined
        );
        input.hostStreamRef.current = null;
        input.lastHostCaptureRefreshAtRef.current = 0;
        syncState.lastCaptureRefreshKey = null;
        syncState.lastPublishKey = null;
        syncState.lastPublishedListenerSet = null;
        syncState.stage = "idle";
        input.updateHostCaptureDiagnostics({
          refreshKey: null,
          forcedRefresh: false,
          captureMode: null,
          mediaEpoch: playback.mediaEpoch,
          transportEpoch,
          mediaTransportState: "failed",
          usingSilentPrewarmTrack: false,
          publishedTrackKind: "none",
          hostPublishSource: "none",
          hostPublishReadiness: "failed",
          hostPublishFailureReason: message,
          resolvedPublishElement: "none",
          resolvedPublishStreamKind: "none",
          mediaBootstrapState: "failed",
          mediaFailureReason: "no-playout-progress",
          transportResetReason: input.transportResetReasonRef.current,
          hostPublishingReady: false,
          dataRequiredForPlayback: input.enableTrackCaching,
          captureTrackState: null,
          publishGeneration: syncState.publishGeneration,
          publishKey: null,
          publishStage: "idle",
          publishedListenerSet: null,
          summary: `房主实时音频同步失败：${message}`
        });
      } finally {
        const nextPendingKey = syncState.pendingKey;
        syncState.inFlight = false;

        if (awaitingLocalAudioTrack || blockedUntilSourcePlaybackReady) {
          input.clearHostMediaSyncRetry();
          input.hostMediaSyncRetryRef.current = window.setTimeout(() => {
            input.hostMediaSyncRetryRef.current = null;
            void ensureMediaTransportConnected({
              preferPublishedTrack: true
            });
          }, hostMediaSyncRetryDelayMs);
          syncState.pendingKey = null;
          return;
        }

        if (nextPendingKey && nextPendingKey !== syncState.lastAppliedKey) {
          syncState.pendingKey = null;
          queueMicrotask(() => {
            void ensureMediaTransportConnected({
              preferPublishedTrack: options?.preferPublishedTrack
            });
          });
          return;
        }

        syncState.pendingKey = null;
      }
    },
    [
      input.activePlaybackSource,
      input.audioRef,
      input.clearHostMediaSyncRetry,
      input.currentRoomRef,
      input.getHostRelayStream,
      input.getSilentPrewarmHandle,
      input.isCurrentSourceOwner,
      input.peerId,
      input.remoteAudioRef,
      input.setStatusMessage,
      input.uploadedTracks,
      input.updateHostCaptureDiagnostics
    ]
  );

  const syncHostMediaStream = useCallback(
    async (options?: { forceResync?: boolean; reason?: string }) => {
      await ensureMediaTransportConnected({
        ...options,
        preferPublishedTrack: true
      });
    },
    [ensureMediaTransportConnected]
  );

  const ensureSourcePlaybackStarted = useCallback(async () => {
    const currentRoom = input.currentRoomRef.current;
    if (!currentRoom?.room.id || !input.peerId || !input.isCurrentSourceOwner) {
      input.updateSourceStartState("idle");
      return;
    }

    const playback = currentRoom.room.playback;
    if (playback.status !== "playing" || !playback.currentTrackId) {
      input.updateSourceStartState("idle");
      await ensureMediaTransportConnected({
        preferPublishedTrack: false
      });
      return;
    }

    if (!input.audioUnlockedRef.current && !roomAudioOutput.isActivated()) {
      input.updateSourceStartState("awaiting-unlock", {
        summary: "音源端等待本机任意交互后自动启动",
        level: "warning"
      });
      await ensureMediaTransportConnected({
        preferPublishedTrack: false
      });
      return;
    }

    if (!input.audioUnlockedRef.current && roomAudioOutput.isActivated()) {
      input.setAudioUnlockedRef.current(true);
      input.audioUnlockedRef.current = true;
    }

    const currentTrackUpload =
      playback.currentTrackId ? input.uploadedTracks[playback.currentTrackId] ?? null : null;
    const directRelayStream =
      typeof input.getHostRelayStream === "function" ? input.getHostRelayStream() : null;
    const publishSource = resolveHostPublishSource({
      activePlaybackSource: input.activePlaybackSource,
      isCurrentSourceOwner: input.isCurrentSourceOwner,
      forceSourceOwnerLocalPlayback: shouldForceSourceOwnerLocalPlayback({
        isCurrentSourceOwner: input.isCurrentSourceOwner,
        activePlaybackSource: input.activePlaybackSource,
        hasFullLocalTrack: !!currentTrackUpload
      }),
      localAudio: input.audioRef.current,
      remoteAudio: input.remoteAudioRef.current,
      hostRelayStream: directRelayStream,
      hasPlayableLiveUpload: !!currentTrackUpload
    });

    if (publishSource.publishTarget === "none") {
      input.updateSourceStartState("failed", {
        error: publishSource.reason ?? "missing-publish-source",
        summary: "音源端缺少可用的真实发布源",
        recordEvent: true,
        level: "error"
      });
      await ensureMediaTransportConnected({
        preferPublishedTrack: false
      });
      return;
    }

    if (publishSource.readiness !== "ready") {
      const nextSummary =
        publishSource.readiness === "failed"
          ? `音源端已起播，但发布源不可用：${publishSource.reason ?? publishSource.publishTarget}`
          : `音源端已解锁，等待真实发布源就绪：${publishSource.reason ?? publishSource.publishTarget}`;
      input.updateSourceStartState(publishSource.readiness === "failed" ? "failed" : "starting", {
        error: publishSource.readiness === "failed" ? publishSource.reason ?? "publish-source-failed" : null,
        summary: nextSummary,
        recordEvent: publishSource.readiness === "failed",
        level: publishSource.readiness === "failed" ? "error" : "warning"
      });
      await ensureMediaTransportConnected({
        preferPublishedTrack: publishSource.readiness !== "failed"
      });
      return;
    }

    const publishAudio = publishSource.audioElement;
    const isElementPlaying = publishAudio ? isAudioElementEffectivelyPlaying(publishAudio) : true;
    if (!isElementPlaying) {
      input.updateSourceStartState("starting", {
        summary: `音源端已解锁，正在等待${publishSource.publishTarget}真正起播`
      });
      await ensureMediaTransportConnected({
        preferPublishedTrack: false
      });
      return;
    }

    if (!input.audioUnlockedRef.current) {
      input.setAudioUnlockedRef.current(true);
      input.audioUnlockedRef.current = true;
    }

    await ensureMediaTransportConnected({
      preferPublishedTrack: true
    });
    input.updateSourceStartState(
      input.hostMediaSyncStateRef.current.stage === "published" ? "live" : "starting",
      input.hostMediaSyncStateRef.current.stage === "published"
        ? undefined
        : {
            summary: "音源端已起播，正在等待真实音轨完成发布"
          }
    );
  }, [
    ensureMediaTransportConnected,
    input.activePlaybackSource,
    input.audioRef,
    input.audioUnlockedRef,
    input.currentRoomRef,
    input.getHostRelayStream,
    input.isCurrentSourceOwner,
    input.peerId,
    input.remoteAudioRef,
    input.setAudioUnlockedRef,
    input.updateSourceStartState,
    input.uploadedTracks
  ]);

  useEffect(() => {
    input.ensureMediaTransportConnectedRef.current = ensureMediaTransportConnected;
  }, [ensureMediaTransportConnected, input.ensureMediaTransportConnectedRef]);

  useEffect(() => {
    input.syncHostMediaStreamRef.current = syncHostMediaStream;
  }, [input.syncHostMediaStreamRef, syncHostMediaStream]);

  useEffect(() => {
    input.ensureSourcePlaybackStartedRef.current = ensureSourcePlaybackStarted;
  }, [ensureSourcePlaybackStarted, input.ensureSourcePlaybackStartedRef]);

  useEffect(() => {
    const roomId = input.roomSnapshot?.room.id;
    const playback = input.roomSnapshot?.room.playback;
    if (
      !roomId ||
      !playback?.currentTrackId ||
      !input.peerId ||
      !input.isCurrentSourceOwner ||
      playback.sourcePeerId !== input.peerId
    ) {
      input.hostMediaClockSequenceRef.current = 0;
      return;
    }

    if (input.roomListenerCount === 0) {
      return;
    }

    const emitRoomMediaClock = () => {
      const latestRoom = input.currentRoomRef.current;
      const socket = input.socketRef.current;
      const latestPlayback = latestRoom?.room.playback;
      if (
        !socket?.connected ||
        input.activeRouteRoomIdRef.current !== roomId ||
        !latestPlayback?.currentTrackId ||
        latestPlayback.sourcePeerId !== input.peerId
      ) {
        return;
      }

      const relayClockState =
        typeof input.getHostRelayClockState === "function" ? input.getHostRelayClockState() : null;
      const publishSource = resolveHostPublishSource({
        activePlaybackSource: input.activePlaybackSource,
        isCurrentSourceOwner: input.isCurrentSourceOwner,
        forceSourceOwnerLocalPlayback: shouldForceSourceOwnerLocalPlayback({
          isCurrentSourceOwner: input.isCurrentSourceOwner,
          activePlaybackSource: input.activePlaybackSource,
          hasFullLocalTrack:
            !!(latestPlayback.currentTrackId && input.uploadedTracks[latestPlayback.currentTrackId])
        }),
        localAudio: input.audioRef.current,
        remoteAudio: input.remoteAudioRef.current,
        hostRelayStream: typeof input.getHostRelayStream === "function" ? input.getHostRelayStream() : null,
        hasPlayableLiveUpload:
          !!(latestPlayback.currentTrackId && input.uploadedTracks[latestPlayback.currentTrackId])
      });
      const relayAudio = publishSource.audioElement;
      if (!relayAudio && !relayClockState) {
        return;
      }
      const localPlaybackPositionMs =
        relayClockState?.mediaTimeMs ??
        (input.activePlaybackSource !== "remote-stream" && typeof input.getLocalPlaybackPositionMs === "function"
          ? input.getLocalPlaybackPositionMs()
          : null);
      const fallbackMediaTimeMs =
        relayAudio && Number.isFinite(relayAudio.currentTime) && relayAudio.currentTime >= 0
          ? Math.round(relayAudio.currentTime * 1000)
          : null;
      const mediaTimeMs =
        typeof localPlaybackPositionMs === "number" && Number.isFinite(localPlaybackPositionMs)
          ? Math.max(0, Math.round(localPlaybackPositionMs))
          : fallbackMediaTimeMs;
      if (mediaTimeMs === null) {
        return;
      }

      const playbackRate =
        relayAudio && Number.isFinite(relayAudio.playbackRate) && relayAudio.playbackRate > 0
          ? relayAudio.playbackRate
          : 1;
      const advancing =
        relayClockState
          ? relayClockState.playoutState === "playing"
          : latestPlayback.status === "playing" &&
            (input.activePlaybackSource !== "remote-stream"
              ? typeof localPlaybackPositionMs === "number" ||
                isAudioElementEffectivelyPlaying(relayAudio)
              : isAudioElementEffectivelyPlaying(relayAudio));
      const payload: RoomMediaClockPayload = {
        roomId,
        mediaEpoch: latestPlayback.mediaEpoch,
        sourcePeerId: input.peerId,
        relayGeneration: input.hostMediaSyncStateRef.current.publishGeneration,
        mediaTimeMs,
        playbackRate,
        advancing,
        playoutState: relayClockState?.playoutState ?? (advancing ? "playing" : latestPlayback.status),
        bufferedAheadMs: relayClockState?.bufferedAheadMs ?? 0,
        sequence: ++input.hostMediaClockSequenceRef.current,
        emittedAt: new Date().toISOString()
      };
      socket.emit("room.media.clock", payload);
      input.setAuthoritativeMediaClock((current: any) => {
        if (
          current &&
          current.mediaEpoch === payload.mediaEpoch &&
          current.sourcePeerId === payload.sourcePeerId &&
          current.relayGeneration > payload.relayGeneration
        ) {
          return current;
        }

        if (
          current &&
          current.mediaEpoch === payload.mediaEpoch &&
          current.sourcePeerId === payload.sourcePeerId &&
          current.relayGeneration === payload.relayGeneration &&
          current.sequence > payload.sequence
        ) {
          return current;
        }

        return {
          ...payload,
          receivedAtMs: Date.now()
        };
      });
    };

    emitRoomMediaClock();
    let timerId = 0;
    const scheduleNextEmit = () => {
      const relayClockState =
        typeof input.getHostRelayClockState === "function" ? input.getHostRelayClockState() : null;
      timerId = window.setTimeout(() => {
        emitRoomMediaClock();
        scheduleNextEmit();
      }, resolveRoomMediaClockEmitIntervalMs({
        playbackStatus: playback.status,
        sourceStartState: input.sourceStartState,
        relayPlayoutState: relayClockState?.playoutState ?? null
      }));
    };
    scheduleNextEmit();

    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    input.activePlaybackSource,
    input.activeRouteRoomIdRef,
    input.audioRef,
    input.currentRoomRef,
    input.getHostRelayClockState,
    input.getHostRelayStream,
    input.getLocalPlaybackPositionMs,
    input.hostMediaClockSequenceRef,
    input.hostMediaSyncStateRef,
    input.isCurrentSourceOwner,
    input.peerId,
    input.remoteAudioRef,
    input.roomListenerCount,
    input.roomSnapshot?.room.id,
    input.roomSnapshot?.room.playback,
    input.setAuthoritativeMediaClock,
    input.socketRef,
    input.sourceStartState,
    input.uploadedTracks
  ]);

  return {
    ensureMediaTransportConnected,
    syncHostMediaStream,
    ensureSourcePlaybackStarted
  };
}

export function useRoomMediaRuntime(input: {
  roomSnapshot: RoomSnapshot | null;
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  activeRouteRoomIdRef: MutableRefObject<string | null>;
  peerId: string;
  roomListenerCount: number;
  roomListenerPeerIds: string[];
  roomListenerSetHash: string;
  mediaConnectedPeers: string[];
  isCurrentSourceOwner: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  audioUnlocked: boolean;
  sourceStartState: "idle" | "awaiting-unlock" | "starting" | "live" | "failed";
  remoteAudioRef: RefObject<HTMLAudioElement | null>;
  mediaMeshRef: MutableRefObject<RoomMediaMesh | null>;
  hostStreamRef: MutableRefObject<MediaStream | null>;
  mediaTransportOwnerKeyRef: MutableRefObject<string | null>;
  mediaTransportEpochRef: MutableRefObject<number>;
  hostMediaSyncStateRef: MutableRefObject<{
    inFlight: boolean;
    lastAppliedKey: string | null;
    pendingKey: string | null;
    lastCaptureRefreshKey: string | null;
    lastPublishKey: string | null;
    retryKey: string | null;
    publishGeneration: number;
    stage: "idle" | "waiting-source-audio" | "capture-ready" | "published";
    lastPublishedListenerSet: string | null;
  }>;
  missingListenerSinceRef: MutableRefObject<Map<string, number>>;
  lastListenerBootstrapKeyRef: MutableRefObject<string | null>;
  lastHostCaptureRefreshAtRef: MutableRefObject<number>;
  remotePlaybackResumeAfterUnlockKeyRef: MutableRefObject<string | null>;
  listenerMediaLifecycleRef: MutableRefObject<{
    currentGeneration: string | null;
    boundGeneration: string | null;
    playingGeneration: string | null;
    lastPlayingTraceKey: string | null;
    recoveryStage: "idle" | "waiting-track" | "rebind-element" | "retry-play" | "rebind-and-play";
    restartAttempt: number;
    lastPlayoutProgressAt: number | null;
    lastObservedRemoteCurrentTimeMs: number | null;
  }>;
  armListenerMediaRecoveryRef: MutableRefObject<(generation?: string | null) => void>;
  ensureMediaTransportConnectedRef: MutableRefObject<
    (options?: {
      preferPublishedTrack?: boolean;
      forceResync?: boolean;
      reason?: string;
    }) => Promise<void>
  >;
  syncHostMediaStreamRef: MutableRefObject<
    (options?: { forceResync?: boolean; reason?: string }) => Promise<void>
  >;
  bumpMediaTransportEpoch: (
    reason?: "source-changed" | "socket-reconnect" | "explicit-hard-reset" | "none"
  ) => number;
  clearListenerMediaRecovery: () => void;
  clearHostMediaSyncRetry: () => void;
  getRemoteAudioDiagnostics: () => {
    audioPaused: boolean | null;
    audioMuted: boolean | null;
    audioReadyState: number | null;
    hasSrcObject: boolean | null;
    currentSrc: string | null;
    audioVolume: number | null;
    trackId: string | null;
    trackMuted: boolean | null;
    trackEnabled: boolean | null;
    trackReadyState: MediaStreamTrackState | null;
  };
  getRemoteMediaTraceContext: (remotePeerId?: string | null) => {
    currentTrackId: string | null;
    mediaEpoch: number | null;
    sourcePeerId: string | null;
    remotePeerId: string | null;
    traceKey: string | null;
  };
  updateRemoteMediaDiagnostic: (
    summary: string,
    update?: (snapshot: any) => any,
    options?: { event?: string; recordEvent?: boolean; level?: "info" | "warning" | "error" }
  ) => void;
  scheduleRemotePlaybackRetry: (attempt?: number, generation?: string | null) => void;
  shouldResumeRemotePlaybackAfterAudioUnlock: (input: {
    audioUnlocked: boolean;
    isCurrentSourceOwner: boolean;
    activePlaybackSource: ProgressivePlaybackSource;
    playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
    currentTrackId: string | null;
    hasRemoteSrcObject: boolean;
    remoteAudioPaused: boolean | null;
  }) => boolean;
  ensureSourcePlaybackStarted: () => Promise<void>;
  syncHostMediaStream: (options?: { forceResync?: boolean; reason?: string }) => Promise<void>;
  updateSourceStartState: (
    nextState: "idle" | "awaiting-unlock" | "starting" | "live" | "failed"
  ) => void;
  updateHostCaptureDiagnostics: (input: {
    refreshKey: string | null;
    forcedRefresh: boolean;
    captureMode: "native" | "audio-context" | null;
    mediaEpoch: number | null;
    transportEpoch?: number | null;
    publisherBootstrapRequestedAt?: string | null;
    publisherBootstrapAttempts?: number | null;
    summary: string;
  }) => void;
}) {
  useEffect(() => {
    const roomId = input.roomSnapshot?.room.id ?? null;
    const sourcePeerId = input.roomSnapshot?.room.playback.sourcePeerId ?? null;
    const ownerKey = roomId ? `${roomId}|${sourcePeerId ?? "none"}` : null;
    if (!ownerKey) {
      input.mediaTransportOwnerKeyRef.current = null;
      input.mediaTransportEpochRef.current = 0;
      return;
    }

    if (input.mediaTransportOwnerKeyRef.current === null) {
      input.mediaTransportOwnerKeyRef.current = ownerKey;
      return;
    }

    if (input.mediaTransportOwnerKeyRef.current !== ownerKey) {
      input.mediaTransportOwnerKeyRef.current = ownerKey;
      const nextTransportEpoch = input.bumpMediaTransportEpoch("source-changed");
      input.mediaMeshRef.current?.setTransportEpoch(nextTransportEpoch);
      input.hostMediaSyncStateRef.current.lastAppliedKey = null;
      input.hostMediaSyncStateRef.current.pendingKey = null;
      input.missingListenerSinceRef.current.clear();
      input.lastListenerBootstrapKeyRef.current = null;
    }
  }, [
    input.bumpMediaTransportEpoch,
    input.hostMediaSyncStateRef,
    input.lastListenerBootstrapKeyRef,
    input.mediaMeshRef,
    input.mediaTransportEpochRef,
    input.mediaTransportOwnerKeyRef,
    input.missingListenerSinceRef,
    input.roomSnapshot?.room.id,
    input.roomSnapshot?.room.playback.sourcePeerId
  ]);

  useEffect(() => {
    input.missingListenerSinceRef.current.clear();
    input.lastListenerBootstrapKeyRef.current = null;
  }, [
    input.lastListenerBootstrapKeyRef,
    input.missingListenerSinceRef,
    input.roomSnapshot?.room.id,
    input.roomSnapshot?.room.playback.currentTrackId,
    input.roomSnapshot?.room.playback.mediaEpoch,
    input.roomSnapshot?.room.playback.sourcePeerId
  ]);

  useEffect(() => {
    const remoteAudio = input.remoteAudioRef.current;
    if (!remoteAudio) {
      return;
    }

    const syncRemoteAudioEvent = (
      eventName:
        | "playing"
        | "waiting"
        | "pause"
        | "error"
        | "loadedmetadata"
        | "canplay"
        | "stalled"
        | "ended"
        | "emptied",
      summary: string
    ) => {
      const traceContext = input.getRemoteMediaTraceContext();
      if (eventName === "playing") {
        input.listenerMediaLifecycleRef.current.lastPlayingTraceKey = traceContext.traceKey;
        input.listenerMediaLifecycleRef.current.playingGeneration =
          input.listenerMediaLifecycleRef.current.currentGeneration;
        input.listenerMediaLifecycleRef.current.recoveryStage = "idle";
        input.listenerMediaLifecycleRef.current.lastPlayoutProgressAt = Date.now();
        input.listenerMediaLifecycleRef.current.lastObservedRemoteCurrentTimeMs =
          Number.isFinite(remoteAudio.currentTime) && remoteAudio.currentTime >= 0
            ? Math.round(remoteAudio.currentTime * 1000)
            : input.listenerMediaLifecycleRef.current.lastObservedRemoteCurrentTimeMs;
        input.clearListenerMediaRecovery();
      }
      input.updateRemoteMediaDiagnostic(
        summary,
        (snapshot) => ({
          ...snapshot,
          mediaConnectionState:
            eventName === "playing"
              ? "live"
              : eventName === "error" || eventName === "ended" || eventName === "emptied"
                ? "failed"
                : "buffering",
          recoveryActionLevel:
            eventName === "playing"
              ? "observe"
              : eventName === "error" || eventName === "ended" || eventName === "emptied"
                ? "hard-reconnect"
                : "observe",
          remoteTrackStatus: {
            ...snapshot.remoteTrackStatus,
            ...traceContext,
            ...input.getRemoteAudioDiagnostics(),
            lastAudioEvent: eventName,
            currentGeneration: input.listenerMediaLifecycleRef.current.currentGeneration,
            boundGeneration: input.listenerMediaLifecycleRef.current.boundGeneration,
            playingGeneration: input.listenerMediaLifecycleRef.current.playingGeneration,
            recoveryStage: input.listenerMediaLifecycleRef.current.recoveryStage,
            restartAttempt: input.listenerMediaLifecycleRef.current.restartAttempt
          }
        }),
        {
          event: `remote-audio-${eventName}`
        }
      );
      if (eventName !== "playing" && traceContext.traceKey) {
        input.armListenerMediaRecoveryRef.current(traceContext.traceKey);
      }
      if (
        shouldKickRemotePlaybackFromAudioEvent({
          eventName,
          playbackStatus: input.roomSnapshot?.room.playback.status,
          activePlaybackSource: input.activePlaybackSource,
          isCurrentSourceOwner: input.isCurrentSourceOwner,
          traceKey: traceContext.traceKey,
          hasSrcObject: !!remoteAudio.srcObject,
          remoteAudioPaused: remoteAudio.paused,
          currentGeneration: input.listenerMediaLifecycleRef.current.currentGeneration,
          playingGeneration: input.listenerMediaLifecycleRef.current.playingGeneration
        })
      ) {
        input.scheduleRemotePlaybackRetry(0, traceContext.traceKey);
      }
    };

    const handlePlaying = () => syncRemoteAudioEvent("playing", "远端音频元素开始播放");
    const handleWaiting = () => syncRemoteAudioEvent("waiting", "远端音频元素进入等待");
    const handlePause = () => syncRemoteAudioEvent("pause", "远端音频元素暂停");
    const handleLoadedMetadata = () =>
      syncRemoteAudioEvent("loadedmetadata", "远端音频元素已载入媒体元数据");
    const handleCanPlay = () => syncRemoteAudioEvent("canplay", "远端音频元素已可播放");
    const handleStalled = () => syncRemoteAudioEvent("stalled", "远端音频元素播放卡顿");
    const handleEnded = () => syncRemoteAudioEvent("ended", "远端音频元素播放结束");
    const handleEmptied = () => syncRemoteAudioEvent("emptied", "远端音频元素媒体流已清空");
    const handleError = () => syncRemoteAudioEvent("error", "远端音频元素播放失败");

    remoteAudio.addEventListener("playing", handlePlaying);
    remoteAudio.addEventListener("waiting", handleWaiting);
    remoteAudio.addEventListener("pause", handlePause);
    remoteAudio.addEventListener("loadedmetadata", handleLoadedMetadata);
    remoteAudio.addEventListener("canplay", handleCanPlay);
    remoteAudio.addEventListener("stalled", handleStalled);
    remoteAudio.addEventListener("ended", handleEnded);
    remoteAudio.addEventListener("emptied", handleEmptied);
    remoteAudio.addEventListener("error", handleError);

    return () => {
      remoteAudio.removeEventListener("playing", handlePlaying);
      remoteAudio.removeEventListener("waiting", handleWaiting);
      remoteAudio.removeEventListener("pause", handlePause);
      remoteAudio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      remoteAudio.removeEventListener("canplay", handleCanPlay);
      remoteAudio.removeEventListener("stalled", handleStalled);
      remoteAudio.removeEventListener("ended", handleEnded);
      remoteAudio.removeEventListener("emptied", handleEmptied);
      remoteAudio.removeEventListener("error", handleError);
    };
  }, [
    input.armListenerMediaRecoveryRef,
    input.clearListenerMediaRecovery,
    input.activePlaybackSource,
    input.getRemoteAudioDiagnostics,
    input.getRemoteMediaTraceContext,
    input.isCurrentSourceOwner,
    input.listenerMediaLifecycleRef,
    input.remoteAudioRef,
    input.roomSnapshot?.room.playback.status,
    input.scheduleRemotePlaybackRetry,
    input.updateRemoteMediaDiagnostic
  ]);

  useEffect(() => {
    const playback = input.roomSnapshot?.room.playback;
    const remoteAudio = input.remoteAudioRef.current;
    const generation = input.listenerMediaLifecycleRef.current.currentGeneration;
    const shouldResume = input.shouldResumeRemotePlaybackAfterAudioUnlock({
      audioUnlocked: input.audioUnlocked,
      isCurrentSourceOwner: input.isCurrentSourceOwner,
      activePlaybackSource: input.activePlaybackSource,
      playbackStatus: playback?.status,
      currentTrackId: playback?.currentTrackId ?? null,
      hasRemoteSrcObject: !!remoteAudio?.srcObject,
      remoteAudioPaused: remoteAudio?.paused ?? null
    });

    if (
      !shouldResume ||
      !generation ||
      input.listenerMediaLifecycleRef.current.currentGeneration !== generation
    ) {
      input.remotePlaybackResumeAfterUnlockKeyRef.current = null;
      return;
    }

    const resumeKey = [
      input.roomSnapshot?.room.id ?? "room",
      playback?.currentTrackId ?? "track",
      playback?.mediaEpoch ?? 0,
      generation
    ].join("|");
    if (input.remotePlaybackResumeAfterUnlockKeyRef.current === resumeKey) {
      return;
    }
    input.remotePlaybackResumeAfterUnlockKeyRef.current = resumeKey;

    input.updateRemoteMediaDiagnostic(
      "房间音频解锁后重新拉起远端播放",
      (snapshot) => ({
        ...snapshot,
        mediaConnectionState: "buffering",
        remoteTrackStatus: {
          ...snapshot.remoteTrackStatus,
          ...input.getRemoteMediaTraceContext(playback?.sourcePeerId ?? null),
          ...input.getRemoteAudioDiagnostics(),
          currentGeneration: input.listenerMediaLifecycleRef.current.currentGeneration,
          boundGeneration: input.listenerMediaLifecycleRef.current.boundGeneration,
          playingGeneration: input.listenerMediaLifecycleRef.current.playingGeneration,
          recoveryStage: input.listenerMediaLifecycleRef.current.recoveryStage,
          restartAttempt: input.listenerMediaLifecycleRef.current.restartAttempt
        }
      }),
      {
        event: "remote-play-after-unlock",
        recordEvent: false
      }
    );
    input.scheduleRemotePlaybackRetry(0, generation);
  }, [
    input.activePlaybackSource,
    input.audioUnlocked,
    input.getRemoteAudioDiagnostics,
    input.getRemoteMediaTraceContext,
    input.isCurrentSourceOwner,
    input.listenerMediaLifecycleRef,
    input.remoteAudioRef,
    input.remotePlaybackResumeAfterUnlockKeyRef,
    input.roomSnapshot?.room.id,
    input.roomSnapshot?.room.playback,
    input.scheduleRemotePlaybackRetry,
    input.shouldResumeRemotePlaybackAfterAudioUnlock,
    input.updateRemoteMediaDiagnostic
  ]);

  useEffect(() => {
    const room = input.roomSnapshot?.room;
    if (
      !shouldManagePublishedMediaTransport({
        roomId: room?.id,
        peerId: input.peerId,
        isCurrentSourceOwner: input.isCurrentSourceOwner
      })
    ) {
      return;
    }

    if (!room || input.roomListenerCount === 0) {
      return;
    }

    void input.ensureMediaTransportConnectedRef.current({
      preferPublishedTrack: room.playback.status === "playing" && input.isCurrentSourceOwner
    });
  }, [
    input.ensureMediaTransportConnectedRef,
    input.isCurrentSourceOwner,
    input.peerId,
    input.roomListenerCount,
    input.roomSnapshot?.room.id,
    input.roomSnapshot?.room.playback.status
  ]);

  useEffect(() => {
    if (!input.roomSnapshot?.room.id || !input.peerId || !input.isCurrentSourceOwner) {
      input.updateSourceStartState("idle");
      return;
    }

    void input.ensureSourcePlaybackStarted();
  }, [
    input.activePlaybackSource,
    input.audioUnlocked,
    input.ensureSourcePlaybackStarted,
    input.isCurrentSourceOwner,
    input.peerId,
    input.roomListenerSetHash,
    input.roomSnapshot?.room.id,
    input.roomSnapshot?.room.playback.currentTrackId,
    input.roomSnapshot?.room.playback.mediaEpoch,
    input.roomSnapshot?.room.playback.sourceSessionId,
    input.roomSnapshot?.room.playback.status,
    input.updateSourceStartState
  ]);

  useEffect(() => {
    if (input.isCurrentSourceOwner) {
      return;
    }

    input.clearHostMediaSyncRetry();
    input.hostStreamRef.current = null;
    input.hostMediaSyncStateRef.current = {
      inFlight: false,
      lastAppliedKey: null,
      pendingKey: null,
      lastCaptureRefreshKey: null,
      lastPublishKey: null,
      retryKey: null,
      publishGeneration: input.hostMediaSyncStateRef.current.publishGeneration,
      stage: "idle",
      lastPublishedListenerSet: null
    };
    void input.mediaMeshRef.current?.updateLocalStream(null);
  }, [
    input.clearHostMediaSyncRetry,
    input.hostMediaSyncStateRef,
    input.hostStreamRef,
    input.isCurrentSourceOwner,
    input.mediaMeshRef,
    input.roomSnapshot?.room.id,
    input.roomSnapshot?.room.playback.sourcePeerId
  ]);

  useEffect(() => {
    if (!input.roomSnapshot?.room.id || !input.peerId || !input.isCurrentSourceOwner) {
      return;
    }

    if (
      !input.audioUnlocked ||
      input.roomSnapshot.room.playback.status !== "playing" ||
      input.sourceStartState !== "live"
    ) {
      return;
    }

    void input.syncHostMediaStream();
  }, [
    input.activePlaybackSource,
    input.audioUnlocked,
    input.isCurrentSourceOwner,
    input.peerId,
    input.roomListenerSetHash,
    input.roomSnapshot?.room.id,
    input.roomSnapshot?.room.playback.currentTrackId,
    input.roomSnapshot?.room.playback.mediaEpoch,
    input.roomSnapshot?.room.playback.sourceSessionId,
    input.roomSnapshot?.room.playback.status,
    input.sourceStartState,
    input.syncHostMediaStream
  ]);

  useEffect(() => {
    if (
      !input.roomSnapshot?.room.id ||
      !input.peerId ||
      !input.isCurrentSourceOwner ||
      !input.audioUnlocked ||
      input.roomSnapshot.room.playback.status !== "playing" ||
      input.sourceStartState !== "live"
    ) {
      input.lastListenerBootstrapKeyRef.current = null;
      return;
    }

    if (input.roomListenerCount === 0) {
      input.lastListenerBootstrapKeyRef.current = null;
      return;
    }

    const now = Date.now();
    const connectedPeerSet = new Set(input.mediaConnectedPeers);
    for (const listenerPeerId of input.roomListenerPeerIds) {
      if (connectedPeerSet.has(listenerPeerId)) {
        input.missingListenerSinceRef.current.delete(listenerPeerId);
      } else if (!input.missingListenerSinceRef.current.has(listenerPeerId)) {
        input.missingListenerSinceRef.current.set(listenerPeerId, now);
      }
    }
    for (const trackedPeerId of [...input.missingListenerSinceRef.current.keys()]) {
      if (!input.roomListenerPeerIds.includes(trackedPeerId)) {
        input.missingListenerSinceRef.current.delete(trackedPeerId);
      }
    }

    const stableMissingListenerPeerIds = input.roomListenerPeerIds.filter((listenerPeerId) => {
      if (connectedPeerSet.has(listenerPeerId)) {
        return false;
      }
      const missingSince = input.missingListenerSinceRef.current.get(listenerPeerId);
      return typeof missingSince === "number" && now - missingSince >= listenerBootstrapGraceMs;
    });
    if (stableMissingListenerPeerIds.length === 0) {
      input.lastListenerBootstrapKeyRef.current = null;
      return;
    }

    const bootstrapKey = [
      input.roomSnapshot.room.id,
      input.roomSnapshot.room.playback.mediaEpoch,
      input.mediaTransportEpochRef.current,
      ...stableMissingListenerPeerIds
    ].join("|");
    if (input.lastListenerBootstrapKeyRef.current === bootstrapKey) {
      return;
    }
    input.lastListenerBootstrapKeyRef.current = bootstrapKey;

    const retryPlan = [
      { delayMs: 0, attempt: 1 },
      { delayMs: 800, attempt: 2 },
      { delayMs: 2_400, attempt: 3 }
    ];
    const timerIds = retryPlan.map(({ delayMs, attempt }) =>
      window.setTimeout(() => {
        if (input.activeRouteRoomIdRef.current !== input.roomSnapshot?.room.id) {
          return;
        }
        const requestedAt = new Date().toISOString();
        input.updateHostCaptureDiagnostics({
          refreshKey: input.hostMediaSyncStateRef.current.lastCaptureRefreshKey,
          forcedRefresh: true,
          captureMode: null,
          mediaEpoch: input.roomSnapshot?.room.playback.mediaEpoch ?? null,
          transportEpoch: input.mediaTransportEpochRef.current,
          publisherBootstrapRequestedAt: requestedAt,
          publisherBootstrapAttempts: attempt,
          summary: `房主定向补发实时音频协商，第 ${attempt} 次`
        });
        void input.syncHostMediaStreamRef.current({
          forceResync: true,
          reason: "listener-bootstrap"
        });
        for (const listenerPeerId of stableMissingListenerPeerIds) {
          void input.mediaMeshRef.current?.restartPublishingPeer(
            listenerPeerId,
            input.hostStreamRef.current
          );
        }
      }, delayMs)
    );

    return () => {
      for (const timerId of timerIds) {
        window.clearTimeout(timerId);
      }
    };
  }, [
    input.activeRouteRoomIdRef,
    input.audioUnlocked,
    input.hostMediaSyncStateRef,
    input.hostStreamRef,
    input.isCurrentSourceOwner,
    input.lastListenerBootstrapKeyRef,
    input.mediaConnectedPeers,
    input.mediaMeshRef,
    input.mediaTransportEpochRef,
    input.missingListenerSinceRef,
    input.peerId,
    input.roomListenerCount,
    input.roomListenerPeerIds,
    input.roomSnapshot?.room.id,
    input.roomSnapshot?.room.playback.mediaEpoch,
    input.roomSnapshot?.room.playback.status,
    input.sourceStartState,
    input.syncHostMediaStreamRef,
    input.updateHostCaptureDiagnostics
  ]);

  useEffect(() => {
    if (!input.roomSnapshot?.room.id || !input.peerId || !input.isCurrentSourceOwner) {
      input.lastHostCaptureRefreshAtRef.current = 0;
      return;
    }

    if (
      !input.audioUnlocked ||
      input.sourceStartState !== "live" ||
      input.roomSnapshot.room.playback.status !== "playing" ||
      !input.roomSnapshot.room.playback.currentTrackId
    ) {
      input.lastHostCaptureRefreshAtRef.current = 0;
      return;
    }

    if (input.roomListenerCount <= 0) {
      input.lastHostCaptureRefreshAtRef.current = 0;
      return;
    }

    const ensureHealthyHostCapture = () => {
      if (hasUsableHostMediaStreamTrack(input.hostStreamRef.current)) {
        return;
      }

      const now = Date.now();
      if (now - input.lastHostCaptureRefreshAtRef.current < hostCaptureRefreshCooldownMs) {
        return;
      }

      input.lastHostCaptureRefreshAtRef.current = now;
      void input.syncHostMediaStream({
        forceResync: true,
        reason: "capture-track-degraded"
      });
    };

    ensureHealthyHostCapture();
    const timerId = window.setInterval(
      ensureHealthyHostCapture,
      hostCaptureHealthCheckIntervalMs
    );

    return () => {
      window.clearInterval(timerId);
    };
  }, [
    input.audioUnlocked,
    input.isCurrentSourceOwner,
    input.lastHostCaptureRefreshAtRef,
    input.hostStreamRef,
    input.peerId,
    input.roomListenerCount,
    input.roomSnapshot?.room.id,
    input.roomSnapshot?.room.playback.currentTrackId,
    input.roomSnapshot?.room.playback.mediaEpoch,
    input.roomSnapshot?.room.playback.status,
    input.sourceStartState,
    input.syncHostMediaStream
  ]);
}
