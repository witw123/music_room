"use client";

import { useCallback, useReducer, type SetStateAction } from "react";

export type RoomPageState = {
  isDiagnosticsPanelOpen: boolean;
  isPageVisible: boolean;
  volume: number;
  schedulerPlaybackBucketMs: number;
  playerResetEpoch: number;
  audioBlockedOverlay: boolean;
};

type RoomPageStateKey = keyof RoomPageState;

type RoomPageStateAction = {
  [TKey in RoomPageStateKey]: {
    type: "set";
    key: TKey;
    value: SetStateAction<RoomPageState[TKey]>;
  };
}[RoomPageStateKey];

export function createInitialRoomPageState(input: { documentHidden: boolean }): RoomPageState {
  return {
    isDiagnosticsPanelOpen: false,
    isPageVisible: !input.documentHidden,
    volume: 0.72,
    schedulerPlaybackBucketMs: 0,
    playerResetEpoch: 0,
    audioBlockedOverlay: false
  };
}

function resolveSetStateAction<TValue>(current: TValue, value: SetStateAction<TValue>) {
  return typeof value === "function" ? (value as (current: TValue) => TValue)(current) : value;
}

export function roomPageStateReducer(
  state: RoomPageState,
  action: RoomPageStateAction
): RoomPageState {
  if (action.key === "isDiagnosticsPanelOpen") {
    const nextValue = resolveSetStateAction(state.isDiagnosticsPanelOpen, action.value);
    return nextValue === state.isDiagnosticsPanelOpen
      ? state
      : { ...state, isDiagnosticsPanelOpen: nextValue };
  }
  if (action.key === "isPageVisible") {
    const nextValue = resolveSetStateAction(state.isPageVisible, action.value);
    return nextValue === state.isPageVisible ? state : { ...state, isPageVisible: nextValue };
  }
  if (action.key === "volume") {
    const nextValue = resolveSetStateAction(state.volume, action.value);
    return nextValue === state.volume ? state : { ...state, volume: nextValue };
  }
  if (action.key === "schedulerPlaybackBucketMs") {
    const nextValue = resolveSetStateAction(state.schedulerPlaybackBucketMs, action.value);
    return nextValue === state.schedulerPlaybackBucketMs
      ? state
      : { ...state, schedulerPlaybackBucketMs: nextValue };
  }
  if (action.key === "playerResetEpoch") {
    const nextValue = resolveSetStateAction(state.playerResetEpoch, action.value);
    return nextValue === state.playerResetEpoch
      ? state
      : { ...state, playerResetEpoch: nextValue };
  }

  const nextValue = resolveSetStateAction(state.audioBlockedOverlay, action.value);
  return nextValue === state.audioBlockedOverlay
    ? state
    : { ...state, audioBlockedOverlay: nextValue };
}

export function useRoomPageState() {
  const [state, dispatch] = useReducer(
    roomPageStateReducer,
    undefined,
    () =>
      createInitialRoomPageState({
        documentHidden: typeof document !== "undefined" && document.hidden
      })
  );

  const setIsDiagnosticsPanelOpen = useCallback(
    (value: SetStateAction<boolean>) =>
      dispatch({ type: "set", key: "isDiagnosticsPanelOpen", value }),
    []
  );
  const setIsPageVisible = useCallback(
    (value: SetStateAction<boolean>) => dispatch({ type: "set", key: "isPageVisible", value }),
    []
  );
  const setVolume = useCallback(
    (value: SetStateAction<number>) => dispatch({ type: "set", key: "volume", value }),
    []
  );
  const setSchedulerPlaybackBucketMs = useCallback(
    (value: SetStateAction<number>) =>
      dispatch({ type: "set", key: "schedulerPlaybackBucketMs", value }),
    []
  );
  const setPlayerResetEpoch = useCallback(
    (value: SetStateAction<number>) => dispatch({ type: "set", key: "playerResetEpoch", value }),
    []
  );
  const setAudioBlockedOverlay = useCallback(
    (value: SetStateAction<boolean>) =>
      dispatch({ type: "set", key: "audioBlockedOverlay", value }),
    []
  );

  return {
    ...state,
    setIsDiagnosticsPanelOpen,
    setIsPageVisible,
    setVolume,
    setSchedulerPlaybackBucketMs,
    setPlayerResetEpoch,
    setAudioBlockedOverlay
  };
}
