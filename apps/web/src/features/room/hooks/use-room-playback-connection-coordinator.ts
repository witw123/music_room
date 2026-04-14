"use client";

import { useCallback, useRef, type MutableRefObject } from "react";
import type { RoomSnapshot } from "@music-room/shared";
import type {
  ListenerPlaybackState,
  PlaybackConnectionKey,
  PlaybackRecoveryAction,
  PlaybackRecoveryDropReason,
  PlaybackRecoveryRecommendation
} from "./room-runtime-types";

const defaultRecoveryActionTtlMs = 8_000;

function getRecoveryActionPriority(actionType: PlaybackRecoveryAction["actionType"]) {
  switch (actionType) {
    case "full-resubscribe":
      return 5;
    case "reset-listener-peer":
      return 4;
    case "restart-data-peer":
    case "restart-listener-ice":
      return 3;
    case "rebind-element":
      return 2;
    case "retry-play":
      return 1;
    default:
      return 0;
  }
}

export function resolvePlaybackConnectionKey(input: {
  roomId: string | null | undefined;
  sourcePeerId: string | null | undefined;
  mediaEpoch: number | null | undefined;
  transportEpoch: number | null | undefined;
}): PlaybackConnectionKey | null {
  if (!input.roomId || !input.sourcePeerId || typeof input.mediaEpoch !== "number") {
    return null;
  }

  return `${input.roomId}|${input.sourcePeerId}|${input.mediaEpoch}|${
    typeof input.transportEpoch === "number" ? input.transportEpoch : "none"
  }`;
}

export function resolvePlaybackRecoveryActionType(
  recommendation: PlaybackRecoveryRecommendation
): PlaybackRecoveryAction["actionType"] {
  if (recommendation.scope === "room" || recommendation.level === "full-resubscribe") {
    return "full-resubscribe";
  }

  if (recommendation.scope === "data") {
    return "restart-data-peer";
  }

  if (recommendation.level === "hard-recreate") {
    return "reset-listener-peer";
  }

  if (recommendation.level === "ice-restart") {
    return "restart-listener-ice";
  }

  return "retry-play";
}

export function resolvePlaybackRecoveryDropReason(input: {
  playbackConnectionKey: PlaybackConnectionKey | null;
  currentPlaybackConnectionKey: PlaybackConnectionKey | null;
  activeAction: PlaybackRecoveryAction | null;
  nextActionType: PlaybackRecoveryAction["actionType"];
  now?: number;
}): PlaybackRecoveryDropReason | null {
  if (!input.playbackConnectionKey || input.playbackConnectionKey !== input.currentPlaybackConnectionKey) {
    return "stale-connection-key";
  }

  const activeAction = input.activeAction;
  const now = input.now ?? Date.now();
  if (
    activeAction &&
    activeAction.playbackConnectionKey === input.playbackConnectionKey &&
    activeAction.result === "running" &&
    Date.parse(activeAction.expiresAt) > now &&
    getRecoveryActionPriority(activeAction.actionType) >= getRecoveryActionPriority(input.nextActionType)
  ) {
    return "lower-priority-running";
  }

  return null;
}

