import { useRoomStore } from "@/stores/room-store";

export function useRoomSession() {
  return useRoomStore();
}

