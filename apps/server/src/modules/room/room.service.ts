import { Injectable, Optional } from "@nestjs/common";
import type {
  PlaybackSnapshot,
  Playlist,
  RoomDirectoryItem,
  RoomMember,
  RoomSnapshot,
  RoomSyncResponse
} from "@music-room/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";
import { AuthService } from "../auth/auth.service";
import { type RoomRecord } from "./room.types";
import { assertMember, assertPermission, incrementRoomRevision } from "./room-mutation";
import { RoomRecordRepository } from "./repositories/room-record.repository";
import { realtimePresenceTtlSeconds, RoomPresenceService } from "./services/room-presence.service";
import { RoomPlaybackService } from "./services/room-playback.service";
import { RoomSnapshotService } from "./services/room-snapshot.service";
import { RoomActivityService } from "./services/room-activity.service";
import { RoomPresenceOrchestratorService } from "./services/room-presence-orchestrator.service";
import { RoomContentService } from "./services/room-content.service";
import { RoomLifecycleService } from "./services/room-lifecycle.service";

/**
 * Room domain facade: room queries, snapshot building and playback
 * orchestration stay here; lifecycle/membership, library content and presence
 * transitions are delegated to focused services so the room module keeps one
 * entry point for its REST/signaling consumers.
 */
@Injectable()
export class RoomService {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly roomCacheTtlSeconds = 60 * 60 * 12;
  private readonly sessionRecentRoomTtlSeconds = 60 * 60 * 24 * 7;
  // Background tabs may have their timers coalesced into roughly one-minute
  // ticks. Keep a few missed ticks from turning a still-connected room member
  // offline; an actual socket disconnect still transitions through the
  // signaling gateway's reconnect/offline cleanup path.
  private readonly presenceTtlSeconds = realtimePresenceTtlSeconds;
  private readonly roomRegistryKey = "music-room:rooms";
  private readonly inMemoryPresence = new Map<
    string,
    Map<
      string,
      {
        peerId: string | null;
        presenceState: RoomMember["presenceState"];
        expiresAt: number;
      }
    >
  >();
  private readonly roomRecordRepository: RoomRecordRepository;
  private readonly roomPresenceService: RoomPresenceService;
  private readonly roomPlaybackService: RoomPlaybackService;
  private readonly roomSnapshotService: RoomSnapshotService;
  private readonly roomActivityService: RoomActivityService;
  private readonly presenceOrchestrator: RoomPresenceOrchestratorService;
  private readonly contentService: RoomContentService;
  private readonly lifecycleService: RoomLifecycleService;

  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Optional()
    roomRecordRepository?: RoomRecordRepository,
    @Optional()
    roomPresenceService?: RoomPresenceService,
    @Optional()
    roomPlaybackService?: RoomPlaybackService,
    @Optional()
    roomSnapshotService?: RoomSnapshotService,
    @Optional()
    roomActivityService?: RoomActivityService,
    @Optional()
    presenceOrchestrator?: RoomPresenceOrchestratorService,
    @Optional()
    contentService?: RoomContentService,
    @Optional()
    lifecycleService?: RoomLifecycleService
  ) {
    const hasProductionDependencies =
      !!roomRecordRepository &&
      !!roomPresenceService &&
      !!roomPlaybackService &&
      !!roomSnapshotService &&
      !!roomActivityService &&
      !!presenceOrchestrator &&
      !!contentService &&
      !!lifecycleService;
    if (!hasProductionDependencies && process.env.NODE_ENV !== "test") {
      throw new Error("RoomService must be created by RoomCoreModule.");
    }

    // Direct construction is retained only for unit tests. Production always
    // receives the complete provider graph from RoomCoreModule, so a missing
    // provider cannot silently create a second state model.
    this.roomRecordRepository =
      roomRecordRepository ??
      new RoomRecordRepository(
        this.rooms,
        prisma,
        redis,
        this.roomRegistryKey,
        this.roomCacheTtlSeconds,
        this.sessionRecentRoomTtlSeconds
      );
    this.roomPresenceService =
      roomPresenceService ??
      new RoomPresenceService(redis, this.inMemoryPresence, this.presenceTtlSeconds);
    this.roomPlaybackService =
      roomPlaybackService ?? new RoomPlaybackService(this.roomPresenceService);
    this.roomSnapshotService =
      roomSnapshotService ??
      new RoomSnapshotService(this.roomPresenceService, this.roomPlaybackService);
    this.roomActivityService = roomActivityService ?? new RoomActivityService(prisma);
    this.presenceOrchestrator =
      presenceOrchestrator ??
      new RoomPresenceOrchestratorService(
        this.roomRecordRepository,
        this.roomPresenceService,
        this.roomPlaybackService,
        this.roomActivityService,
        this.redis
      );
    this.contentService =
      contentService ??
      new RoomContentService(this.authService, this.roomRecordRepository, this.roomPlaybackService);
    this.lifecycleService =
      lifecycleService ??
      new RoomLifecycleService(
        this.authService,
        this.roomRecordRepository,
        this.roomPresenceService,
        this.roomPlaybackService,
        this.roomActivityService,
        this.roomSnapshotService,
        this.presenceOrchestrator
      );
  }

  async findRoomByJoinCode(joinCode: string) {
    return this.roomRecordRepository.findByJoinCode(joinCode);
  }

  async getRoomSnapshot(roomId: string, playlists: Playlist[]): Promise<RoomSnapshot> {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    return this.roomSnapshotService.buildSnapshot(record, playlists);
  }

  async getAccessibleRoomSnapshot(
    roomId: string,
    playlists: Playlist[],
    sessionId?: string
  ): Promise<RoomSnapshot> {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    const isMember =
      !!sessionId &&
      (record.room.hostId === sessionId ||
        record.room.members.some((member) => member.id === sessionId));

    if (!isMember && record.room.visibility !== "public") {
      throw new Error("Room not found.");
    }

    if (isMember && sessionId) {
      await this.roomRecordRepository.setRecentRoomForSession(sessionId, roomId);
    }

    return this.roomSnapshotService.buildSnapshot(record, playlists);
  }

  async syncRoom(
    roomId: string,
    sessionId: string,
    sinceRevision = 0
  ): Promise<RoomSyncResponse> {
    const termination = await this.roomRecordRepository.getRoomTermination(roomId);
    if (termination) {
      const deletedAt = new Date().toISOString();
      return {
        roomId,
        roomDeleted: true,
        roomRevision: 0,
        snapshot: null,
        deletedTracks: termination.trackIds.map((trackId) => ({
          roomId,
          trackId,
          fileHash: null,
          originalAssetId: null,
          playbackAssetId: null,
          roomRevision: 0,
          deletedAt
        }))
      };
    }

    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    const isMember =
      record.room.hostId === sessionId ||
      record.room.members.some((member) => member.id === sessionId);
    if (!isMember && record.room.visibility !== "public") {
      throw new Error("Room not found.");
    }

    const snapshot = await this.roomSnapshotService.buildSnapshot(record, []);
    const deletedTracks = await this.roomRecordRepository.listTrackDeletions(
      roomId,
      Math.max(0, Math.floor(sinceRevision))
    );
    return {
      roomId,
      roomDeleted: false,
      roomRevision: snapshot.room.roomRevision ?? 0,
      snapshot,
      deletedTracks
    };
  }

  async listRoomsForSession(sessionId: string): Promise<RoomSnapshot[]> {
    const records = await this.roomRecordRepository.listRecoverableRecords();

    const accessibleRecords = records.filter(
      (record: RoomRecord) =>
        record.room.hostId === sessionId ||
        record.room.members.some((member: RoomMember) => member.id === sessionId)
    );

    return Promise.all(
      accessibleRecords.map((record: RoomRecord) => this.roomSnapshotService.buildSnapshot(record, []))
    );
  }

  async listRecentRoomSnapshotsForSession(sessionId: string): Promise<RoomSnapshot[]> {
    const rooms = await this.listRoomsForSession(sessionId);
    return rooms.sort((left, right) => {
      const leftJoinedAt = left.room.members.find((member) => member.id === sessionId)?.joinedAt ?? "";
      const rightJoinedAt = right.room.members.find((member) => member.id === sessionId)?.joinedAt ?? "";
      return new Date(rightJoinedAt).getTime() - new Date(leftJoinedAt).getTime();
    });
  }

  async listRoomActivitiesForSession(sessionId: string) {
    return this.roomActivityService.listRecent(sessionId);
  }

  async listPublicRooms(): Promise<RoomSnapshot[]> {
    const records = await this.roomRecordRepository.listRecoverableRecords();
    const publicRecords = records.filter((record) => record.room.visibility === "public");
    const snapshots = await Promise.all(
      publicRecords.map((record) => this.roomSnapshotService.buildSnapshot(record, []))
    );
    return snapshots;
  }

  async listRoomDirectoryForSession(sessionId: string): Promise<RoomDirectoryItem[]> {
    const records = await this.roomRecordRepository.listRecoverableRecords();
    const accessible = records
      .filter((record) =>
        record.room.visibility === "public" ||
        record.room.hostId === sessionId ||
        record.room.members.some((member) => member.id === sessionId)
      )
      .slice(0, 100);

    return Promise.all(accessible.map(async (record) => {
      const snapshot = await this.roomSnapshotService.buildSnapshot(record, []);
      const isMember =
        record.room.hostId === sessionId ||
        record.room.members.some((member) => member.id === sessionId);
      const host = snapshot.room.members.find((member) => member.id === snapshot.room.hostId);
      const onlineMemberCount = snapshot.room.members.filter(
        (member) => member.presenceState === "online" && !!member.peerId
      ).length;

      return {
        room: {
          id: snapshot.room.id,
          // Directory consumers only need a join target and display metadata.
          // Do not expose user ids, live peer ids, or playback asset ids here.
          hostId: "",
          joinCode: snapshot.room.joinCode,
          name: snapshot.room.name,
          description: snapshot.room.description,
          hasPassword: snapshot.room.hasPassword,
          visibility: snapshot.room.visibility,
          members: [],
          directoryHostNickname: host?.nickname ?? "",
          directoryMemberCount: record.room.members.length,
          directoryOnlineMemberCount: onlineMemberCount,
          directoryIsMember: isMember,
          presenceRevision: 0,
          roomRevision: 0,
          playback: {
            ...snapshot.room.playback,
            currentTrackId: null,
            currentQueueItemId: null,
            playbackAssetId: null,
            startAt: null,
            sourceSessionId: null,
            sourcePeerId: null,
            sourceTrackId: null,
            positionMs: 0,
            startedAt: null,
            shuffleBagTrackIds: [],
            nextQueueItemId: null,
            gaplessNext: null
          }
        },
        tracks: [],
        queue: [],
        playlists: []
      };
    }));
  }

  async getRecentRoomSnapshotForSession(sessionId: string): Promise<RoomSnapshot | null> {
    const roomId = await this.redis.getString(this.roomRecordRepository.sessionRecentRoomKey(sessionId));

    if (roomId) {
      const snapshot = await this.getRecoverableRoomSnapshot(roomId, sessionId).catch(() => null);
      if (snapshot) {
        return snapshot;
      }

      try {
        await this.redis.delete(this.roomRecordRepository.sessionRecentRoomKey(sessionId));
      } catch {
        // Ignore cache cleanup failures and continue with the accessible-room fallback.
      }
    }

    const rooms = await this.listRoomsForSession(sessionId);
    return rooms[0] ?? null;
  }

  async getRecoverableRoomSnapshot(roomId: string, sessionId: string): Promise<RoomSnapshot | null> {
    const tombstoneModel = (this.prisma as PrismaService & { roomTombstone?: { findUnique: (args: unknown) => Promise<{ status?: string } | null> } }).roomTombstone;
    const tombstone = tombstoneModel ? await tombstoneModel.findUnique({ where: { roomId } }).catch(() => null) : null;
    if (tombstone?.status === "PENDING" || tombstone?.status === "SUCCEEDED") return null;
    const record = await this.roomRecordRepository.getRoomRecord(roomId);

    if (
      record.room.hostId !== sessionId &&
      !record.room.members.some((member) => member.id === sessionId)
    ) {
      return null;
    }

    await this.roomRecordRepository.setRecentRoomForSession(sessionId, roomId);
    return this.roomSnapshotService.buildSnapshot(record, []);
  }

  async rememberRecentRoom(roomId: string, sessionId: string) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    assertMember(record, sessionId);
    await this.roomRecordRepository.setRecentRoomForSession(sessionId, roomId);
  }

  async handleDuplicateSessionReplacement(roomId: string, sessionId: string) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    assertMember(record, sessionId);

    if (!this.roomPlaybackService.pausePlaybackForSessionReplacement(record, sessionId)) {
      return record.room.playback;
    }

    incrementRoomRevision(record.room);
    await this.roomRecordRepository.persistRecord(record);
    return record.room.playback;
  }

  isRealtimeAvailable() {
    const redis = this.redis as RedisService & {
      isPubSubAvailable?: () => boolean;
    };
    if (typeof redis.isPubSubAvailable === "function") {
      return redis.isPubSubAvailable();
    }
    return typeof redis.isAvailable === "function" ? redis.isAvailable() : true;
  }

  async getTracks(roomId: string) {
    return (await this.roomRecordRepository.getRoomRecord(roomId)).tracks;
  }

  async getQueue(roomId: string) {
    return (await this.roomRecordRepository.getRoomRecord(roomId)).queue;
  }

  async getAccessibleQueue(roomId: string, sessionId: string) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    assertMember(record, sessionId);
    return record.queue;
  }

  async assertRoomMember(roomId: string, sessionId: string) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    assertMember(record, sessionId);
  }

  async updatePlayback(
    roomId: string,
    input: {
      action: "play" | "pause" | "seek" | "next" | "prev" | "gapless-next" | "set-mode";
      trackId?: string;
      queueItemId?: string;
      playbackAssetId?: string;
      positionMs?: number;
      actorSessionId?: string;
      actorPeerId?: string;
      expectedVersion?: number;
      playbackMode?: import("@music-room/shared").PlaybackMode;
    }
  ): Promise<PlaybackSnapshot> {
    if (!this.isRealtimeAvailable()) {
      throw new Error("Realtime sync unavailable.");
    }

    const record = await this.roomRecordRepository.getRoomRecord(roomId);

    if (input.actorSessionId) {
      assertMember(record, input.actorSessionId);
      assertPermission(record, input.actorSessionId, "player");
      if (input.actorPeerId) {
        await this.presenceOrchestrator.refreshPresenceLease(
          roomId,
          input.actorSessionId,
          input.actorPeerId
        );
      }
    }
    const expectedVersion = input.expectedVersion ?? record.room.playback.playbackRevision;
    if (record.room.playback.playbackRevision !== expectedVersion) {
      throw new Error("Playback state version conflict.");
    }
    const playback = await this.roomPlaybackService.updatePlayback(record, input);
    incrementRoomRevision(record.room);
    await this.roomRecordRepository.persistRecord(record);
    return playback;
  }

  /**
   * Server watchdog entry: advance rooms at a scheduled gapless transition or after
   * the current track has passed durationMs without a client next call.
   */
  async advanceEndedPlaybacks(): Promise<
    Array<{ roomId: string; playback: import("@music-room/shared").PlaybackSnapshot }>
  > {
    if (!this.isRealtimeAvailable()) {
      return [];
    }

    const records = await this.roomRecordRepository.listRecoverableRecords();
    const advanced: Array<{
      roomId: string;
      playback: import("@music-room/shared").PlaybackSnapshot;
    }> = [];

    for (const listed of records) {
      if (listed.room.playback.status !== "playing" || !listed.room.playback.currentTrackId) {
        continue;
      }

      try {
        // Re-load so CAS uses the freshest revision under concurrent host controls.
        const record = await this.roomRecordRepository.getRoomRecord(listed.room.id);
        const didGaplessAdvance = await this.roomPlaybackService.advanceGaplessIfDue(record);
        const didAdvance = didGaplessAdvance || await this.roomPlaybackService.advanceIfTrackEnded(record);
        if (!didAdvance) {
          continue;
        }
        incrementRoomRevision(record.room);
        await this.roomRecordRepository.persistRecord(record);
        const playback = await this.roomPlaybackService.buildPlaybackForSnapshot(record);
        advanced.push({ roomId: record.room.id, playback });
      } catch {
        // Conflict or missing room under concurrent updates: skip this tick.
        continue;
      }
    }

    return advanced;
  }

  // ── Lifecycle facade ───────────────────────────────────────────────────────

  createRoom(
    hostSessionId: string,
    visibility: import("@music-room/shared").Room["visibility"] = "public",
    metadata?: {
      name?: string;
      description?: string | null;
      password?: string;
      newMemberPermissions?: import("@music-room/shared").RoomMemberPermissions;
    }
  ) {
    return this.lifecycleService.createRoom(hostSessionId, visibility, metadata);
  }

  joinRoom(roomId: string, sessionId: string, password?: string) {
    return this.lifecycleService.joinRoom(roomId, sessionId, password);
  }

  updateRoom(
    roomId: string,
    sessionId: string,
    input: {
      visibility: import("@music-room/shared").Room["visibility"];
      name: string;
      description?: string | null;
      password?: string;
      newMemberPermissions?: import("@music-room/shared").RoomMemberPermissions;
    }
  ) {
    return this.lifecycleService.updateRoom(roomId, sessionId, input);
  }

  updateMemberPermissions(
    roomId: string,
    actorSessionId: string,
    memberId: string,
    permissions: import("@music-room/shared").RoomMemberPermissions
  ) {
    return this.lifecycleService.updateMemberPermissions(roomId, actorSessionId, memberId, permissions);
  }

  removeMember(roomId: string, actorSessionId: string, memberId: string) {
    return this.lifecycleService.removeMember(roomId, actorSessionId, memberId);
  }

  deleteRoom(roomId: string, sessionId: string) {
    return this.lifecycleService.deleteRoom(roomId, sessionId);
  }

  deleteRoomByAdmin(roomId: string) {
    return this.lifecycleService.deleteRoomByAdmin(roomId);
  }

  assertCanDeleteRoom(roomId: string, sessionId: string) {
    return this.lifecycleService.assertCanDeleteRoom(roomId, sessionId);
  }

  leaveRoom(roomId: string, sessionId: string) {
    return this.lifecycleService.leaveRoom(roomId, sessionId);
  }

  // ── Content facade ─────────────────────────────────────────────────────────

  registerTrack(
    roomId: string,
    sessionId: string,
    input: Omit<import("@music-room/shared").TrackMeta, "id"> & { id?: string }
  ) {
    return this.contentService.registerTrack(roomId, sessionId, input);
  }

  removeTrack(roomId: string, sessionId: string, trackId: string) {
    return this.contentService.removeTrack(roomId, sessionId, trackId);
  }

  addQueueItem(roomId: string, sessionId: string, trackId: string) {
    return this.contentService.addQueueItem(roomId, sessionId, trackId);
  }

  importPlaylistToQueue(roomId: string, sessionId: string, trackIds: string[]) {
    return this.contentService.importPlaylistToQueue(roomId, sessionId, trackIds);
  }

  removeQueueItem(roomId: string, queueItemId: string, actorSessionId: string) {
    return this.contentService.removeQueueItem(roomId, queueItemId, actorSessionId);
  }

  setNextQueueItem(roomId: string, actorSessionId: string, queueItemId: string) {
    return this.contentService.setNextQueueItem(roomId, actorSessionId, queueItemId);
  }

  reorderQueue(roomId: string, actorSessionId: string, queueItemIds: string[]) {
    return this.contentService.reorderQueue(roomId, actorSessionId, queueItemIds);
  }

  // ── Presence facade ────────────────────────────────────────────────────────

  updatePeerPresence(
    roomId: string,
    sessionId: string,
    peerId: string | null,
    presenceState: RoomMember["presenceState"] = peerId ? "online" : "offline"
  ) {
    return this.presenceOrchestrator.updatePeerPresence(roomId, sessionId, peerId, presenceState);
  }

  refreshRealtimePresence(roomId: string, sessionId: string, peerId: string) {
    return this.presenceOrchestrator.refreshRealtimePresence(roomId, sessionId, peerId);
  }
}
