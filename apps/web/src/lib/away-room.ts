export const awayRoomStorageKey = "music-room-away-room";

export function readAwayRoomId() {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(awayRoomStorageKey);
}

export function storeAwayRoomId(roomId: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(awayRoomStorageKey, roomId);
}

export function clearAwayRoomId() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(awayRoomStorageKey);
}
