import { create } from "zustand";

type RoomStoreState = {
  roomId?: string;
  setRoomId: (roomId: string) => void;
};

export const useRoomStore = create<RoomStoreState>((set) => ({
  roomId: undefined,
  setRoomId: (roomId) => set({ roomId })
}));

