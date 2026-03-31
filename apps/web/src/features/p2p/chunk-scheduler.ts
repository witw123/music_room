import type { RoomSnapshot, TrackAvailabilityAnnouncement, TrackMeta } from "@music-room/shared";

export type ChunkSchedulerPriority = "current" | "upcoming" | "background";

type ChunkSchedulerTrackState = {
  totalChunks: number;
  ownedChunks: Set<number>;
  pendingChunks: Map<number, { peerId: string; requestedAt: number }>;
  cooledDownPeers: Map<string, number>;
};

type ChunkSchedulerSyncInput = {
  roomSnapshot: RoomSnapshot | null;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  connectedPeerIds: string[];
  uploadedTrackIds: string[];
  playbackPositionMs: number;
};

type ChunkSchedulerRequestArgs = {
  peerId: string;
  trackId: string;
  chunkIndex: number;
  totalChunks: number;
  priority: ChunkSchedulerPriority;
};

type ChunkSchedulerOptions = {
  now?: () => number;
  peerCooldownMs?: number;
  maxConcurrentCurrentTrack?: number;
  maxConcurrentUpcomingTrack?: number;
  maxConcurrentBackgroundTrack?: number;
  maxConcurrentPerPeer?: number;
  currentLookBehindMs?: number;
  currentLookAheadMs?: number;
  upcomingPrefetchMs?: number;
  backgroundChunkBatchSize?: number;
  requestPiece: (args: ChunkSchedulerRequestArgs) => boolean;
};

type TrackPlan = {
  track: TrackMeta;
  priority: ChunkSchedulerPriority;
  maxConcurrent: number;
  preferredPeerId: string | null;
  wantedChunks: number[];
};

const DEFAULTS = {
  peerCooldownMs: 5_000,
  maxConcurrentCurrentTrack: 6,
  maxConcurrentUpcomingTrack: 2,
  maxConcurrentBackgroundTrack: 1,
  maxConcurrentPerPeer: 3,
  currentLookBehindMs: 5_000,
  currentLookAheadMs: 20_000,
  upcomingPrefetchMs: 12_000,
  backgroundChunkBatchSize: 2
} as const;

export class ChunkScheduler {
  private roomSnapshot: RoomSnapshot | null = null;
  private availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>> = {};
  private connectedPeerIds = new Set<string>();
  private uploadedTrackIds = new Set<string>();
  private playbackPositionMs = 0;
  private readonly trackStates = new Map<string, ChunkSchedulerTrackState>();

  constructor(
    private readonly localPeerId: string,
    private readonly options: ChunkSchedulerOptions
  ) {}

  sync(input: ChunkSchedulerSyncInput) {
    this.roomSnapshot = input.roomSnapshot;
    this.availabilityByTrack = input.availabilityByTrack;
    this.connectedPeerIds = new Set(input.connectedPeerIds);
    this.uploadedTrackIds = new Set(input.uploadedTrackIds);
    this.playbackPositionMs = input.playbackPositionMs;
    this.reconcileTrackStates();
    this.schedule();
  }

  markPieceReceived(trackId: string, chunkIndex: number, totalChunks: number) {
    const state = this.ensureTrackState(trackId, totalChunks);
    state.totalChunks = Math.max(state.totalChunks, totalChunks);
    state.ownedChunks.add(chunkIndex);
    state.pendingChunks.delete(chunkIndex);
    this.schedule();
  }

  markRequestTimeout(trackId: string, chunkIndex: number, peerId: string) {
    const state = this.trackStates.get(trackId);
    if (!state) {
      return;
    }

    state.pendingChunks.delete(chunkIndex);
    state.cooledDownPeers.set(peerId, this.now() + this.peerCooldownMs());
    this.schedule();
  }

  markTrackHydrated(trackId: string) {
    const state = this.trackStates.get(trackId);
    if (!state) {
      return;
    }

    state.pendingChunks.clear();
    this.schedule();
  }

  getBufferedChunkCount(trackId: string) {
    return this.trackStates.get(trackId)?.ownedChunks.size ?? 0;
  }

