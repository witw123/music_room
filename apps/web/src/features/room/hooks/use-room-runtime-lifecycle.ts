"use client";

import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { AuthSession, IceConfigResponse, RoomSnapshot } from "@music-room/shared";
import type { Route } from "next";
import { toUserFacingError } from "@/lib/music-room-ui";
import { musicRoomApi } from "@/lib/music-room-api";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import type { RoomSnapshotResyncReason } from "@/features/room/room-snapshot-resync";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import { testTurnConnectivity } from "@/features/p2p";
import { roomAudioOutput } from "@/features/playback/room-audio-output";

type RoomRouter = {
  push: (href: Route) => void;
  replace: (href: Route) => void;
};

export function shouldRedirectRoomRouteToAuth(input: {
  workspaceOnly: boolean;
  initialRoomId: string | null;
  hydrated: boolean;
  hasActiveSession: boolean;
  hasStoredSession: boolean;
  isNavigatingRoomExit: boolean;
  suppressRoomRecovery: boolean;
}) {
  return (
    input.workspaceOnly &&
    Boolean(input.initialRoomId) &&
    input.hydrated &&
    !input.hasActiveSession &&
    !input.hasStoredSession &&
    !input.isNavigatingRoomExit &&
    !input.suppressRoomRecovery
  );
}

export function shouldSuppressRoomRecoveryAfterFailure(input: {
  cancelled: boolean;
}) {
  return !input.cancelled;
}

export function resetInitialRoomRecoveryAttemptOnCancellation(input: {
  completed: boolean;
  recoveryKey: string;
  initialRecoveryAttemptRef: MutableRefObject<string | null> | { current: string | null };
}) {
  if (!input.completed && input.initialRecoveryAttemptRef.current === input.recoveryKey) {
    input.initialRecoveryAttemptRef.current = null;
  }
}

