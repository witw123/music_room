"use client";

import type { RoomMediaClockPayload } from "@music-room/shared";

export type ReceivedRoomMediaClock = RoomMediaClockPayload & {
  receivedAtMs: number;
};

export function getRoomMediaClockProgressMs(
  clock: ReceivedRoomMediaClock | null | undefined,
  now = Date.now()
) {
  if (!clock) {
    return null;
  }

  const elapsedMs = Math.max(0, now - clock.receivedAtMs);
  const advancing = clock.playoutState === "playing" ? true : clock.advancing;
  if (!advancing) {
    return clock.mediaTimeMs;
  }

  return Math.max(0, Math.round(clock.mediaTimeMs + elapsedMs * clock.playbackRate));
}