  private schedule() {
    if (!this.roomSnapshot) {
      return;
    }

    this.pruneCooldowns();
    const peerLoads = this.buildPeerLoadMap();

    for (const plan of this.buildTrackPlans()) {
      const state = this.ensureTrackState(plan.track.id, this.getTotalChunks(plan.track.id));
      const activeTrackRequests = state.pendingChunks.size;
      if (activeTrackRequests >= plan.maxConcurrent) {
        continue;
      }

      for (const chunkIndex of plan.wantedChunks) {
        if (
          state.ownedChunks.has(chunkIndex) ||
          state.pendingChunks.has(chunkIndex) ||
          state.totalChunks <= 0
        ) {
          continue;
        }

        if (state.pendingChunks.size >= plan.maxConcurrent) {
          break;
        }

        const peerId = selectChunkPeer({
          announcements: Object.values(this.availabilityByTrack[plan.track.id] ?? {}),
          chunkIndex,
          connectedPeerIds: this.connectedPeerIds,
          excludedPeerIds: new Set([
            this.localPeerId,
            ...[...state.cooledDownPeers.keys()].filter(
              (candidatePeerId) => (state.cooledDownPeers.get(candidatePeerId) ?? 0) > this.now()
            )
          ]),
          preferredPeerId: plan.preferredPeerId,
          peerLoads,
          maxConcurrentPerPeer: this.maxConcurrentPerPeer()
        });

        if (!peerId) {
          continue;
        }

        const didRequest = this.options.requestPiece({
          peerId,
          trackId: plan.track.id,
          chunkIndex,
          totalChunks: state.totalChunks,
          priority: plan.priority
        });

        if (!didRequest) {
          continue;
        }

        state.pendingChunks.set(chunkIndex, {
          peerId,
          requestedAt: this.now()
        });
        peerLoads.set(peerId, (peerLoads.get(peerId) ?? 0) + 1);
      }
    }
  }

  private buildTrackPlans(): TrackPlan[] {
    if (!this.roomSnapshot) {
      return [];
    }

    const currentTrack = this.roomSnapshot.tracks.find(
      (track) => track.id === this.roomSnapshot?.room.playback.currentTrackId
    );
    const currentQueueIndex = this.roomSnapshot.room.playback.currentQueueItemId
      ? this.roomSnapshot.queue.findIndex(
          (item) => item.id === this.roomSnapshot?.room.playback.currentQueueItemId
        )
      : currentTrack
        ? this.roomSnapshot.queue.findIndex((item) => item.trackId === currentTrack.id)
        : -1;
    const upcomingTrack =
      currentQueueIndex >= 0
        ? this.roomSnapshot.tracks.find(
            (track) => track.id === this.roomSnapshot?.queue[currentQueueIndex + 1]?.trackId
          ) ?? null
        : null;

    const plans: TrackPlan[] = [];

    if (currentTrack && !this.uploadedTrackIds.has(currentTrack.id)) {
      plans.push({
        track: currentTrack,
        priority: "current",
        maxConcurrent: this.maxConcurrentCurrentTrack(),
        preferredPeerId: this.roomSnapshot.room.playback.sourcePeerId,
        wantedChunks: getCurrentPlaybackWindowChunks({
          durationMs: currentTrack.durationMs,
          totalChunks: this.getTotalChunks(currentTrack.id),
          playbackPositionMs: this.playbackPositionMs,
          lookBehindMs: this.currentLookBehindMs(),
          lookAheadMs: this.currentLookAheadMs()
        })
      });
    }

    if (upcomingTrack && !this.uploadedTrackIds.has(upcomingTrack.id)) {
      plans.push({
        track: upcomingTrack,
        priority: "upcoming",
        maxConcurrent: this.maxConcurrentUpcomingTrack(),
        preferredPeerId: null,
        wantedChunks: getUpcomingWindowChunks({
          durationMs: upcomingTrack.durationMs,
          totalChunks: this.getTotalChunks(upcomingTrack.id),
          prefetchMs: this.upcomingPrefetchMs()
        })
      });
    }

    for (const track of this.roomSnapshot.tracks) {
      if (
        this.uploadedTrackIds.has(track.id) ||
        track.id === currentTrack?.id ||
        track.id === upcomingTrack?.id
      ) {
        continue;
      }

      plans.push({
        track,
        priority: "background",
        maxConcurrent: this.maxConcurrentBackgroundTrack(),
        preferredPeerId: null,
        wantedChunks: getBackgroundChunks({
          totalChunks: this.getTotalChunks(track.id),
          ownedChunks: this.ensureTrackState(track.id, this.getTotalChunks(track.id)).ownedChunks,
          pendingChunks: this.ensureTrackState(track.id, this.getTotalChunks(track.id)).pendingChunks,
          batchSize: this.backgroundChunkBatchSize()
        })
      });
    }

    return plans.filter((plan) => plan.wantedChunks.length > 0);
  }

