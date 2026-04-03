"use client";

import type { RoomSnapshot } from "@music-room/shared";

const roomSnapshotHandoffStorageKey = "music-room-pending-room-snapshot";
const roomSnapshotHandoffTtlMs = 60_000;

type RoomSnapshotHandoffPayload = {
  roomId: string;
  snapshot: RoomSnapshot;
  savedAt: number;
};

export function storeRoomSnapshotHandoff(snapshot: RoomSnapshot) {
  if (typeof window === "undefined") {
    return;
  }

  const payload: RoomSnapshotHandoffPayload = {
    roomId: snapshot.room.id,
    snapshot,
    savedAt: Date.now()
  };

  window.sessionStorage.setItem(roomSnapshotHandoffStorageKey, JSON.stringify(payload));
}

export function consumeRoomSnapshotHandoff(roomId: string) {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(roomSnapshotHandoffStorageKey);
  if (!raw) {
    return null;
  }

  try {
    const payload = JSON.parse(raw) as Partial<RoomSnapshotHandoffPayload>;
    const isExpired =
      typeof payload.savedAt === "number" &&
      Date.now() - payload.savedAt > roomSnapshotHandoffTtlMs;

    if (isExpired) {
      window.sessionStorage.removeItem(roomSnapshotHandoffStorageKey);
      return null;
    }

    if (payload.roomId !== roomId || !payload.snapshot) {
      return null;
    }

    window.sessionStorage.removeItem(roomSnapshotHandoffStorageKey);
    return payload.snapshot;
  } catch {
    window.sessionStorage.removeItem(roomSnapshotHandoffStorageKey);
    return null;
  }
}
