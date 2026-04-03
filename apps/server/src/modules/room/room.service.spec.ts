import { AuthService } from "../auth/auth.service";
import { RoomService } from "./room.service";

function createPrismaMock() {
  return {
    isAvailable: jest.fn(() => false),
    ensureAvailable: jest.fn(async () => false),
    guestSessions: {
      upsert: jest.fn(),
      findUnique: jest.fn()
    },
    roomStates: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn()
    },
    playlists: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn()
    }
  };
}

function createRedisMock() {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  return {
    setJson: jest.fn(async (key: string, payload: unknown) => {
      store.set(key, JSON.stringify(payload));
    }),
    getJson: jest.fn(async (key: string) => {
      const value = store.get(key);
      return value ? JSON.parse(value) : null;
    }),
    setString: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    getString: jest.fn(async (key: string) => store.get(key) ?? null),
    delete: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    addToSet: jest.fn(async (key: string, value: string) => {
      const existing = sets.get(key) ?? new Set<string>();
      existing.add(value);
      sets.set(key, existing);
    }),
    removeFromSet: jest.fn(async (key: string, value: string) => {
      const existing = sets.get(key);
      existing?.delete(value);
    }),
    getSetMembers: jest.fn(async (key: string) => [...(sets.get(key) ?? new Set<string>())]),
    publish: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue(undefined)
  };
}

