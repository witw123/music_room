import type { Playlist, RoomSnapshot } from "@music-room/shared";
import type { RoomRecord } from "../room.types";
import { RoomPlaybackService } from "./room-playback.service";
import { RoomPresenceService } from "./room-presence.service";

export class RoomSnapshotService {
  constructor(
    private readonly roomPresenceService: RoomPresenceService,
    private readonly roomPlaybackService: RoomPlaybackService
  ) {}

  async buildSnapshot(record: RoomRecord, playlists: Playlist[]): Promise<RoomSnapshot> {
    const activePresence = await this.roomPresenceService.getActivePresence(
      record.room.id,
      record.room.members
    );
    const activeMembers = record.room.members
      .map((member) => ({
        ...member,
        peerId: activePresence.get(member.id) ?? null
      }))
      .filter((member) => !!member.peerId);

    return {
      room: {
        ...record.room,
        playback: await this.roomPlaybackService.buildPlaybackForSnapshot(record),
        members: activeMembers
      },
      tracks: record.tracks,
      queue: record.queue,
      playlists
    };
  }
}