export function useRoomRuntimeLifecycle(input: {
  workspaceOnly: boolean;
  initialRoomId: string | null;
  hydrated: boolean;
  authEntryHref: string;
  router: RoomRouter;
  lastRoomStorageKey: string;
  peerStorageKey: string;
  activeSession: AuthSession | null;
  hasStoredSession: boolean;
  roomSnapshot: RoomSnapshot | null;
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  activeRouteRoomIdRef: MutableRefObject<string | null>;
  initialRecoveryAttemptRef: MutableRefObject<string | null>;
  previousInitialRoomIdRef: MutableRefObject<string | null>;
  resetPlayerSurfaceRef: MutableRefObject<() => void>;
  requestRoomSnapshotResync: (
    reason: RoomSnapshotResyncReason,
    roomId?: string | null
  ) => Promise<void>;
  emitPresence: () => void;
  peerId: string;
  setPeerId: Dispatch<SetStateAction<string>>;
  suppressRoomRecovery: boolean;
  setSuppressRoomRecovery: Dispatch<SetStateAction<boolean>>;
  setIsRecoveringRoom: Dispatch<SetStateAction<boolean>>;
  isNavigatingRoomExit: boolean;
  setIsNavigatingRoomExit: Dispatch<SetStateAction<boolean>>;
  setIceConfig: Dispatch<SetStateAction<IceConfigResponse | null>>;
  setIceConfigResolved: Dispatch<SetStateAction<boolean>>;
  setIsPageVisible: Dispatch<SetStateAction<boolean>>;
  setSchedulerMode: Dispatch<SetStateAction<"normal" | "conservative" | "idle">>;
  dispatchRoomStateEvent: Dispatch<RoomStateEvent>;
  deleteRoomTrackArtifacts: (trackIds: string[], roomId?: string, deleteRoomSnapshot?: boolean) => Promise<void> | void;
  recordPeerDiagnostic: PeerDiagnosticRecorder;
  refreshSession: () => Promise<unknown>;
  refreshAvailableRooms: () => Promise<void>;
  refreshPlaylists: () => Promise<void>;
  setStatusMessage: (value: string) => void;
}) {
  const {
    activeRouteRoomIdRef,
    activeSession,
    authEntryHref,
    currentRoomRef,
    dispatchRoomStateEvent,
    deleteRoomTrackArtifacts,
    emitPresence,
    hasStoredSession,
    hydrated,
    initialRecoveryAttemptRef,
    initialRoomId,
    isNavigatingRoomExit,
    lastRoomStorageKey,
    peerId,
    peerStorageKey,
    previousInitialRoomIdRef,
    recordPeerDiagnostic,
    refreshAvailableRooms,
    refreshPlaylists,
    refreshSession,
    requestRoomSnapshotResync,
    resetPlayerSurfaceRef,
    roomSnapshot,
    router,
    setIceConfig,
    setIceConfigResolved,
    setIsNavigatingRoomExit,
    setIsPageVisible,
    setIsRecoveringRoom,
    setPeerId,
    setSchedulerMode,
    setStatusMessage,
    setSuppressRoomRecovery,
    suppressRoomRecovery,
    workspaceOnly
  } = input;

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    void refreshSession();
  }, [activeSession, refreshSession]);

  useEffect(() => {
    if (
      !shouldRedirectRoomRouteToAuth({
        workspaceOnly,
        initialRoomId,
        hydrated,
        hasActiveSession: Boolean(activeSession),
        hasStoredSession,
        isNavigatingRoomExit,
        suppressRoomRecovery
      })
    ) {
      return;
    }

    router.replace(authEntryHref as Route);
  }, [
    workspaceOnly,
    initialRoomId,
    hydrated,
    activeSession,
    hasStoredSession,
    isNavigatingRoomExit,
    suppressRoomRecovery,
    router,
    authEntryHref
  ]);

  useEffect(() => {
    const storedPeerId = window.sessionStorage.getItem(peerStorageKey);
    if (storedPeerId) {
      setPeerId(storedPeerId);
      return;
    }

    const nextPeerId = `peer_${crypto.randomUUID()}`;
    window.sessionStorage.setItem(peerStorageKey, nextPeerId);
    setPeerId(nextPeerId);
  }, [peerStorageKey, setPeerId]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    void refreshAvailableRooms();
    void refreshPlaylists();
  }, [activeSession, refreshAvailableRooms, refreshPlaylists]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const nextVisible = !document.hidden;
      setIsPageVisible(nextVisible);
      if (nextVisible) {
        setSchedulerMode((current) => (current === "idle" ? "normal" : current));
        emitPresence();
        void requestRoomSnapshotResync(
          "visibility-visible",
          currentRoomRef.current?.room.id ?? null
        );
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [
    currentRoomRef,
    emitPresence,
    requestRoomSnapshotResync,
    setIsPageVisible,
    setSchedulerMode
  ]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !activeSession) {
      setIceConfig(null);
      setIceConfigResolved(false);
      return;
    }

    let cancelled = false;
    setIceConfigResolved(false);

    void (async () => {
      try {
        const nextIceConfig = await musicRoomApi.getIceConfig();
        if (cancelled) {
          return;
        }

        setIceConfig(nextIceConfig);
        setIceConfigResolved(true);
        recordPeerDiagnostic({
          peerId: "system",
          channelKind: "system",
          direction: "local",
          event: "ice-config",
          summary: `ICE 配置来源：${nextIceConfig.source}`,
          update: (snapshot) => ({
            ...snapshot,
            mediaConnectionState: nextIceConfig.source,
            iceConfigSource: nextIceConfig.source
          })
        });

        // Run TURN connectivity test in background — does not block setup.
        if (nextIceConfig.source !== "stun-only") {
          void testTurnConnectivity(nextIceConfig.iceServers).then((result) => {
            if (cancelled) return;
            const level: "info" | "warning" | "error" = result.reachable ? "info" : "error";
            recordPeerDiagnostic({
              peerId: "system",
              channelKind: "system",
              direction: "local",
              event: "turn-connectivity-test",
              level,
              summary: result.reachable
                ? `TURN 中继可达 · ${result.relayCandidates} relay / ${result.totalCandidates} total · ${result.gatherDurationMs}ms`
                : result.error === "no-turn-servers-configured"
                  ? "未配置 TURN 服务器"
                  : `TURN 中继不可达！${result.error ?? "无法收集 relay 候选"} · ${result.gatherDurationMs}ms · 请检查 coturn 是否运行、防火墙端口是否开放`,
              update: (snapshot) => ({
                ...snapshot,
                lastError: result.reachable
                  ? snapshot.lastError
                  : "TURN 中继服务器不可达，跨网络用户将无法同步播放。请检查服务器 TURN 端口是否开放。",
                iceConfigSource: result.reachable ? snapshot.iceConfigSource : "stun-only"
              })
            });
          });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        setIceConfig(null);
        setIceConfigResolved(true);
        recordPeerDiagnostic({
          peerId: "system",
          channelKind: "system",
          direction: "local",
          event: "ice-config-fallback",
          level: "warning",
          summary: `ICE 配置获取失败，已回退静态配置：${toUserFacingError(error)}`,
          update: (snapshot) => ({
            ...snapshot,
            lastError: toUserFacingError(error),
            iceConfigSource: "stun-only"
          })
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    roomSnapshot?.room.id,
    activeSession,
    setIceConfig,
    setIceConfigResolved,
    recordPeerDiagnostic
  ]);

  useEffect(() => {
    if (
      suppressRoomRecovery ||
      !workspaceOnly ||
      !initialRoomId ||
      !hydrated ||
      !activeSession ||
      isNavigatingRoomExit
    ) {
      return;
    }

    const recoveryKey = `${activeSession.userId}:${initialRoomId}`;
    if (initialRecoveryAttemptRef.current === recoveryKey) {
      return;
    }
    initialRecoveryAttemptRef.current = recoveryKey;

    let cancelled = false;
    let completed = false;
    setIsRecoveringRoom(true);

    void (async () => {
      try {
        const sync = await musicRoomApi.syncRoom(initialRoomId, 0);
        if (sync.roomDeleted) {
          await deleteRoomTrackArtifacts(
            sync.deletedTracks.map((track) => track.trackId),
            initialRoomId,
            true
          );
        }
        const snapshot = sync.roomDeleted ? null : sync.snapshot;
        if (!snapshot || cancelled) {
          if (!cancelled) {
            setSuppressRoomRecovery(true);
            setStatusMessage("未找到可恢复的房间状态，请返回音乐房重新创建或加入房间。");
            setIsRecoveringRoom(false);
          }
          return;
        }

        dispatchRoomStateEvent({
          type: "recover-snapshot",
          snapshot
        });
        setStatusMessage(`已进入房间 ${snapshot.room.joinCode}。`);
        await refreshPlaylists();
      } catch {
        if (shouldSuppressRoomRecoveryAfterFailure({ cancelled })) {
          setSuppressRoomRecovery(true);
          setStatusMessage("未找到可恢复的房间状态，请返回音乐房重新创建或加入房间。");
        }
      } finally {
        completed = true;
        if (!cancelled) {
          setIsRecoveringRoom(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      resetInitialRoomRecoveryAttemptOnCancellation({
        completed,
        recoveryKey,
        initialRecoveryAttemptRef
      });
    };
  }, [
    workspaceOnly,
    initialRoomId,
    hydrated,
    activeSession,
    suppressRoomRecovery,
    isNavigatingRoomExit,
    refreshPlaylists,
    dispatchRoomStateEvent,
    deleteRoomTrackArtifacts,
    setIsRecoveringRoom,
    setSuppressRoomRecovery,
    setStatusMessage,
    initialRecoveryAttemptRef
  ]);

  useEffect(() => {
    activeRouteRoomIdRef.current = initialRoomId;

    if (!workspaceOnly || !initialRoomId) {
      previousInitialRoomIdRef.current = initialRoomId;
      return;
    }

    if (previousInitialRoomIdRef.current === initialRoomId) {
      return;
    }

    previousInitialRoomIdRef.current = initialRoomId;
    initialRecoveryAttemptRef.current = null;
    setSuppressRoomRecovery(false);
    setIsRecoveringRoom(false);
    setIsNavigatingRoomExit(false);
    resetPlayerSurfaceRef.current();
    roomAudioOutput.releaseRoomAudioSession();

    if (roomSnapshot?.room.id && roomSnapshot.room.id !== initialRoomId) {
      dispatchRoomStateEvent({ type: "local-reset" });
    }
  }, [
    dispatchRoomStateEvent,
    workspaceOnly,
    initialRoomId,
    roomSnapshot?.room.id,
    setIsNavigatingRoomExit,
    setIsRecoveringRoom,
    setSuppressRoomRecovery,
    activeRouteRoomIdRef,
    previousInitialRoomIdRef,
    initialRecoveryAttemptRef,
    resetPlayerSurfaceRef
  ]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !peerId) {
      return;
    }

    window.localStorage.setItem(lastRoomStorageKey, roomSnapshot.room.id);
  }, [roomSnapshot?.room.id, peerId, lastRoomStorageKey]);
}
