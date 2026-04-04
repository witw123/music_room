import type { RoomSnapshot } from "@music-room/shared";

export type RoomSnapshotResyncReason =
  | "socket-connect"
  | "subscribe-ack"
  | "visibility-visible"
  | "realtime-room-event"
  | "stale-watchdog";

type RoomSnapshotResyncControllerOptions = {
  loadSnapshot: (roomId: string) => Promise<RoomSnapshot>;
  applySnapshot: (
    roomId: string,
    snapshot: RoomSnapshot,
    reason: RoomSnapshotResyncReason
  ) => void | Promise<void>;
  onError: (
    roomId: string,
    reason: RoomSnapshotResyncReason,
    error: unknown
  ) => void | Promise<void>;
};

export function createRoomSnapshotResyncController(
  options: RoomSnapshotResyncControllerOptions
) {
  let activeRequestToken = 0;
  let inFlightRoomId: string | null = null;
  let inFlightPromise: Promise<void> | null = null;

  return {
    async request(roomId: string, reason: RoomSnapshotResyncReason) {
      if (!roomId) {
        return;
      }

      if (inFlightPromise && inFlightRoomId === roomId) {
        return inFlightPromise;
      }

      const requestToken = ++activeRequestToken;
      inFlightRoomId = roomId;
      inFlightPromise = (async () => {
        try {
          const snapshot = await options.loadSnapshot(roomId);
          if (requestToken !== activeRequestToken) {
            return;
          }

          await options.applySnapshot(roomId, snapshot, reason);
        } catch (error) {
          if (requestToken !== activeRequestToken) {
            return;
          }

          await options.onError(roomId, reason, error);
        } finally {
          if (requestToken === activeRequestToken) {
            inFlightRoomId = null;
            inFlightPromise = null;
          }
        }
      })();

      return inFlightPromise;
    },

    reset() {
      activeRequestToken += 1;
      inFlightRoomId = null;
      inFlightPromise = null;
    }
  };
}