describe("RoomService", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("allows any room member to control playback and uses the track owner as source", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    await roomService.touchRealtimePresence(snapshot.room.id, member.id, "peer-member");
    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Track One",
      artist: "Local Upload",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "abc123",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });
    await roomService.addQueueItem(snapshot.room.id, member.id, track.id);

    await expect(
      roomService.updatePlayback(snapshot.room.id, {
        action: "pause",
        actorSessionId: member.id
      })
    ).resolves.toMatchObject({
      status: "paused"
    });

    await expect(
      roomService.updatePlayback(snapshot.room.id, {
        action: "play",
        trackId: track.id,
        actorSessionId: host.id,
        positionMs: 5000
      })
    ).resolves.toMatchObject({
      status: "playing",
      positionMs: 5000,
      sourceSessionId: host.id,
      sourceTrackId: track.id,
      sourcePeerId: "peer-host"
    });
  });

  it("only allows the host or requester to remove a queue item", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const requester = await authService.createGuestSession("Requester");
    const otherMember = await authService.createGuestSession("Other");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, requester.id);
    await roomService.joinRoom(snapshot.room.id, otherMember.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");

    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Track Two",
      artist: "Local Upload",
      album: null,
      durationMs: 90000,
      bitrate: null,
      fileHash: "def456",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    const queueItem = await roomService.addQueueItem(snapshot.room.id, requester.id, track.id);

    await expect(
      roomService.removeQueueItem(snapshot.room.id, queueItem.id, otherMember.id)
    ).rejects.toThrow("Only the host or the requester can remove this queue item.");

    await expect(
      roomService.removeQueueItem(snapshot.room.id, queueItem.id, requester.id)
    ).resolves.toEqual([]);
  });

  it("promotes the next member to host when the host leaves", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    const roomAfterLeave = await roomService.leaveRoom(snapshot.room.id, host.id);

    expect(roomAfterLeave.hostId).toBe(member.id);
    expect(roomAfterLeave.members).toHaveLength(1);
    expect(roomAfterLeave.members[0]).toMatchObject({
      id: member.id,
      role: "host"
    });
  });

  it("keeps the recent room record after a member leaves an existing room", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.leaveRoom(snapshot.room.id, member.id);

    const recentRoom = await roomService.getRecentRoomSnapshotForSession(member.id);

    expect(recentRoom).not.toBeNull();
    expect(recentRoom?.room.id).toBe(snapshot.room.id);
  });

  it("imports a playlist back into the room queue when tracks exist in the room", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Track Three",
      artist: "Local Upload",
      album: null,
      durationMs: 180000,
      bitrate: null,
      fileHash: "ghi789",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    const queue = await roomService.importPlaylistToQueue(snapshot.room.id, member.id, [track.id]);

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      trackId: track.id,
      requestedById: member.id
    });

    const roomAfterImport = await roomService.getRoomSnapshot(snapshot.room.id, []);
    expect(roomAfterImport.room.playback).toMatchObject({
      status: "paused",
      currentTrackId: null,
      currentQueueItemId: null
    });
  });

  it("keeps playback paused when the first track is only added to queue", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Queued Only",
      artist: "Artist",
      album: null,
      durationMs: 100000,
      bitrate: null,
      fileHash: "queued-only",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    const queueItem = await roomService.addQueueItem(snapshot.room.id, member.id, track.id);
    const roomAfterQueue = await roomService.getRoomSnapshot(snapshot.room.id, []);

    expect(queueItem.trackId).toBe(track.id);
    expect(roomAfterQueue.queue).toHaveLength(1);
    expect(roomAfterQueue.room.playback).toMatchObject({
      status: "paused",
      currentTrackId: null,
      currentQueueItemId: null
    });
  });

  it("allows the host to reorder the queue and jump to a queue item", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    const firstTrack = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "First",
      artist: "Local Upload",
      album: null,
      durationMs: 100000,
      bitrate: null,
      fileHash: "first",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });
    const secondTrack = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Second",
      artist: "Local Upload",
      album: null,
      durationMs: 100000,
      bitrate: null,
      fileHash: "second",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    const firstQueueItem = await roomService.addQueueItem(snapshot.room.id, member.id, firstTrack.id);
    const secondQueueItem = await roomService.addQueueItem(snapshot.room.id, member.id, secondTrack.id);

    const reordered = await roomService.reorderQueue(snapshot.room.id, host.id, [
      secondQueueItem.id,
      firstQueueItem.id
    ]);
    expect(reordered[0]?.id).toBe(secondQueueItem.id);
    expect(reordered[1]?.position).toBe(1);

    await expect(
      roomService.updatePlayback(snapshot.room.id, {
        action: "play",
        queueItemId: secondQueueItem.id,
        actorSessionId: host.id
      })
    ).resolves.toMatchObject({
      currentTrackId: secondTrack.id,
      currentQueueItemId: secondQueueItem.id,
      status: "playing",
      sourceSessionId: host.id
    });
  });

  it("keeps the active queue item stable when the same track appears multiple times", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");

    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Repeat",
      artist: "Artist",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "repeat-track",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    const firstQueueItem = await roomService.addQueueItem(snapshot.room.id, member.id, track.id);
    const secondQueueItem = await roomService.addQueueItem(snapshot.room.id, member.id, track.id);

    await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      queueItemId: firstQueueItem.id,
      actorSessionId: host.id
    });

    const nextPlayback = await roomService.updatePlayback(snapshot.room.id, {
      action: "next",
      actorSessionId: host.id
    });

    expect(nextPlayback.currentTrackId).toBe(track.id);
    expect(nextPlayback.currentQueueItemId).toBe(secondQueueItem.id);

    const previousPlayback = await roomService.updatePlayback(snapshot.room.id, {
      action: "prev",
      actorSessionId: host.id
    });

    expect(previousPlayback.currentTrackId).toBe(track.id);
    expect(previousPlayback.currentQueueItemId).toBe(firstQueueItem.id);
  });

  it("allows the original uploader to delete a track and removes it from queue and playback", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, member.id, "peer-member");

    const track = await roomService.registerTrack(snapshot.room.id, member.id, {
      title: "Member Track",
      artist: "Artist",
      album: null,
      durationMs: 90000,
      bitrate: null,
      fileHash: "member-track-delete",
      artworkUrl: null,
      ownerSessionId: member.id,
      ownerNickname: member.nickname,
      sourceType: "local_upload"
    });

    await roomService.addQueueItem(snapshot.room.id, member.id, track.id);
    await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: track.id,
      actorSessionId: member.id
    });

    await expect(
      roomService.removeTrack(snapshot.room.id, member.id, track.id)
    ).resolves.toEqual({ ok: true });

    const roomAfterDelete = await roomService.getRoomSnapshot(snapshot.room.id, []);
    expect(roomAfterDelete.tracks).toHaveLength(0);
    expect(roomAfterDelete.queue).toHaveLength(0);
    expect(roomAfterDelete.room.playback.currentTrackId).toBeNull();
  });

  it("blocks other members from deleting someone else's uploaded track", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Host Track",
      artist: "Artist",
      album: null,
      durationMs: 90000,
      bitrate: null,
      fileHash: "host-track-delete",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    await expect(
      roomService.removeTrack(snapshot.room.id, member.id, track.id)
    ).rejects.toThrow("Only the original uploader can delete this track.");
  });

  it("rejects playback when the track owner is offline", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, member.id, "peer-member");
    const memberTrack = await roomService.registerTrack(snapshot.room.id, member.id, {
      title: "Member Track",
      artist: "Local Upload",
      album: null,
      durationMs: 60000,
      bitrate: null,
      fileHash: "member-track",
      artworkUrl: null,
      ownerSessionId: member.id,
      ownerNickname: member.nickname,
      sourceType: "local_upload"
    });

    await roomService.clearRealtimePresence(snapshot.room.id, member.id);

    await expect(
      roomService.updatePlayback(snapshot.room.id, {
        action: "play",
        trackId: memberTrack.id,
        actorSessionId: host.id
      })
    ).rejects.toThrow("Track owner is not online, so this song cannot be played right now.");
  });

  it("keeps playback snapshot consistent when a member pauses and seeks", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    await roomService.touchRealtimePresence(snapshot.room.id, member.id, "peer-member");

    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Track Four",
      artist: "Local Upload",
      album: null,
      durationMs: 150000,
      bitrate: null,
      fileHash: "track-four",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: track.id,
      actorSessionId: member.id,
      positionMs: 4000
    });

    const paused = await roomService.updatePlayback(snapshot.room.id, {
      action: "pause",
      actorSessionId: member.id,
      positionMs: 12000
    });

    expect(paused).toMatchObject({
      status: "paused",
      currentTrackId: track.id,
      sourceSessionId: host.id,
      sourcePeerId: "peer-host",
      sourceTrackId: track.id,
      positionMs: 12000,
      startedAt: null
    });

    const seeked = await roomService.updatePlayback(snapshot.room.id, {
      action: "seek",
      actorSessionId: member.id,
      positionMs: 30000
    });

    expect(seeked).toMatchObject({
      status: "paused",
      currentTrackId: track.id,
      sourceSessionId: host.id,
      sourcePeerId: "peer-host",
      sourceTrackId: track.id,
      positionMs: 30000,
      startedAt: null
    });
  });

  it("rejects stale playback writes with a version conflict", async () => {
    const prisma = createPrismaMock();
    const redis = {
      ...createRedisMock(),
      isAvailable: jest.fn(() => true)
    };
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Conflict",
      artist: "Artist",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "conflict-track",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: track.id,
      actorSessionId: host.id,
      expectedVersion: 1
    });

    await expect(
      roomService.updatePlayback(snapshot.room.id, {
        action: "pause",
        actorSessionId: host.id,
        expectedVersion: 1
      })
    ).rejects.toThrow("Playback state version conflict.");
  });

  it("reassigns the active source when the host leaves but the current track owner stays online", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    await roomService.touchRealtimePresence(snapshot.room.id, member.id, "peer-member");

    const memberTrack = await roomService.registerTrack(snapshot.room.id, member.id, {
      title: "Member Source",
      artist: "Artist",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "member-source",
      artworkUrl: null,
      ownerSessionId: member.id,
      ownerNickname: member.nickname,
      sourceType: "local_upload"
    });

    const playback = await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: memberTrack.id,
      actorSessionId: host.id,
      expectedVersion: 1
    });
    const roomAfterLeave = await roomService.leaveRoom(snapshot.room.id, host.id);

    expect(playback.sourceSessionId).toBe(member.id);
    expect(roomAfterLeave.playback).toMatchObject({
      status: "playing",
      currentTrackId: memberTrack.id,
      sourceSessionId: member.id,
      sourcePeerId: "peer-member",
      sourceTrackId: memberTrack.id
    });
    expect(roomAfterLeave.playback.queueVersion).toBeGreaterThan(playback.queueVersion);
  });

  it("starts a different track from the beginning when play switches songs", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    await roomService.touchRealtimePresence(snapshot.room.id, member.id, "peer-member");

    const firstTrack = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "First",
      artist: "Artist",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "first-track",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });
    const secondTrack = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Second",
      artist: "Artist",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "second-track",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: firstTrack.id,
      actorSessionId: member.id,
      positionMs: 45000
    });

    await expect(
      roomService.updatePlayback(snapshot.room.id, {
        action: "play",
        trackId: secondTrack.id,
        actorSessionId: member.id
      })
    ).resolves.toMatchObject({
      currentTrackId: secondTrack.id,
      positionMs: 0
    });
  });

  it("keeps the same media epoch when switching tracks owned by the same online source", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");

    const firstTrack = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "First",
      artist: "Artist",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "same-owner-1",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });
    const secondTrack = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Second",
      artist: "Artist",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "same-owner-2",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    const firstPlayback = await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: firstTrack.id,
      actorSessionId: host.id
    });
    const secondPlayback = await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: secondTrack.id,
      actorSessionId: host.id
    });

    expect(secondPlayback.mediaEpoch).toBe(firstPlayback.mediaEpoch);
  });

  it("restores the recent active room for a session from redis", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);

    const restored = await roomService.getRecentRoomSnapshotForSession(host.id);

    expect(restored).not.toBeNull();
    expect(restored?.room.id).toBe(snapshot.room.id);
    expect(redis.setString).toHaveBeenCalled();
  });

  it("creates a six-character uppercase join code", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);
    const host = await authService.createGuestSession("Host");

    const snapshot = await roomService.createRoom(host.id);

    expect(snapshot.room.joinCode).toMatch(/^[A-Z0-9]{6}$/);
  });

  it("lists rooms from the redis registry when memory state is empty", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);
    const restoredService = new RoomService(authService, prisma as never, redis as never);

    const rooms = await restoredService.listRoomsForSession(host.id);

    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.room.id).toBe(snapshot.room.id);
    expect(redis.addToSet).toHaveBeenCalled();
  });

  it("only recovers a room for members of that room", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const outsider = await authService.createGuestSession("Outsider");
    const snapshot = await roomService.createRoom(host.id);

    await expect(
      roomService.getRecoverableRoomSnapshot(snapshot.room.id, outsider.id)
    ).resolves.toBeNull();
    await expect(
      roomService.getRecoverableRoomSnapshot(snapshot.room.id, host.id)
    ).resolves.toMatchObject({
      room: { id: snapshot.room.id }
    });
  });

  it("lists public rooms only when they still have active online members", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await expect(roomService.listPublicRooms()).resolves.toEqual([]);

    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    await expect(roomService.listPublicRooms()).resolves.toHaveLength(1);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, member.id, "peer-member");
    await expect(roomService.listPublicRooms()).resolves.toHaveLength(1);

    await roomService.clearRealtimePresence(snapshot.room.id, member.id);
    await expect(roomService.listPublicRooms()).resolves.toHaveLength(1);

    await roomService.clearRealtimePresence(snapshot.room.id, host.id);
    await expect(roomService.listPublicRooms()).resolves.toEqual([]);
  });

  it("rejects joining a room with a duplicate nickname", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const duplicate = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);

    await expect(roomService.joinRoom(snapshot.room.id, duplicate.id)).rejects.toThrow(
      "Nickname already exists in this room."
    );
  });

  it("deduplicates repeated track registration by file hash for the same uploader", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);

    const firstTrack = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Same",
      artist: "Artist",
      album: null,
      durationMs: 180_000,
      bitrate: null,
      sizeBytes: 1024,
      codec: "mp3",
      fileHash: "same-hash",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: "Host",
      sourceType: "local_upload"
    });

    const secondTrack = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Same",
      artist: "Artist",
      album: null,
      durationMs: 180_000,
      bitrate: null,
      sizeBytes: 1024,
      codec: "mp3",
      fileHash: "same-hash",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: "Host",
      sourceType: "local_upload"
    });

    const latestSnapshot = await roomService.getRoomSnapshot(snapshot.room.id, []);

    expect(secondTrack.id).toBe(firstTrack.id);
    expect(latestSnapshot.tracks.filter((track) => track.fileHash === "same-hash")).toHaveLength(1);
  });

  it("keeps the full room roster in snapshots even when some members are offline", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");

    const nextSnapshot = await roomService.getRoomSnapshot(snapshot.room.id, []);
    const hostEntry = nextSnapshot.room.members.find((entry) => entry.id === host.id);
    const memberEntry = nextSnapshot.room.members.find((entry) => entry.id === member.id);

    expect(nextSnapshot.room.members).toHaveLength(2);
    expect(hostEntry).toMatchObject({
      id: host.id,
      peerId: "peer-host",
      presenceState: "online"
    });
    expect(memberEntry).toMatchObject({
      id: member.id,
      peerId: null,
      presenceState: "offline"
    });
  });

  it("pauses playback and bumps media epoch when the active source session is replaced", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Active Source",
      artist: "Artist",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "active-source-track",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    const playback = await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: track.id,
      actorSessionId: host.id,
      positionMs: 3_500
    });

    const pausedPlayback = await roomService.handleDuplicateSessionReplacement(
      snapshot.room.id,
      host.id
    );
    const nextSnapshot = await roomService.getRoomSnapshot(snapshot.room.id, []);

    expect(playback.status).toBe("playing");
    expect(pausedPlayback).toMatchObject({
      status: "paused",
      currentTrackId: track.id,
      sourceSessionId: host.id,
      sourcePeerId: null
    });
    expect(pausedPlayback.mediaEpoch).toBe(playback.mediaEpoch + 1);
    expect(pausedPlayback.positionMs).toBe(3_500);
    expect(nextSnapshot.room.playback).toMatchObject({
      status: "paused",
      currentTrackId: track.id,
      sourceSessionId: host.id,
      sourcePeerId: null
    });
  });

  it("allows the host to delete a room and blocks non-host members", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);
    await roomService.joinRoom(snapshot.room.id, member.id);

    await expect(roomService.deleteRoom(snapshot.room.id, member.id)).rejects.toThrow(
      "Only the host can delete this room."
    );

    await roomService.updatePeerPresence(snapshot.room.id, host.id, "peer-host");
    await roomService.updatePeerPresence(snapshot.room.id, member.id, "peer-member");

    await expect(roomService.deleteRoom(snapshot.room.id, host.id)).resolves.toEqual({ ok: true });
    await expect(roomService.getRoomSnapshot(snapshot.room.id, [])).rejects.toThrow(
      `Room not found: ${snapshot.room.id}`
    );
  });
});
