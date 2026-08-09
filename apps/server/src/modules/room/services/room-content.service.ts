import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { QueueItem, RoomTrackDeletion, TrackMeta } from "@music-room/shared";
import type { RoomRecord } from "../room.types";
import {
  assertMember,
  assertPermission,
  incrementPlaybackRevision,
  incrementQueueVersion,
  incrementRoomRevision,
  maxAssetUnits,
  maxRoomQueueItems,
  maxRoomTracks,
  maxTrackDurationMs,
  maxTrackSizeBytes
} from "../room-mutation";
import { AuthService } from "../../auth/auth.service";
import { RoomPlaybackService } from "./room-playback.service";
import { RoomRecordRepository } from "../repositories/room-record.repository";

/**
 * Mutations of a room's library content: track registration/removal and the
 * playback queue (append, import, remove, reorder, next). All writes persist
 * through the shared room record repository and keep the shuffle bag in sync
 * with the queue.
 */
@Injectable()
export class RoomContentService {
  constructor(
    private readonly authService: AuthService,
    private readonly roomRecordRepository: RoomRecordRepository,
    private readonly roomPlaybackService: RoomPlaybackService
  ) {}

  async registerTrack(
    roomId: string,
    sessionId: string,
    input: Omit<TrackMeta, "id"> & { id?: string }
  ) {
    await this.authService.getUserOrThrow(sessionId);
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    assertMember(record, sessionId);
    assertPermission(record, sessionId, "library");
    this.assertTrackLimits(input);

    const track: TrackMeta = {
      ...input,
      ownerSessionId: sessionId,
      ownerNickname: (await this.authService.getUserOrThrow(sessionId)).nickname,
      id: input.id ?? `track_${randomUUID()}`
    };

    const duplicateByFileHashIndex = record.tracks.findIndex(
      (item) =>
        item.fileHash === track.fileHash &&
        item.ownerSessionId === track.ownerSessionId
    );
    const sourceRef = track.sourceType !== "local_upload" ? track.sourceRef : null;
    const duplicateBySourceIndex = sourceRef
      ? record.tracks.findIndex(
          (item) =>
            item.ownerSessionId === track.ownerSessionId &&
            item.sourceType !== "local_upload" &&
            item.sourceRef?.provider === sourceRef.provider &&
            item.sourceRef?.trackId === sourceRef.trackId
        )
      : -1;
    const existingIndex = record.tracks.findIndex((item) => item.id === track.id);

    if (duplicateByFileHashIndex >= 0) {
      const existingTrack = record.tracks[duplicateByFileHashIndex];
      record.tracks[duplicateByFileHashIndex] = {
        ...existingTrack,
        ...track,
        id: existingTrack.id
      };
      incrementRoomRevision(record.room);
      await this.roomRecordRepository.persistRecord(record);
      return record.tracks[duplicateByFileHashIndex];
    }

    if (duplicateBySourceIndex >= 0) {
      const existingTrack = record.tracks[duplicateBySourceIndex];
      record.tracks[duplicateBySourceIndex] = {
        ...existingTrack,
        ...track,
        id: existingTrack.id
      };
      incrementRoomRevision(record.room);
      await this.roomRecordRepository.persistRecord(record);
      return record.tracks[duplicateBySourceIndex];
    }

    if (existingIndex >= 0) {
      record.tracks[existingIndex] = track;
    } else {
      if (record.tracks.length >= maxRoomTracks) {
        throw new BadRequestException("房间曲目数量已达到上限。");
      }
      record.tracks.unshift(track);
    }

    incrementRoomRevision(record.room);
    await this.roomRecordRepository.persistRecord(record);
    return track;
  }

  async registerTracks(
    roomId: string,
    sessionId: string,
    inputs: Array<Omit<TrackMeta, "id"> & { id?: string }>
  ) {
    const user = await this.authService.getUserOrThrow(sessionId);
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    assertMember(record, sessionId);
    assertPermission(record, sessionId, "library");

    if (inputs.length === 0) {
      throw new BadRequestException("至少需要导入一首歌曲。");
    }
    const registered: TrackMeta[] = [];
    for (const input of inputs) {
      this.assertTrackLimits(input);
      const track: TrackMeta = {
        ...input,
        ownerSessionId: sessionId,
        ownerNickname: user.nickname,
        id: input.id ?? `track_${randomUUID()}`
      };
      const sourceRef = track.sourceType !== "local_upload" ? track.sourceRef : null;
      const existingIndex = record.tracks.findIndex(
        (item) =>
          item.id === track.id ||
          (item.ownerSessionId === sessionId && item.fileHash === track.fileHash) ||
          (!!sourceRef &&
            item.ownerSessionId === sessionId &&
            item.sourceType !== "local_upload" &&
            item.sourceRef?.provider === sourceRef.provider &&
            item.sourceRef?.trackId === sourceRef.trackId)
      );

      if (existingIndex >= 0) {
        const existingTrack = record.tracks[existingIndex];
        record.tracks[existingIndex] = { ...existingTrack, ...track, id: existingTrack.id };
        registered.push(record.tracks[existingIndex]);
      } else {
        if (record.tracks.length >= maxRoomTracks) {
          throw new BadRequestException("房间曲目数量已达到上限。");
        }
        record.tracks.unshift(track);
        registered.push(track);
      }
    }

    incrementRoomRevision(record.room);
    await this.roomRecordRepository.persistRecord(record);
    return registered;
  }

