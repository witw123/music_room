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

type RoomRouter = {
  push: (href: Route) => void;
  replace: (href: Route) => void;
};

export function shouldRedirectRoomRouteToAuth(input: {
  workspaceOnly: boolean;
  initialRoomId: string | null;
  hydrated: boolean;
  hasActiveSession: boolean;
  isNavigatingRoomExit: boolean;
  suppressRoomRecovery: boolean;
}) {
  return (
    input.workspaceOnly &&
    Boolean(input.initialRoomId) &&
    input.hydrated &&
    !input.hasActiveSession &&
    !input.isNavigatingRoomExit &&
    !input.suppressRoomRecovery
  );
}

export function shouldSuppressRoomRecoveryAfterFailure(input: {
  cancelled: boolean;
}) {
  return !input.cancelled;
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
  recordPeerDiagnostic: PeerDiagnosticRecorder;
  refreshSession: () => Promise<unknown>;
  refreshAvailableRooms: () => Promise<void>;
  refreshPlaylists: () => Promise<void>;
  setStatusMessage: (value: string) => void;
}) {
  useEffect(() => {
    if (!input.activeSession) {
      return;
    }

    void input.refreshSession();
  }, [input.activeSession, input.refreshSession]);

  useEffect(() => {
    if (
      !shouldRedirectRoomRouteToAuth({
        workspaceOnly: input.workspaceOnly,
        initialRoomId: input.initialRoomId,
        hydrated: input.hydrated,
        hasActiveSession: Boolean(input.activeSession),
        isNavigatingRoomExit: input.isNavigatingRoomExit,
        suppressRoomRecovery: input.suppressRoomRecovery
      })
    ) {
      return;
    }

    input.router.replace(input.authEntryHref as Route);
  }, [
    input.workspaceOnly,
    input.initialRoomId,
    input.hydrated,
    input.activeSession,
    input.isNavigatingRoomExit,
    input.suppressRoomRecovery,
    input.router,
    input.authEntryHref
  ]);

  useEffect(() => {
    const storedPeerId = window.sessionStorage.getItem(input.peerStorageKey);
    if (storedPeerId) {
      input.setPeerId(storedPeerId);
      return;
    }

    const nextPeerId = `peer_${crypto.randomUUID()}`;
    window.sessionStorage.setItem(input.peerStorageKey, nextPeerId);
    input.setPeerId(nextPeerId);
  }, [input.peerStorageKey, input.setPeerId]);

  useEffect(() => {
    if (!input.activeSession) {
      return;
    }

    void input.refreshAvailableRooms();
    void input.refreshPlaylists();
  }, [input.activeSession, input.refreshAvailableRooms, input.refreshPlaylists]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const nextVisible = !document.hidden;
      input.setIsPageVisible(nextVisible);
      if (nextVisible) {
        input.setSchedulerMode((current) => (current === "idle" ? "normal" : current));
        input.emitPresence();
        void input.requestRoomSnapshotResync(
          "visibility-visible",
          input.currentRoomRef.current?.room.id ?? null
        );
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [
    input.currentRoomRef,
    input.emitPresence,
    input.requestRoomSnapshotResync,
    input.setIsPageVisible,
    input.setSchedulerMode
  ]);

  useEffect(() => {
    if (!input.roomSnapshot?.room.id || !input.activeSession) {
      input.setIceConfig(null);
      input.setIceConfigResolved(false);
      return;
    }

    let cancelled = false;
    input.setIceConfigResolved(false);

    void (async () => {
      try {
        const nextIceConfig = await musicRoomApi.getIceConfig();
        if (cancelled) {
          return;
        }

        input.setIceConfig(nextIceConfig);
        input.setIceConfigResolved(true);
        input.recordPeerDiagnostic({
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
            input.recordPeerDiagnostic({
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

        input.setIceConfig(null);
        input.setIceConfigResolved(true);
        input.recordPeerDiagnostic({
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
    input.roomSnapshot?.room.id,
    input.activeSession?.userId,
    input.setIceConfig,
    input.setIceConfigResolved,
    input.recordPeerDiagnostic
  ]);

  useEffect(() => {
    if (
      input.suppressRoomRecovery ||
      !input.workspaceOnly ||
      !input.initialRoomId ||
      !input.hydrated ||
      !input.activeSession ||
      input.isNavigatingRoomExit
    ) {
      return;
    }

    const recoveryKey = `${input.activeSession.userId}:${input.initialRoomId}`;
    if (input.initialRecoveryAttemptRef.current === recoveryKey) {
      return;
    }
    input.initialRecoveryAttemptRef.current = recoveryKey;

    let cancelled = false;
    input.setIsRecoveringRoom(true);

    void (async () => {
      try {
        const snapshot = await musicRoomApi.recoverRoom(input.initialRoomId!);
        if (!snapshot || cancelled) {
          if (!cancelled) {
            input.setSuppressRoomRecovery(true);
            input.setStatusMessage("未找到可恢复的房间状态，请返回音乐房重新创建或加入房间。");
            input.setIsRecoveringRoom(false);
          }
          return;
        }

        input.dispatchRoomStateEvent({
          type: "recover-snapshot",
          snapshot
        });
        input.setStatusMessage(`已进入房间 ${snapshot.room.joinCode}。`);
        await input.refreshPlaylists();
      } catch {
        if (shouldSuppressRoomRecoveryAfterFailure({ cancelled })) {
          input.setSuppressRoomRecovery(true);
          input.setStatusMessage("未找到可恢复的房间状态，请返回音乐房重新创建或加入房间。");
        }
      } finally {
        if (!cancelled) {
          input.setIsRecoveringRoom(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    input.workspaceOnly,
    input.initialRoomId,
    input.hydrated,
    input.activeSession?.userId,
    input.suppressRoomRecovery,
    input.isNavigatingRoomExit,
    input.refreshPlaylists,
    input.dispatchRoomStateEvent,
    input.setIsRecoveringRoom,
    input.setSuppressRoomRecovery,
    input.setStatusMessage,
    input.initialRecoveryAttemptRef
  ]);

  useEffect(() => {
    input.activeRouteRoomIdRef.current = input.initialRoomId;

    if (!input.workspaceOnly || !input.initialRoomId) {
      input.previousInitialRoomIdRef.current = input.initialRoomId;
      return;
    }

    if (input.previousInitialRoomIdRef.current === input.initialRoomId) {
      return;
    }

    input.previousInitialRoomIdRef.current = input.initialRoomId;
    input.initialRecoveryAttemptRef.current = null;
    input.setSuppressRoomRecovery(false);
    input.setIsRecoveringRoom(false);
    input.setIsNavigatingRoomExit(false);
    input.resetPlayerSurfaceRef.current();

    if (input.roomSnapshot?.room.id && input.roomSnapshot.room.id !== input.initialRoomId) {
      input.dispatchRoomStateEvent({ type: "local-reset" });
    }
  }, [
    input.dispatchRoomStateEvent,
    input.workspaceOnly,
    input.initialRoomId,
    input.roomSnapshot?.room.id,
    input.setIsNavigatingRoomExit,
    input.setIsRecoveringRoom,
    input.setSuppressRoomRecovery,
    input.activeRouteRoomIdRef,
    input.previousInitialRoomIdRef,
    input.initialRecoveryAttemptRef,
    input.resetPlayerSurfaceRef
  ]);

  useEffect(() => {
    if (!input.roomSnapshot?.room.id || !input.peerId) {
      return;
    }

    window.localStorage.setItem(input.lastRoomStorageKey, input.roomSnapshot.room.id);
  }, [input.roomSnapshot?.room.id, input.peerId, input.lastRoomStorageKey]);
}
