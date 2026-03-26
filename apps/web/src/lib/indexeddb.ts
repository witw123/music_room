import Dexie from "dexie";

export class MusicRoomDatabase extends Dexie {
  constructor() {
    super("music-room");
    this.version(1).stores({
      trackPieces: "&pieceId, trackId, peerId, createdAt"
    });
  }
}

export const musicRoomDatabase = new MusicRoomDatabase();