  async removeTrack(roomId: string, sessionId: string, trackId: string) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    assertMember(record, sessionId);
    assertPermission(record, sessionId, "library");

    const track = record.tracks.find((item) => item.id === trackId);
    if (!track) {
      throw new Error(`Track not found in room: ${trackId}`);
    }

    if (track.ownerSessionId !== sessionId && record.room.hostId !== sessionId) {
      throw new Error("Only the original uploader can delete this track.");
    }

    this.removeTracksById(record, new Set([trackId]));
    incrementRoomRevision(record.room);
    await this.roomRecordRepository.persistRecord(record);
    const deletion: RoomTrackDeletion = {
      roomId,
      trackId,
      fileHash: track.fileHash,
      originalAssetId: track.originalAsset?.assetId ?? null,
      playbackAssetId: track.playbackAsset?.assetId ?? null,
      roomRevision: record.room.roomRevision ?? 0,
      deletedAt: new Date().toISOString()
    };
    await this.roomRecordRepository.recordTrackDeletion(deletion).catch(() => undefined);
    return { ok: true };
  }

  async addQueueItem(roomId: string, sessionId: string, trackId: string) {
    const session = await this.authService.getUserOrThrow(sessionId);
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    assertMember(record, sessionId);
    assertPermission(record, sessionId, "queue");

    if (record.queue.length >= maxRoomQueueItems) {
      throw new BadRequestException("房间播放队列已达到上限。");
    }

    if (!record.tracks.some((track) => track.id === trackId)) {
      throw new Error(`Track not found in room: ${trackId}`);
    }

    const queueItem: QueueItem = {
      id: `queue_${randomUUID()}`,
      trackId,
      requestedBy: session.nickname,
      requestedById: session.id,
      position: record.queue.length,
      createdAt: new Date().toISOString()
    };

    record.queue.push(queueItem);
    this.roomPlaybackService.syncShuffleBagWithQueue(record);
    incrementQueueVersion(record.room.playback);
    incrementRoomRevision(record.room);
    await this.roomRecordRepository.persistRecord(record);

    return queueItem;
  }

  async importPlaylistToQueue(roomId: string, sessionId: string, trackIds: string[]) {
    const session = await this.authService.getUserOrThrow(sessionId);
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    assertMember(record, sessionId);
    assertPermission(record, sessionId, "queue");

    const validTrackIds = trackIds.filter((trackId) =>
      record.tracks.some((track) => track.id === trackId)
    );

    if (validTrackIds.length === 0) {
      throw new Error("No tracks from this playlist are available in the current room.");
    }

    if (record.queue.length + validTrackIds.length > maxRoomQueueItems) {
      throw new BadRequestException("导入后房间播放队列将超过上限。");
    }

    const nextItems = validTrackIds.map(
      (trackId, offset): QueueItem => ({
        id: `queue_${randomUUID()}`,
        trackId,
        requestedBy: session.nickname,
        requestedById: session.id,
        position: record.queue.length + offset,
        createdAt: new Date().toISOString()
      })
    );

    record.queue.push(...nextItems);
    this.roomPlaybackService.syncShuffleBagWithQueue(record);
    incrementQueueVersion(record.room.playback);
    incrementRoomRevision(record.room);
    await this.roomRecordRepository.persistRecord(record);
    return record.queue;
  }

  async removeQueueItem(roomId: string, queueItemId: string, actorSessionId: string) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    assertMember(record, actorSessionId);
    assertPermission(record, actorSessionId, "queue");
    const removed = record.queue.find((item) => item.id === queueItemId);

    if (!removed) {
      return record.queue;
    }

    const nextQueue = record.queue
      .filter((item) => item.id !== queueItemId)
      .map((item, index) => ({ ...item, position: index }));

    const playback = record.room.playback;
    const removesCurrentQueueItem = playback.currentQueueItemId === removed.id;
    const removesNextQueueItem = playback.nextQueueItemId === removed.id;
    const removesDirectlyPlayingTrack =
      playback.currentQueueItemId === null && playback.currentTrackId === removed.trackId;

    if (removesCurrentQueueItem || removesDirectlyPlayingTrack) {
      record.queue = nextQueue;
      this.roomPlaybackService.clearPlayback(playback);
      this.roomPlaybackService.syncShuffleBagWithQueue(record);
      incrementQueueVersion(playback);
      incrementRoomRevision(record.room);
      await this.roomRecordRepository.persistRecord(record);
      return record.queue;
    }

    record.queue = nextQueue;
    if (removesNextQueueItem) {
      playback.nextQueueItemId = null;
    }
    this.roomPlaybackService.syncShuffleBagWithQueue(record);
    incrementQueueVersion(record.room.playback);
    incrementRoomRevision(record.room);
    await this.roomRecordRepository.persistRecord(record);
    return record.queue;
  }

  async setNextQueueItem(roomId: string, actorSessionId: string, queueItemId: string) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    assertMember(record, actorSessionId);
    assertPermission(record, actorSessionId, "player");

    const queueItem = record.queue.find((item) => item.id === queueItemId);
    if (!queueItem) {
      throw new Error("Queue item not found in this room.");
    }
    if (record.room.playback.currentQueueItemId === queueItemId) {
      throw new Error("The current queue item is already playing.");
    }

    record.room.playback.nextQueueItemId = queueItemId;
    incrementPlaybackRevision(record.room.playback);
    incrementRoomRevision(record.room);
    await this.roomRecordRepository.persistRecord(record);
    return record.room.playback;
  }

  async reorderQueue(roomId: string, actorSessionId: string, queueItemIds: string[]) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    assertMember(record, actorSessionId);
    assertPermission(record, actorSessionId, "queue");

    const existingIds = record.queue.map((item) => item.id);
    if (
      queueItemIds.length !== existingIds.length ||
      queueItemIds.some((id) => !existingIds.includes(id))
    ) {
      throw new Error("Queue reorder payload does not match the current room queue.");
    }

    const nextQueue = queueItemIds
      .map((queueItemId) => record.queue.find((item) => item.id === queueItemId))
      .filter((item): item is QueueItem => !!item)
      .map((item, index) => ({
        ...item,
        position: index
      }));

    record.queue = nextQueue;
    this.roomPlaybackService.syncShuffleBagWithQueue(record);
    incrementQueueVersion(record.room.playback);
    incrementRoomRevision(record.room);
    await this.roomRecordRepository.persistRecord(record);
    return record.queue;
  }

  private removeTracksById(record: RoomRecord, trackIds: Set<string>) {
    if (trackIds.size === 0) {
      return;
    }

    const previousQueueLength = record.queue.length;
    record.tracks = record.tracks.filter((item) => !trackIds.has(item.id));
    record.queue = record.queue
      .filter((item) => !trackIds.has(item.trackId))
      .map((item, index) => ({ ...item, position: index }));
    if (record.room.playback.nextQueueItemId) {
      const nextQueueItem = record.queue.find(
        (item) => item.id === record.room.playback.nextQueueItemId
      );
      if (!nextQueueItem) {
        record.room.playback.nextQueueItemId = null;
      }
    }
    this.roomPlaybackService.syncShuffleBagWithQueue(record);

    if (
      record.room.playback.currentTrackId &&
      trackIds.has(record.room.playback.currentTrackId)
    ) {
      this.roomPlaybackService.clearPlayback(record.room.playback);
    }

    if (record.queue.length !== previousQueueLength) {
      incrementQueueVersion(record.room.playback);
    }
  }

  private assertTrackLimits(input: Omit<TrackMeta, "id"> & { id?: string }) {
    if (input.durationMs > maxTrackDurationMs) {
      throw new BadRequestException("曲目时长超过允许的最大值。");
    }
    if (input.sizeBytes !== null && input.sizeBytes !== undefined && input.sizeBytes > maxTrackSizeBytes) {
      throw new BadRequestException("曲目文件超过允许的最大大小。");
    }

    const manifests = [input.originalAsset, input.playbackAsset].filter(Boolean);
    if (manifests.some((manifest) => manifest && manifest.unitCount > maxAssetUnits)) {
      throw new BadRequestException("音频资源分片数量超过允许的最大值。");
    }
    if (input.playbackAsset && input.playbackAsset.durationMs > maxTrackDurationMs) {
      throw new BadRequestException("播放资源时长超过允许的最大值。");
    }
    if (input.originalAsset && input.originalAsset.sizeBytes > maxTrackSizeBytes) {
      throw new BadRequestException("原始音频资源超过允许的最大大小。");
    }
  }
}