export function useRoomPlaybackConnectionCoordinator(input: {
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  mediaTransportEpochRef: MutableRefObject<number>;
  listenerMediaLifecycleRef: MutableRefObject<{
    traceKey: string | null;
    sourcePeerId: string | null;
    currentGeneration: string | null;
    boundGeneration: string | null;
    playingGeneration: string | null;
    latestStream: MediaStream | null;
    recoveryStage: string;
  }>;
  clearListenerMediaRecovery: () => void;
  clearRemotePlaybackRetry: () => void;
}) {
  const playbackConnectionKeyRef = useRef<PlaybackConnectionKey | null>(null);
  const listenerPlaybackStateRef = useRef<ListenerPlaybackState>("idle");
  const activeRecoveryActionRef = useRef<PlaybackRecoveryAction | null>(null);
  const activeRecoveryActionResultRef = useRef<PlaybackRecoveryAction["result"] | null>(null);
  const lastRecoveryRecommendationRef = useRef<
    (PlaybackRecoveryRecommendation & { recommendedAt: string }) | null
  >(null);
  const lastRecoveryDropReasonRef = useRef<PlaybackRecoveryDropReason | null>(null);
  const recoveryActionSequenceRef = useRef(0);

  const getCurrentPlaybackConnectionKey = useCallback(() => {
    const playback = input.currentRoomRef.current?.room.playback;
    return resolvePlaybackConnectionKey({
      roomId: input.currentRoomRef.current?.room.id ?? null,
      sourcePeerId: playback?.sourcePeerId ?? null,
      mediaEpoch: playback?.mediaEpoch ?? null,
      transportEpoch: input.mediaTransportEpochRef.current
    });
  }, [input.currentRoomRef, input.mediaTransportEpochRef]);

  const resetConnectionScopedRecovery = useCallback(() => {
    input.clearListenerMediaRecovery();
    input.clearRemotePlaybackRetry();
    activeRecoveryActionRef.current = null;
    activeRecoveryActionResultRef.current = null;
    lastRecoveryDropReasonRef.current = null;
  }, [input.clearListenerMediaRecovery, input.clearRemotePlaybackRetry]);

  const beginPlaybackConnection = useCallback(
    (
      key: PlaybackConnectionKey | null,
      context?: {
        sourcePeerId?: string | null;
        hasExistingBoundStream?: boolean;
      }
    ) => {
      if (playbackConnectionKeyRef.current === key) {
        return false;
      }

      resetConnectionScopedRecovery();
      playbackConnectionKeyRef.current = key;
      listenerPlaybackStateRef.current = key
        ? context?.hasExistingBoundStream
          ? "stream-bound"
          : "awaiting-offer"
        : "idle";
      input.listenerMediaLifecycleRef.current.sourcePeerId = context?.sourcePeerId ?? null;
      return true;
    },
    [input.listenerMediaLifecycleRef, resetConnectionScopedRecovery]
  );

  const disposePlaybackConnection = useCallback(
    (key?: PlaybackConnectionKey | null) => {
      if (typeof key !== "undefined" && key !== playbackConnectionKeyRef.current) {
        return false;
      }

      resetConnectionScopedRecovery();
      playbackConnectionKeyRef.current = null;
      listenerPlaybackStateRef.current = "idle";
      return true;
    },
    [resetConnectionScopedRecovery]
  );

  const reportPlaybackState = useCallback(
    (
      state: ListenerPlaybackState,
      options?: {
        playbackConnectionKey?: PlaybackConnectionKey | null;
      }
    ) => {
      const targetKey =
        typeof options?.playbackConnectionKey === "undefined"
          ? playbackConnectionKeyRef.current
          : options.playbackConnectionKey;
      if (targetKey !== playbackConnectionKeyRef.current) {
        return false;
      }

      listenerPlaybackStateRef.current = state;
      return true;
    },
    []
  );

  const applyRecoveryAction = useCallback(
    (inputAction: {
      playbackConnectionKey: PlaybackConnectionKey | null;
      actionType: PlaybackRecoveryAction["actionType"];
      peerId: string | null;
      reason: string;
      expiresInMs?: number;
    }) => {
      const now = Date.now();
      const dropReason = resolvePlaybackRecoveryDropReason({
        playbackConnectionKey: inputAction.playbackConnectionKey,
        currentPlaybackConnectionKey: playbackConnectionKeyRef.current,
        activeAction: activeRecoveryActionRef.current,
        nextActionType: inputAction.actionType,
        now
      });
      if (dropReason) {
        lastRecoveryDropReasonRef.current = dropReason;
        return null;
      }
      const playbackConnectionKey = inputAction.playbackConnectionKey as PlaybackConnectionKey;

      const action: PlaybackRecoveryAction = {
        actionId: `playback-recovery-${++recoveryActionSequenceRef.current}`,
        playbackConnectionKey,
        actionType: inputAction.actionType,
        peerId: inputAction.peerId,
        startedAt: new Date(now).toISOString(),
        expiresAt: new Date(
          now + (inputAction.expiresInMs ?? defaultRecoveryActionTtlMs)
        ).toISOString(),
        result: "running",
        reason: inputAction.reason
      };
      activeRecoveryActionRef.current = action;
      activeRecoveryActionResultRef.current = "running";
      lastRecoveryDropReasonRef.current = null;

      if (action.actionType === "retry-play" || action.actionType === "rebind-element") {
        listenerPlaybackStateRef.current = "recovering-soft";
      } else {
        listenerPlaybackStateRef.current = "recovering-hard";
      }

      return action;
    },
    []
  );

  const finishRecoveryAction = useCallback(
    (
      actionId: string,
      result: PlaybackRecoveryAction["result"],
      options?: {
        nextState?: ListenerPlaybackState;
      }
    ) => {
      const activeAction = activeRecoveryActionRef.current;
      if (!activeAction || activeAction.actionId !== actionId) {
        return false;
      }

      activeRecoveryActionRef.current = {
        ...activeAction,
        result
      };
      activeRecoveryActionResultRef.current = result;
      if (options?.nextState) {
        listenerPlaybackStateRef.current = options.nextState;
      }
      if (result !== "running") {
        activeRecoveryActionRef.current = null;
      }
      return true;
    },
    []
  );

  const noteRecoveryRecommendation = useCallback(
    (recommendation: PlaybackRecoveryRecommendation) => {
      lastRecoveryRecommendationRef.current = {
        ...recommendation,
        recommendedAt: new Date().toISOString()
      };
    },
    []
  );

  return {
    playbackConnectionKeyRef,
    listenerPlaybackStateRef,
    activeRecoveryActionRef,
    activeRecoveryActionResultRef,
    lastRecoveryRecommendationRef,
    lastRecoveryDropReasonRef,
    getCurrentPlaybackConnectionKey,
    beginPlaybackConnection,
    disposePlaybackConnection,
    reportPlaybackState,
    applyRecoveryAction,
    finishRecoveryAction,
    noteRecoveryRecommendation
  };
}
