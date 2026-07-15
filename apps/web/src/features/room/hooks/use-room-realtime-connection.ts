"use client";

import { useRoomRealtimeConnectionEffects } from "./room-realtime-effects";

export {
  buildRoomSubscribePayload,
  createRoomRealtimeEventGate,
  isSocketDisconnectGraceActive,
  resolvePresenceRepairAction,
  resolveRemoteAvailabilityRequestTrackId,
  resolveRecoveryWatchdogAction,
  resolveRoomRealtimeSnapshotInputs,
  resolveRoomSnapshotWatchdogAction,
  resolveSourceAvailabilityReannounceTrackId,
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
