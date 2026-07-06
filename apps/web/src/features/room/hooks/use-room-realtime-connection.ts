"use client";

import { useRoomRealtimeConnectionEffects } from "./room-realtime-effects";

export {
  buildRoomSubscribePayload,
  hasSubscribeBootstrapFullLocalTrack,
  isSocketDisconnectGraceActive,
  resolvePresenceRepairAction,
  resolveRecoveryWatchdogAction,
  resolveRoomRealtimeSnapshotInputs,
  resolveRoomSnapshotWatchdogAction,
  shouldAcceptIncomingPeerSignal,
  shouldExitRoomOnSnapshotMissing,
  shouldQueueIncomingAvailability,
  shouldReannounceManualCacheAvailability,
  shouldResyncSnapshotForPlaybackPatch,
  shouldSuppressPlaybackWatchdogEscalation
} from "./room-realtime-policy";
export {
  createRoomRealtimeRuntime,
  createRoomSocketRuntime
} from "./room-realtime-runtime";

export function useRoomRealtimeConnection(
  input: Parameters<typeof useRoomRealtimeConnectionEffects>[0]
) {
  return useRoomRealtimeConnectionEffects(input);
}