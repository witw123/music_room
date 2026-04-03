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
    const presenceSnapshot = await this.roomPresenceService.getPresenceSnapshot(
      record.room.id,
      record.room.members
    );
    const activePresence = new Map(
      [...presenceSnapshot.entries()]
        .filter(([, presence]) => presence.presenceState === "online" && !!presence.peerId)
        .map(([memberId, presence]) => [memberId, presence.peerId as string])
    );
    const members = record.room.members.map((member) => {
      const presence = presenceSnapshot.get(member.id);
      return {
        ...member,
        peerId: presence?.peerId ?? null,
        presenceState: presence?.presenceState ?? "offline"
      };
    });

    return {
      room: {
        ...record.room,
        playback: await this.roomPlaybackService.buildPlaybackForSnapshot(record, activePresence),
        members
      },
      tracks: record.tracks,
      queue: record.queue,
      playlists
    };
  }
}
