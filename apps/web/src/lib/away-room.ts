export const awayRoomStorageKey = "music-room-away-room";
export const awayRoomChangeEvent = "music-room-away-room-change";

export function readAwayRoomId() {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(awayRoomStorageKey);
}

export function storeAwayRoomId(roomId: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(awayRoomStorageKey, roomId);
  window.dispatchEvent(new Event(awayRoomChangeEvent));
}

export function clearAwayRoomId() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(awayRoomStorageKey);
  window.dispatchEvent(new Event(awayRoomChangeEvent));
}
