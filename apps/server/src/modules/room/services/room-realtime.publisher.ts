import { Injectable } from "@nestjs/common";
import type { PlaybackSnapshot, Playlist, RoomTrackDeletedPayload } from "@music-room/shared";
import { RoomService } from "../room.service";
import { RoomRealtimeBroadcaster } from "../../signaling/room-realtime.broadcaster";

@Injectable()
export class RoomRealtimePublisher {
  constructor(
    private readonly roomService: RoomService,
    private readonly roomRealtimeBroadcaster: RoomRealtimeBroadcaster
  ) {}

  async emitSnapshot(roomId: string, playlists: Playlist[] = []) {
    const snapshot = await this.roomService.getRoomSnapshot(roomId, playlists);
    this.roomRealtimeBroadcaster.emitRoomSnapshot(roomId, snapshot);
    return snapshot;
  }

  async emitTopologySnapshot(roomId: string, playlists: Playlist[] = []) {
    const snapshot = await this.roomService.getRoomSnapshot(roomId, playlists);
    this.roomRealtimeBroadcaster.emitPresencePatch(
      roomId,
      {
        members: snapshot.room.members,
        playback: snapshot.room.playback,
        presenceRevision: snapshot.room.presenceRevision,
        roomRevision: snapshot.room.roomRevision ?? 0
      }
    );
    return snapshot;
  }

  async emitQueueSnapshot(roomId: string, playlists: Playlist[] = []) {
    const snapshot = await this.roomService.getRoomSnapshot(roomId, playlists);
    this.roomRealtimeBroadcaster.emitQueuePatch(
      roomId,
      {
        queue: snapshot.queue,
        playback: snapshot.room.playback,
        roomRevision: snapshot.room.roomRevision ?? 0
      }
    );
    return snapshot;
  }

  async emitLibrarySnapshot(roomId: string, playlists: Playlist[] = []) {
    const snapshot = await this.roomService.getRoomSnapshot(roomId, playlists);
    this.roomRealtimeBroadcaster.emitLibraryPatch(
      roomId,
      {
        tracks: snapshot.tracks,
        queue: snapshot.queue,
        playback: snapshot.room.playback,
        roomRevision: snapshot.room.roomRevision ?? 0
      }
    );
    return snapshot;
  }

  emitPlaybackPatch(roomId: string, playback: PlaybackSnapshot) {
    this.roomRealtimeBroadcaster.emitPlaybackPatch(roomId, { playback });
  }

  emitRoomMissing(roomId: string) {
    this.roomRealtimeBroadcaster.emitRoomMissing(roomId);
  }

  emitRoomDeleted(roomId: string, trackIds: string[]) {
    this.roomRealtimeBroadcaster.emitRoomDeleted(roomId, trackIds);
  }

  emitTrackDeleted(roomId: string, payload: Omit<RoomTrackDeletedPayload, "roomId">) {
    this.roomRealtimeBroadcaster.emitTrackDeleted(roomId, payload);
  }

  emitMemberRemoved(roomId: string, memberId: string) {
    this.roomRealtimeBroadcaster.emitMemberRemoved(roomId, memberId);
  }
}