  private reconcileTrackStates() {
    const activeTrackIds = new Set<string>();

    if (this.roomSnapshot) {
      for (const track of this.roomSnapshot.tracks) {
        activeTrackIds.add(track.id);
        const state = this.ensureTrackState(track.id, this.getTotalChunks(track.id));
        state.ownedChunks = new Set(
          this.availabilityByTrack[track.id]?.[this.localPeerId]?.availableChunks ?? [...state.ownedChunks]
        );
      }
    }

    for (const [trackId] of this.trackStates.entries()) {
      if (!activeTrackIds.has(trackId)) {
        this.trackStates.delete(trackId);
      }
    }
  }

  private ensureTrackState(trackId: string, totalChunks: number) {
    const existing = this.trackStates.get(trackId);
    if (existing) {
      existing.totalChunks = Math.max(existing.totalChunks, totalChunks);
      return existing;
    }

    const nextState: ChunkSchedulerTrackState = {
      totalChunks,
      ownedChunks: new Set(this.availabilityByTrack[trackId]?.[this.localPeerId]?.availableChunks ?? []),
      pendingChunks: new Map(),
      cooledDownPeers: new Map()
    };
    this.trackStates.set(trackId, nextState);
    return nextState;
  }

  private getTotalChunks(trackId: string) {
    const stateTotalChunks = this.trackStates.get(trackId)?.totalChunks ?? 0;
    const availabilityTotalChunks = Object.values(this.availabilityByTrack[trackId] ?? {}).reduce(
      (max, announcement) => Math.max(max, announcement.totalChunks),
      0
    );
    return Math.max(stateTotalChunks, availabilityTotalChunks);
  }

  private pruneCooldowns() {
    const now = this.now();

    for (const state of this.trackStates.values()) {
      for (const [peerId, expiresAt] of state.cooledDownPeers.entries()) {
        if (expiresAt <= now) {
          state.cooledDownPeers.delete(peerId);
        }
      }
    }
  }

  private buildPeerLoadMap() {
    const peerLoads = new Map<string, number>();

    for (const state of this.trackStates.values()) {
      for (const pendingRequest of state.pendingChunks.values()) {
        peerLoads.set(
          pendingRequest.peerId,
          (peerLoads.get(pendingRequest.peerId) ?? 0) + 1
        );
      }
    }

    return peerLoads;
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  private peerCooldownMs() {
    return this.options.peerCooldownMs ?? DEFAULTS.peerCooldownMs;
  }

  private maxConcurrentCurrentTrack() {
    return this.options.maxConcurrentCurrentTrack ?? DEFAULTS.maxConcurrentCurrentTrack;
  }

  private maxConcurrentUpcomingTrack() {
    return this.options.maxConcurrentUpcomingTrack ?? DEFAULTS.maxConcurrentUpcomingTrack;
  }

  private maxConcurrentBackgroundTrack() {
    return this.options.maxConcurrentBackgroundTrack ?? DEFAULTS.maxConcurrentBackgroundTrack;
  }

  private maxConcurrentPerPeer() {
    return this.options.maxConcurrentPerPeer ?? DEFAULTS.maxConcurrentPerPeer;
  }

  private currentLookBehindMs() {
    return this.options.currentLookBehindMs ?? DEFAULTS.currentLookBehindMs;
  }

  private currentLookAheadMs() {
    return this.options.currentLookAheadMs ?? DEFAULTS.currentLookAheadMs;
  }

  private upcomingPrefetchMs() {
    return this.options.upcomingPrefetchMs ?? DEFAULTS.upcomingPrefetchMs;
  }

  private backgroundChunkBatchSize() {
    return this.options.backgroundChunkBatchSize ?? DEFAULTS.backgroundChunkBatchSize;
  }
}

export function getCurrentPlaybackWindowChunks(input: {
  durationMs: number;
  totalChunks: number;
  playbackPositionMs: number;
  lookBehindMs: number;
  lookAheadMs: number;
}) {
  const { durationMs, totalChunks, playbackPositionMs, lookBehindMs, lookAheadMs } = input;
  if (durationMs <= 0 || totalChunks <= 0) {
    return [];
  }

  const currentChunkIndex = Math.min(
    totalChunks - 1,
    Math.max(0, Math.floor((Math.max(0, playbackPositionMs) / durationMs) * totalChunks))
  );
  const lookBehindChunks = Math.max(1, Math.ceil((lookBehindMs / durationMs) * totalChunks));
  const lookAheadChunks = Math.max(2, Math.ceil((lookAheadMs / durationMs) * totalChunks));

  return range(
    Math.max(0, currentChunkIndex - lookBehindChunks),
    Math.min(totalChunks - 1, currentChunkIndex + lookAheadChunks)
  );
}

export function getUpcomingWindowChunks(input: {
  durationMs: number;
  totalChunks: number;
  prefetchMs: number;
}) {
  const { durationMs, totalChunks, prefetchMs } = input;
  if (durationMs <= 0 || totalChunks <= 0) {
    return [];
  }

  const prefetchedChunks = Math.max(2, Math.ceil((prefetchMs / durationMs) * totalChunks));
  return range(0, Math.min(totalChunks - 1, prefetchedChunks - 1));
}

export function getBackgroundChunks(input: {
  totalChunks: number;
  ownedChunks: Set<number>;
  pendingChunks: Map<number, { peerId: string; requestedAt: number }>;
  batchSize: number;
}) {
  const { totalChunks, ownedChunks, pendingChunks, batchSize } = input;
  const chunks: number[] = [];

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    if (ownedChunks.has(chunkIndex) || pendingChunks.has(chunkIndex)) {
      continue;
    }

    chunks.push(chunkIndex);
    if (chunks.length >= batchSize) {
      break;
    }
  }

  return chunks;
}

export function selectChunkPeer(input: {
  announcements: TrackAvailabilityAnnouncement[];
  chunkIndex: number;
  connectedPeerIds: Set<string>;
  excludedPeerIds: Set<string>;
  preferredPeerId: string | null;
  peerLoads: Map<string, number>;
  maxConcurrentPerPeer: number;
}) {
  const {
    announcements,
    chunkIndex,
    connectedPeerIds,
    excludedPeerIds,
    preferredPeerId,
    peerLoads,
    maxConcurrentPerPeer
  } = input;

  const candidates = announcements.filter(
    (announcement) =>
      announcement.availableChunks.includes(chunkIndex) &&
      connectedPeerIds.has(announcement.ownerPeerId) &&
      !excludedPeerIds.has(announcement.ownerPeerId) &&
      (peerLoads.get(announcement.ownerPeerId) ?? 0) < maxConcurrentPerPeer
  );

  if (candidates.length === 0) {
    return null;
  }

  if (
    preferredPeerId &&
    candidates.some((announcement) => announcement.ownerPeerId === preferredPeerId)
  ) {
    return preferredPeerId;
  }

  candidates.sort((left, right) => {
    const loadDifference =
      (peerLoads.get(left.ownerPeerId) ?? 0) - (peerLoads.get(right.ownerPeerId) ?? 0);
    if (loadDifference !== 0) {
      return loadDifference;
    }

    const chunkDifference = right.availableChunks.length - left.availableChunks.length;
    if (chunkDifference !== 0) {
      return chunkDifference;
    }

    return new Date(right.announcedAt).getTime() - new Date(left.announcedAt).getTime();
  });

  return candidates[0]?.ownerPeerId ?? null;
}

function range(start: number, end: number) {
  if (end < start) {
    return [];
  }

  const values: number[] = [];
  for (let current = start; current <= end; current += 1) {
    values.push(current);
  }
  return values;
}
