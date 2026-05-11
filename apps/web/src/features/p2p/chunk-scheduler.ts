import type { RoomSnapshot, TrackAvailabilityAnnouncement, TrackMeta } from "@music-room/shared";
import {
  buildProgressiveTrackManifest,
  getAheadBufferedMs,
  getLowBufferThresholdMs,
  getProgressiveEngineType,
  getPriorityChunkIndexes,
  getRemoteFirstComfortBufferMs,
  getTargetSteadyBufferMs,
  isFlacTrack,
  isStartupReady,
  type ProgressiveSchedulerPolicy
} from "@/features/playback/progressive-playback";

export type ChunkSchedulerPriority = "current" | "upcoming" | "background";
export type ChunkSchedulerMode = "normal" | "conservative" | "idle";
export type ChunkBufferHealth = "healthy" | "low" | "critical";
export type TrackStreamProfile = "standard" | "large-lossless" | "large-compressed";
export type PlaybackClockSource = "local" | "remote" | "snapshot";

type ChunkSchedulerTrackState = {
  totalChunks: number;
  ownedChunks: Set<number>;
  pendingChunks: Map<number, { peerId: string; requestedAt: number; chunkSize: number; timeoutMs: number }>;
  cooledDownPeers: Map<string, number>;
  peerFailures: Map<string, { timeoutStreak: number; lastFailedAt: number; cooledDownUntil: number }>;
};

type ChunkSchedulerSyncInput = {
  roomSnapshot: RoomSnapshot | null;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  connectedPeerIds: string[];
  uploadedTrackIds: string[];
  manualTrackIds?: string[];
  playbackPositionMs: number;
  playbackStatus?: RoomSnapshot["room"]["playback"]["status"] | null;
  pageVisible?: boolean;
  mode?: ChunkSchedulerMode;
  bufferHealth?: ChunkBufferHealth;
  playbackClockSource?: PlaybackClockSource;
  policy?: ProgressiveSchedulerPolicy;
};

type ChunkSchedulerRequestArgs = {
  peerId: string;
  trackId: string;
  chunkIndexes: number[];
  totalChunks: number;
  priority: ChunkSchedulerPriority;
  timeoutMs?: number;
};

type PeerRequestWindow = {
  currentRoundTripTimeMs?: number | null;
  downloadRateKbps?: number | null;
  candidateType?: string | null;
  protocol?: string | null;
  transportScore?: "healthy" | "degraded" | "unstable" | "failed" | null;
  bufferedAmountBytes?: number | null;
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
  minScheduleIntervalMs?: number;
  requestPiece?: (args: {
    peerId: string;
    trackId: string;
    chunkIndex: number;
    totalChunks: number;
    priority: ChunkSchedulerPriority;
    timeoutMs?: number;
  }) => boolean;
  requestPieces?: (args: ChunkSchedulerRequestArgs) => boolean;
  resolvePeerRequestWindow?: (
    peerId: string,
    trackId: string,
    priority: ChunkSchedulerPriority
  ) => PeerRequestWindow | null | undefined;
};

type TrackPlan = {
  track: TrackMeta;
  priority: ChunkSchedulerPriority;
  maxConcurrent: number;
  maxConcurrentPerPeer: number;
  preferredPeerId: string | null;
  wantedChunks: number[];
  chunkSize: number;
  timeoutMs?: number;
};

const DEFAULTS = {
  peerCooldownMs: 3_000,
  maxConcurrentCurrentTrack: 14,
  maxConcurrentUpcomingTrack: 2,
  maxConcurrentBackgroundTrack: 1,
  maxConcurrentPerPeer: 6,
  currentLookBehindMs: 5_000,
  currentLookAheadMs: 60_000,
  upcomingPrefetchMs: 12_000,
  backgroundChunkBatchSize: 2
  ,
  minScheduleIntervalMs: 35
} as const;
const remotePrefetchComfortMultiplier = 1.5;
const remotePrefetchComfortFloorMs = 12_000;

export class ChunkScheduler {
  private roomSnapshot: RoomSnapshot | null = null;
  private availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>> = {};
  private connectedPeerIds = new Set<string>();
  private uploadedTrackIds = new Set<string>();
  private playbackPositionMs = 0;
  private playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null = null;
  private pageVisible = true;
  private mode: ChunkSchedulerMode = "normal";
  private bufferHealth: ChunkBufferHealth = "healthy";
  private playbackClockSource: PlaybackClockSource = "snapshot";
  private policy: ProgressiveSchedulerPolicy = "startup";
  private readonly trackStates = new Map<string, ChunkSchedulerTrackState>();
  private lastScheduleAt = 0;
  private scheduleTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.playbackStatus = input.playbackStatus ?? this.roomSnapshot?.room.playback.status ?? null;
    this.pageVisible = input.pageVisible ?? true;
    this.mode = input.mode ?? "normal";
    this.bufferHealth = input.bufferHealth ?? "healthy";
    this.playbackClockSource = input.playbackClockSource ?? "snapshot";
    this.policy = input.policy ?? "startup";
    this.reconcileTrackStates();
    this.requestSchedule("normal");
  }

  markPieceReceived(trackId: string, chunkIndex: number, totalChunks: number, peerId?: string | null) {
    const state = this.ensureTrackState(trackId, totalChunks);
    state.totalChunks = Math.max(state.totalChunks, totalChunks);
    state.ownedChunks.add(chunkIndex);
    state.pendingChunks.delete(chunkIndex);
    if (peerId) {
      state.cooledDownPeers.delete(peerId);
      state.peerFailures.delete(peerId);
    }
    this.requestSchedule("high");
  }

  markRequestTimeout(trackId: string, chunkIndex: number, peerId: string) {
    const state = this.trackStates.get(trackId);
    if (!state) {
      return;
    }

    const timeoutMs = state.pendingChunks.get(chunkIndex)?.timeoutMs ?? this.resolvePeerCooldownMs(3_000);
    const previousFailure = state.peerFailures.get(peerId);
    const timeoutStreak = (previousFailure?.timeoutStreak ?? 0) + 1;
    const cooldownMs = this.resolvePeerCooldownMs(timeoutMs, timeoutStreak);
    const cooledDownUntil = this.now() + cooldownMs;
    state.pendingChunks.delete(chunkIndex);
    state.cooledDownPeers.set(peerId, cooledDownUntil);
    state.peerFailures.set(peerId, {
      timeoutStreak,
      lastFailedAt: this.now(),
      cooledDownUntil
    });
    this.requestSchedule("normal");
  }

  markPeerUnavailable(peerId: string) {
    let changed = false;
    const now = this.now();

    for (const state of this.trackStates.values()) {
      for (const [chunkIndex, pendingRequest] of state.pendingChunks.entries()) {
        if (pendingRequest.peerId === peerId) {
          state.pendingChunks.delete(chunkIndex);
          changed = true;
        }
      }

      const previousFailure = state.peerFailures.get(peerId);
      const timeoutStreak = Math.max(1, (previousFailure?.timeoutStreak ?? 0) + 1);
      const cooledDownUntil = now + this.resolvePeerCooldownMs(3_000, timeoutStreak);
      state.cooledDownPeers.set(peerId, cooledDownUntil);
      state.peerFailures.set(peerId, {
        timeoutStreak,
        lastFailedAt: now,
        cooledDownUntil
      });
    }

    if (changed) {
      this.requestSchedule("high");
    }
  }

  getBufferedChunkCount(trackId: string) {
    return this.trackStates.get(trackId)?.ownedChunks.size ?? 0;
  }

  isTrackComplete(trackId: string, totalChunks?: number) {
    const state = this.trackStates.get(trackId);
    if (!state) {
      return false;
    }

    const expectedTotalChunks = Math.max(totalChunks ?? 0, state.totalChunks);
    return expectedTotalChunks > 0 && state.ownedChunks.size >= expectedTotalChunks;
  }

  private requestSchedule(priority: "high" | "normal" = "normal") {
    const elapsed = this.now() - this.lastScheduleAt;
    const minInterval = this.minScheduleIntervalMs();
    const delay = priority === "high" ? 0 : Math.max(0, minInterval - elapsed);

    if (delay === 0 && !this.scheduleTimer) {
      this.runSchedule();
      return;
    }

    if (this.scheduleTimer) {
      return;
    }

    this.scheduleTimer = setTimeout(() => {
      this.scheduleTimer = null;
      this.runSchedule();
    }, delay);
  }

  private runSchedule() {
    this.lastScheduleAt = this.now();

    if (!this.roomSnapshot) {
      return;
    }

    this.pruneCooldowns();
    const peerLoads = this.buildPeerLoadMap();
    const peerInFlightBytes = this.buildPeerInFlightByteMap();

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
          excludedPeerIds: new Set([this.localPeerId]),
          preferredPeerId: plan.preferredPeerId,
          peerLoads,
          peerInFlightBytes,
          chunkSize: plan.chunkSize,
          maxConcurrentPerPeer: plan.maxConcurrentPerPeer,
          priority: plan.priority,
          peerFailureStates: state.peerFailures,
          now: this.now(),
          resolvePeerRequestWindow: (candidatePeerId) =>
            this.resolvePeerRequestWindow(candidatePeerId, plan.track.id, plan.priority),
          resolvePeerMaxInFlightBytes: (candidatePeerId) =>
            this.resolvePeerMaxInFlightBytes(candidatePeerId, plan.track.id, plan.priority)
        });

        if (!peerId) {
          continue;
        }

        const timeoutMs = this.resolvePieceTimeoutMs(peerId, plan.track.id, plan.priority, plan.timeoutMs);
        const batchChunkIndexes = this.buildBatchChunkIndexes({
          state,
          trackId: plan.track.id,
          priority: plan.priority,
          peerId,
          chunkSize: plan.chunkSize,
          wantedChunks: plan.wantedChunks,
          startChunkIndex: chunkIndex,
          maxConcurrent: plan.maxConcurrent,
          activeTrackRequests: state.pendingChunks.size
        });
        const didRequest = this.options.requestPiece
          ? batchChunkIndexes.every((requestedChunkIndex) =>
              this.options.requestPiece?.({
                peerId,
                trackId: plan.track.id,
                chunkIndex: requestedChunkIndex,
                totalChunks: state.totalChunks,
                priority: plan.priority,
                timeoutMs
              }) !== false
            )
          : this.options.requestPieces?.({
              peerId,
              trackId: plan.track.id,
              chunkIndexes: batchChunkIndexes,
              totalChunks: state.totalChunks,
              priority: plan.priority,
              timeoutMs
            }) ?? false;

        if (!didRequest) {
          continue;
        }

        for (const requestedChunkIndex of batchChunkIndexes) {
          state.pendingChunks.set(requestedChunkIndex, {
            peerId,
            requestedAt: this.now(),
            chunkSize: plan.chunkSize,
            timeoutMs
          });
        }
        peerLoads.set(peerId, (peerLoads.get(peerId) ?? 0) + batchChunkIndexes.length);
        peerInFlightBytes.set(
          peerId,
          (peerInFlightBytes.get(peerId) ?? 0) + batchChunkIndexes.length * plan.chunkSize
        );
      }
    }
  }

  private buildTrackPlans(): TrackPlan[] {
    if (!this.roomSnapshot) {
      return [];
    }

    const manualPlans = this.buildManualTrackPlans();
    const isBackgroundHidden = !this.pageVisible;
    const shouldPreserveRemotePlayback =
      this.playbackClockSource === "remote" && this.playbackStatus === "playing";

    if (shouldPreserveRemotePlayback) {
      return [];
    }

    if (
      this.mode === "idle" ||
      (this.bufferHealth === "critical" && this.playbackStatus !== "playing") ||
      (isBackgroundHidden && this.playbackStatus !== "playing" && manualPlans.length === 0)
    ) {
      return manualPlans;
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
    let currentTrackManifest: ReturnType<typeof buildProgressiveTrackManifest> = null;
    let currentTrackState: ChunkSchedulerTrackState | null = null;
    let currentTrackAheadBufferedMs = 0;
    let comfortableCurrentTrackBufferMs = 0;
    let remotePrefetchReadyBufferedMs = 0;
    const shouldEnterOutrunRecovery = this.policy === "outrun-recovery";

    if (currentTrack && !this.uploadedTrackIds.has(currentTrack.id)) {
      const localAnnouncement = this.availabilityByTrack[currentTrack.id]?.[this.localPeerId] ?? null;
      currentTrackManifest = buildProgressiveTrackManifest(
        currentTrack,
        localAnnouncement ?? Object.values(this.availabilityByTrack[currentTrack.id] ?? {})[0] ?? null
      );
      currentTrackState = this.ensureTrackState(currentTrack.id, this.getTotalChunks(currentTrack.id));
      currentTrackAheadBufferedMs = currentTrackManifest
        ? getAheadBufferedMs({
            manifest: currentTrackManifest,
            availableChunks: [...currentTrackState.ownedChunks],
            playbackPositionMs: this.playbackPositionMs
          })
        : 0;
      comfortableCurrentTrackBufferMs = currentTrackManifest
        ? Math.max(
            getLowBufferThresholdMs() * 2,
            this.playbackClockSource === "remote"
              ? getRemoteFirstComfortBufferMs(currentTrackManifest)
              : Math.round(getTargetSteadyBufferMs(currentTrackManifest) * 0.75)
          )
        : 0;
      remotePrefetchReadyBufferedMs = Math.max(
        comfortableCurrentTrackBufferMs + remotePrefetchComfortFloorMs,
        Math.round(comfortableCurrentTrackBufferMs * remotePrefetchComfortMultiplier)
      );
      const isCurrentTrackComplete = this.isTrackComplete(
        currentTrack.id,
        this.getTotalChunks(currentTrack.id)
      );
      const currentTrackStartupReady = currentTrackManifest
        ? isStartupReady({
            manifest: currentTrackManifest,
            availableChunks: [...currentTrackState.ownedChunks],
            playbackPositionMs: this.playbackPositionMs
          })
        : false;
      const shouldUseAggressiveRemoteFlacStartup =
        !shouldPreserveRemotePlayback &&
        !!currentTrackManifest &&
        isFlacTrack(currentTrackManifest) &&
        !isCurrentTrackComplete &&
        !currentTrackStartupReady;
      const currentTrackProfile = shouldUseAggressiveRemoteFlacStartup
        ? getTrackStreamingProfile(currentTrack, this.mode, this.bufferHealth, "startup", "local")
        : getTrackStreamingProfile(
            currentTrack,
            this.mode,
            this.bufferHealth,
            shouldEnterOutrunRecovery ? "outrun-recovery" : this.policy,
            this.playbackClockSource
          );
      const currentTrackWantedPolicy = shouldUseAggressiveRemoteFlacStartup
        ? "startup"
        : shouldEnterOutrunRecovery
          ? "outrun-recovery"
        : currentTrackManifest && getProgressiveEngineType(currentTrackManifest) === "none"
          ? this.policy === "startup"
            ? "startup"
            : "pause-fill"
          : this.playbackStatus === "playing" &&
              !isCurrentTrackComplete &&
              currentTrackAheadBufferedMs >=
                (shouldPreserveRemotePlayback
                  ? remotePrefetchReadyBufferedMs
                  : comfortableCurrentTrackBufferMs) &&
              (this.policy === "steady" || this.policy === "background")
            ? "pause-fill"
          : this.policy === "background"
            ? "steady"
            : this.policy;
      plans.push({
        track: currentTrack,
        priority: "current",
        maxConcurrent: currentTrackProfile.maxConcurrent,
        maxConcurrentPerPeer: currentTrackProfile.maxConcurrentPerPeer,
        preferredPeerId: this.roomSnapshot.room.playback.sourcePeerId,
        chunkSize: currentTrackManifest?.chunkSize ?? this.getTrackChunkSize(currentTrack.id),
        wantedChunks:
          currentTrackManifest
            ? getPriorityChunkIndexes({
                manifest: currentTrackManifest,
                availableChunks: [...currentTrackState.ownedChunks],
                playbackPositionMs: this.playbackPositionMs,
                policy: currentTrackWantedPolicy,
                lookBehindMs: currentTrackProfile.lookBehindMs,
                lookAheadMs: currentTrackProfile.lookAheadMs
              })
            : getCurrentPlaybackWindowChunks({
                durationMs: currentTrack.durationMs,
                totalChunks: this.getTotalChunks(currentTrack.id),
                playbackPositionMs: this.playbackPositionMs,
                lookBehindMs: currentTrackProfile.lookBehindMs,
                lookAheadMs: currentTrackProfile.lookAheadMs
              }),
        timeoutMs: currentTrackProfile.timeoutMs
      });
    }

    const isCurrentTrackComplete =
      !!currentTrack &&
      this.isTrackComplete(currentTrack.id, this.getTotalChunks(currentTrack.id));
    const canPrefetchUpcomingTrack =
      !!currentTrackManifest &&
      !shouldEnterOutrunRecovery &&
      this.playbackClockSource !== "remote" &&
      this.policy === "steady" &&
      this.playbackStatus === "playing" &&
      this.mode === "normal" &&
      this.bufferHealth === "healthy" &&
      currentTrackAheadBufferedMs >= comfortableCurrentTrackBufferMs;
    const canWeakPrefetchUpcomingTrackOnRemote =
      !!currentTrackManifest &&
      shouldPreserveRemotePlayback &&
      !shouldEnterOutrunRecovery &&
      this.policy === "steady" &&
      this.mode === "normal" &&
      this.bufferHealth === "healthy" &&
      currentTrackAheadBufferedMs >= remotePrefetchReadyBufferedMs;

    if (
      !canPrefetchUpcomingTrack &&
      !canWeakPrefetchUpcomingTrackOnRemote &&
      (this.policy !== "background" || !isCurrentTrackComplete)
    ) {
      return dedupeTrackPlans([...plans, ...manualPlans]).filter(
        (plan) => plan.wantedChunks.length > 0
      );
    }

    const queuedTrackIds = this.roomSnapshot.queue
      .slice(Math.max(0, currentQueueIndex + 1))
      .map((item) => item.trackId);
    const nextQueuedTrackId = queuedTrackIds.find((trackId) => {
      if (this.uploadedTrackIds.has(trackId) || trackId === currentTrack?.id) {
        return false;
      }

      return !this.isTrackComplete(trackId, this.getTotalChunks(trackId));
    });
    const nextQueuedTrack = nextQueuedTrackId
      ? this.roomSnapshot.tracks.find((track) => track.id === nextQueuedTrackId) ?? null
      : null;

    if (nextQueuedTrack) {
      const queuedManifest = buildProgressiveTrackManifest(
        nextQueuedTrack,
        this.availabilityByTrack[nextQueuedTrack.id]?.[this.localPeerId] ??
          Object.values(this.availabilityByTrack[nextQueuedTrack.id] ?? {})[0] ??
          null
      );
      const queuedState = this.ensureTrackState(
        nextQueuedTrack.id,
        this.getTotalChunks(nextQueuedTrack.id)
      );
      plans.push({
        track: nextQueuedTrack,
        priority: "upcoming",
        maxConcurrent: shouldPreserveRemotePlayback
          ? this.bufferHealth === "healthy" && this.mode === "normal" && !isBackgroundHidden
            ? 2
            : 1
          : this.policy === "background" && !isBackgroundHidden
            ? 4
            : 3,
        maxConcurrentPerPeer: shouldPreserveRemotePlayback
          ? this.bufferHealth === "healthy" && this.mode === "normal" && !isBackgroundHidden
            ? 3
            : 1
          : this.policy === "background" && !isBackgroundHidden
            ? 2
            : 3,
        preferredPeerId: null,
        chunkSize: queuedManifest?.chunkSize ?? this.getTrackChunkSize(nextQueuedTrack.id),
        wantedChunks:
          queuedManifest
            ? getPriorityChunkIndexes({
                manifest: queuedManifest,
                availableChunks: [...queuedState.ownedChunks],
                playbackPositionMs: 0,
                policy: "startup",
                lookBehindMs: 0,
                lookAheadMs: this.upcomingPrefetchMs()
              })
            : getUpcomingWindowChunks({
                durationMs: nextQueuedTrack.durationMs,
                totalChunks: this.getTotalChunks(nextQueuedTrack.id),
                prefetchMs: this.upcomingPrefetchMs()
              }),
        timeoutMs: shouldPreserveRemotePlayback
          ? this.bufferHealth === "healthy"
            ? 2_600
            : 3_000
          : this.policy === "background"
            ? 2_500
            : 1_800
      });
      return plans
        .map((plan) =>
          isBackgroundHidden && plan.priority === "upcoming"
            ? {
                ...plan,
                maxConcurrent: Math.min(plan.maxConcurrent, 1),
                maxConcurrentPerPeer: Math.min(plan.maxConcurrentPerPeer, 1),
                wantedChunks: plan.wantedChunks.slice(0, 1)
              }
            : plan
        )
        .filter((plan) => plan.wantedChunks.length > 0);
    }

    const canBackgroundPrefetchOnRemote =
      shouldPreserveRemotePlayback &&
      this.mode === "normal" &&
      this.bufferHealth === "healthy" &&
      currentTrackAheadBufferedMs >= remotePrefetchReadyBufferedMs;

    if (
      isBackgroundHidden ||
      (this.policy !== "background" && !canBackgroundPrefetchOnRemote) ||
      !isCurrentTrackComplete
    ) {
      return dedupeTrackPlans([...plans, ...manualPlans]).filter(
        (plan) => plan.wantedChunks.length > 0
      );
    }

    for (const track of this.roomSnapshot.tracks) {
      if (this.uploadedTrackIds.has(track.id) || track.id === currentTrack?.id) {
        continue;
      }

      if (this.isTrackComplete(track.id, this.getTotalChunks(track.id))) {
        continue;
      }

      plans.push({
        track,
        priority: "background",
        maxConcurrent: 1,
        maxConcurrentPerPeer: 1,
        preferredPeerId: null,
        chunkSize: this.getTrackChunkSize(track.id),
        wantedChunks: getBackgroundChunks({
          totalChunks: this.getTotalChunks(track.id),
          ownedChunks: this.ensureTrackState(track.id, this.getTotalChunks(track.id)).ownedChunks,
          pendingChunks: this.ensureTrackState(track.id, this.getTotalChunks(track.id)).pendingChunks,
          batchSize: shouldPreserveRemotePlayback ? 1 : this.backgroundChunkBatchSize()
        }),
        timeoutMs: shouldPreserveRemotePlayback ? 4_500 : 4_000
      });
      break;
    }

    return dedupeTrackPlans([...plans, ...manualPlans]).filter(
      (plan) => plan.wantedChunks.length > 0
    );
  }

  private buildManualTrackPlans() {
    return [] as TrackPlan[];
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
      cooledDownPeers: new Map(),
      peerFailures: new Map()
    };
    this.trackStates.set(trackId, nextState);
    return nextState;
  }

  private getTotalChunks(trackId: string) {
    const stateTotalChunks = this.trackStates.get(trackId)?.totalChunks ?? 0;
    const availabilityTotalChunks = this.getCanonicalTrackAvailability(trackId)?.totalChunks ?? 0;
    const trackTotalChunks = this.getSnapshotTrackManifest(trackId)?.totalChunks ?? 0;

    if (availabilityTotalChunks > 0) {
      return availabilityTotalChunks;
    }

    if (stateTotalChunks > 0) {
      return stateTotalChunks;
    }

    return trackTotalChunks;
  }

  private getTrackChunkSize(trackId: string) {
    const availabilityChunkSize = this.getCanonicalTrackAvailability(trackId)?.chunkSize ?? 0;
    const trackChunkSize = this.getSnapshotTrackManifest(trackId)?.chunkSize ?? 0;

    if (availabilityChunkSize > 0) {
      return availabilityChunkSize;
    }

    if (trackChunkSize > 0) {
      return trackChunkSize;
    }

    return 128 * 1024;
  }

  private getCanonicalTrackAvailability(trackId: string) {
    const roomId = this.roomSnapshot?.room.id ?? null;
    const candidates = Object.values(this.availabilityByTrack[trackId] ?? {}).filter(
      (announcement) =>
        announcement.totalChunks > 0 &&
        announcement.chunkSize > 0 &&
        (!roomId || announcement.roomId === roomId)
    );

    if (candidates.length === 0) {
      return null;
    }

    return [...candidates].sort((left, right) => {
      const chunkSizeDifference = right.chunkSize - left.chunkSize;
      if (chunkSizeDifference !== 0) {
        return chunkSizeDifference;
      }

      const totalChunkDifference = left.totalChunks - right.totalChunks;
      if (totalChunkDifference !== 0) {
        return totalChunkDifference;
      }

      return new Date(right.announcedAt).getTime() - new Date(left.announcedAt).getTime();
    })[0];
  }

  private getSnapshotTrackManifest(trackId: string) {
    const track = this.roomSnapshot?.tracks.find((entry) => entry.id === trackId) ?? null;
    return track?.relayManifest ?? track?.pieceManifest ?? null;
  }

  private pruneCooldowns() {
    const now = this.now();

    for (const state of this.trackStates.values()) {
      for (const [peerId, expiresAt] of state.cooledDownPeers.entries()) {
        if (expiresAt <= now) {
          state.cooledDownPeers.delete(peerId);
        }
      }
      for (const [peerId, failure] of state.peerFailures.entries()) {
        if (failure.cooledDownUntil <= now && now - failure.lastFailedAt > 60_000) {
          state.peerFailures.delete(peerId);
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

  private buildPeerInFlightByteMap() {
    const peerInFlightBytes = new Map<string, number>();

    for (const state of this.trackStates.values()) {
      for (const pendingRequest of state.pendingChunks.values()) {
        peerInFlightBytes.set(
          pendingRequest.peerId,
          (peerInFlightBytes.get(pendingRequest.peerId) ?? 0) + pendingRequest.chunkSize
        );
      }
    }

    return peerInFlightBytes;
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  private peerCooldownMs() {
    return this.options.peerCooldownMs ?? DEFAULTS.peerCooldownMs;
  }

  private resolvePeerCooldownMs(timeoutMs: number, timeoutStreak = 1) {
    const multiplier = Math.min(4, 2 ** Math.max(0, timeoutStreak - 1));
    return Math.min(20_000, Math.max(this.peerCooldownMs(), Math.round(timeoutMs * 1.5 * multiplier)));
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

  private minScheduleIntervalMs() {
    return this.options.minScheduleIntervalMs ?? DEFAULTS.minScheduleIntervalMs;
  }

  private resolvePeerRequestWindow(
    peerId: string,
    trackId: string,
    priority: ChunkSchedulerPriority
  ) {
    return this.options.resolvePeerRequestWindow?.(peerId, trackId, priority) ?? null;
  }

  private resolvePeerMaxInFlightBytes(
    peerId: string,
    trackId: string,
    priority: ChunkSchedulerPriority
  ) {
    const window = this.resolvePeerRequestWindow(peerId, trackId, priority);
    if (!window) {
      return 2 * 1024 * 1024;
    }

    const constrainedTransport =
      window.protocol === "tcp" || window.candidateType === "relay";
    if (window.transportScore === "failed" || window.transportScore === "unstable") {
      return 1024 * 1024;
    }

    if ((window.bufferedAmountBytes ?? 0) >= 768 * 1024) {
      return 1024 * 1024;
    }

    if (constrainedTransport) {
      return 1024 * 1024;
    }

    if (window.transportScore === "degraded") {
      return 2 * 1024 * 1024;
    }

    if ((window.downloadRateKbps ?? 0) >= 4_000) {
      return 8 * 1024 * 1024;
    }

    if ((window.downloadRateKbps ?? 0) >= 1_500) {
      return 4 * 1024 * 1024;
    }

    return 2 * 1024 * 1024;
  }

  private resolvePieceTimeoutMs(
    peerId: string,
    trackId: string,
    priority: ChunkSchedulerPriority,
    fallbackTimeoutMs?: number
  ) {
    const window = this.resolvePeerRequestWindow(peerId, trackId, priority);
    const rttMs = Math.max(0, Math.round(window?.currentRoundTripTimeMs ?? 0));
    const adaptiveFloor = Math.max(fallbackTimeoutMs ?? 0, 3_000, rttMs * 6);
    return Math.min(10_000, Math.max(3_000, adaptiveFloor));
  }

  private buildBatchChunkIndexes(input: {
    state: ChunkSchedulerTrackState;
    trackId: string;
    priority: ChunkSchedulerPriority;
    peerId: string;
    chunkSize: number;
    wantedChunks: number[];
    startChunkIndex: number;
    maxConcurrent: number;
    activeTrackRequests: number;
  }) {
    const window = this.resolvePeerRequestWindow(input.peerId, input.trackId, input.priority);
    const constrainedTransport =
      window?.protocol === "tcp" ||
      window?.candidateType === "relay" ||
      window?.transportScore === "degraded" ||
      window?.transportScore === "unstable" ||
      (window?.bufferedAmountBytes ?? 0) >= 512 * 1024;
    const maxBatchSize = constrainedTransport ? 2 : 8;
    const remainingSlots = Math.max(1, input.maxConcurrent - input.activeTrackRequests);
    const resolvedBatchSize = Math.max(1, Math.min(maxBatchSize, remainingSlots));
    const availability = Object.values(this.availabilityByTrack[input.trackId] ?? {}).find(
      (announcement) => announcement.ownerPeerId === input.peerId
    );
    const availableChunks = new Set(availability?.availableChunks ?? []);
    const batch = [input.startChunkIndex];

    for (const candidateChunkIndex of input.wantedChunks) {
      if (batch.length >= resolvedBatchSize) {
        break;
      }

      if (candidateChunkIndex <= input.startChunkIndex) {
        continue;
      }

      const previousChunkIndex = batch[batch.length - 1] ?? input.startChunkIndex;
      if (candidateChunkIndex !== previousChunkIndex + 1) {
        break;
      }

      if (
        input.state.ownedChunks.has(candidateChunkIndex) ||
        input.state.pendingChunks.has(candidateChunkIndex) ||
        !availableChunks.has(candidateChunkIndex)
      ) {
        break;
      }

      batch.push(candidateChunkIndex);
    }

    return batch;
  }
}

export function deriveTrackStreamProfile(track: TrackMeta): TrackStreamProfile {
  const codec = track.codec?.toLowerCase() ?? "";
  const sizeBytes = track.sizeBytes ?? 0;
  const isLossless = codec.includes("flac") || codec.includes("alac") || codec.includes("wav");

  if (isLossless && sizeBytes >= 25 * 1024 * 1024) {
    return "large-lossless";
  }

  if (sizeBytes >= 40 * 1024 * 1024) {
    return "large-compressed";
  }

  return "standard";
}

function getTrackStreamingProfile(
  track: TrackMeta,
  mode: ChunkSchedulerMode,
  bufferHealth: ChunkBufferHealth,
  policy: ProgressiveSchedulerPolicy,
  playbackClockSource: PlaybackClockSource
) {
  const streamProfile = deriveTrackStreamProfile(track);

  if (playbackClockSource === "remote") {
    const remoteBootstrapConservative = mode === "conservative" || bufferHealth !== "healthy";
    if (policy === "outrun-recovery") {
      if (remoteBootstrapConservative) {
        return {
          maxConcurrent: streamProfile === "large-lossless" ? 6 : 4,
          maxConcurrentPerPeer: 2,
          lookBehindMs: 0,
          lookAheadMs: streamProfile === "large-lossless" ? 48_000 : 32_000,
          timeoutMs: 2_200
        };
      }
      return {
        maxConcurrent: streamProfile === "large-lossless" ? 8 : 6,
        maxConcurrentPerPeer: 2,
        lookBehindMs: 0,
        lookAheadMs: streamProfile === "large-lossless" ? 64_000 : 40_000,
        timeoutMs: 2_000
      };
    }
    if (remoteBootstrapConservative) {
      return {
        maxConcurrent: streamProfile === "large-lossless" ? 4 : 3,
        maxConcurrentPerPeer: 1,
        lookBehindMs: 0,
        lookAheadMs: streamProfile === "large-lossless" ? 32_000 : 24_000,
        timeoutMs: 2_600
      };
    }
    return {
      maxConcurrent: streamProfile === "large-lossless" ? 5 : 4,
      maxConcurrentPerPeer: 1,
      lookBehindMs: 0,
      lookAheadMs: streamProfile === "large-lossless" ? 40_000 : 28_000,
      timeoutMs: 2_400
    };
  }

  if (policy === "outrun-recovery") {
    return {
      maxConcurrent: streamProfile === "large-lossless" ? 28 : 22,
      maxConcurrentPerPeer: streamProfile === "large-lossless" ? 9 : 7,
      lookBehindMs: 0,
      lookAheadMs: streamProfile === "large-lossless" ? 300_000 : 170_000,
      timeoutMs: streamProfile === "large-lossless" ? 750 : 850
    };
  }

  if (policy === "catchup") {
    return {
      maxConcurrent: streamProfile === "large-lossless" ? 24 : 20,
      maxConcurrentPerPeer: streamProfile === "large-lossless" ? 8 : 6,
      lookBehindMs: 0,
      lookAheadMs: streamProfile === "large-lossless" ? 160_000 : 96_000,
      timeoutMs: streamProfile === "large-lossless" ? 850 : 1_000
    };
  }

  if (policy === "startup") {
    return {
      maxConcurrent: streamProfile === "large-lossless" ? 22 : 18,
      maxConcurrentPerPeer: streamProfile === "large-lossless" ? 7 : 6,
      lookBehindMs: 0,
      lookAheadMs: streamProfile === "large-lossless" ? 128_000 : 72_000,
      timeoutMs: streamProfile === "large-lossless" ? 850 : 1_000
    };
  }

  if (policy === "pause-fill") {
    return {
      maxConcurrent: 16,
      maxConcurrentPerPeer: 5,
      lookBehindMs: 0,
      lookAheadMs: streamProfile === "large-lossless" ? 180_000 : 112_000,
      timeoutMs: 1_400
    };
  }

  if (bufferHealth === "critical") {
    return {
      maxConcurrent: 14,
      maxConcurrentPerPeer: 5,
      lookBehindMs: 4_000,
      lookAheadMs: streamProfile === "large-lossless" ? 112_000 : 72_000,
      timeoutMs: 1_500
    };
  }

  if (mode === "conservative" || bufferHealth === "low") {
    return {
      maxConcurrent: 10,
      maxConcurrentPerPeer: 4,
      lookBehindMs: 8_000,
      lookAheadMs: streamProfile === "large-lossless" ? 96_000 : 56_000,
      timeoutMs: 1_700
    };
  }

  if (streamProfile === "large-lossless") {
    return {
      maxConcurrent: 14,
      maxConcurrentPerPeer: 5,
      lookBehindMs: 6_000,
      lookAheadMs: 120_000,
      timeoutMs: 1_500
    };
  }

  if (streamProfile === "large-compressed") {
    return {
      maxConcurrent: 12,
      maxConcurrentPerPeer: 5,
      lookBehindMs: 6_000,
      lookAheadMs: 72_000,
      timeoutMs: 1_700
    };
  }

  return {
    maxConcurrent: DEFAULTS.maxConcurrentCurrentTrack,
    maxConcurrentPerPeer: 5,
    lookBehindMs: DEFAULTS.currentLookBehindMs,
    lookAheadMs: DEFAULTS.currentLookAheadMs,
    timeoutMs: 1_600
  };
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
  peerInFlightBytes: Map<string, number>;
  chunkSize: number;
  maxConcurrentPerPeer: number;
  priority?: ChunkSchedulerPriority;
  peerFailureStates?: Map<string, { timeoutStreak: number; lastFailedAt: number; cooledDownUntil: number }>;
  now?: number;
  resolvePeerRequestWindow?: (peerId: string) => PeerRequestWindow | null | undefined;
  resolvePeerMaxInFlightBytes?: (peerId: string) => number;
}) {
  const {
    announcements,
    chunkIndex,
    connectedPeerIds,
    excludedPeerIds,
    preferredPeerId,
    peerLoads,
    peerInFlightBytes,
    chunkSize,
    maxConcurrentPerPeer,
    priority = "current",
    peerFailureStates,
    now = Date.now(),
    resolvePeerRequestWindow,
    resolvePeerMaxInFlightBytes
  } = input;

  const candidates = announcements.filter(
    (announcement) => {
      const peerId = announcement.ownerPeerId;
      const failure = peerFailureStates?.get(peerId);
      const window = resolvePeerRequestWindow?.(peerId);
      const maxInFlightBytes =
        resolvePeerMaxInFlightBytes?.(peerId) ?? Number.MAX_SAFE_INTEGER;
      const maxPeerSlots = Math.max(
        1,
        Math.min(maxConcurrentPerPeer, Math.floor(maxInFlightBytes / Math.max(1, chunkSize)))
      );

      return (
        announcement.availableChunks.includes(chunkIndex) &&
        connectedPeerIds.has(peerId) &&
        !excludedPeerIds.has(peerId) &&
        (failure?.cooledDownUntil ?? 0) <= now &&
        !(priority === "current" && (window?.transportScore === "failed" || window?.transportScore === "unstable")) &&
        (window?.bufferedAmountBytes ?? 0) < maxInFlightBytes &&
        (peerLoads.get(peerId) ?? 0) < maxPeerSlots &&
        (peerInFlightBytes.get(peerId) ?? 0) < maxInFlightBytes
      );
    }
  );

  if (candidates.length === 0) {
    return null;
  }

  if (preferredPeerId && candidates.some((announcement) => announcement.ownerPeerId === preferredPeerId)) {
    const preferredWindow = resolvePeerRequestWindow?.(preferredPeerId);
    const preferredFailure = peerFailureStates?.get(preferredPeerId);
    const preferredIsViable =
      (preferredFailure?.timeoutStreak ?? 0) === 0 &&
      preferredWindow?.transportScore !== "degraded";
    if (preferredIsViable) {
      return preferredPeerId;
    }
  }

  candidates.sort((left, right) => {
    const scoreDifference =
      scoreChunkPeer({
        peerId: left.ownerPeerId,
        availableChunks: left.availableChunks.length,
        announcedAt: left.announcedAt,
        preferredPeerId,
        peerLoads,
        peerInFlightBytes,
        failure: peerFailureStates?.get(left.ownerPeerId),
        window: resolvePeerRequestWindow?.(left.ownerPeerId)
      }) -
      scoreChunkPeer({
        peerId: right.ownerPeerId,
        availableChunks: right.availableChunks.length,
        announcedAt: right.announcedAt,
        preferredPeerId,
        peerLoads,
        peerInFlightBytes,
        failure: peerFailureStates?.get(right.ownerPeerId),
        window: resolvePeerRequestWindow?.(right.ownerPeerId)
      });
    if (scoreDifference !== 0) {
      return scoreDifference;
    }

    const loadDifference =
      (peerLoads.get(left.ownerPeerId) ?? 0) - (peerLoads.get(right.ownerPeerId) ?? 0);
    if (loadDifference !== 0) {
      return loadDifference;
    }

    const inFlightDifference =
      (peerInFlightBytes.get(left.ownerPeerId) ?? 0) -
      (peerInFlightBytes.get(right.ownerPeerId) ?? 0);
    if (inFlightDifference !== 0) {
      return inFlightDifference;
    }

    const chunkDifference = right.availableChunks.length - left.availableChunks.length;
    if (chunkDifference !== 0) {
      return chunkDifference;
    }

    return new Date(right.announcedAt).getTime() - new Date(left.announcedAt).getTime();
  });

  return candidates[0]?.ownerPeerId ?? null;
}

function scoreChunkPeer(input: {
  peerId: string;
  availableChunks: number;
  announcedAt: string;
  preferredPeerId: string | null;
  peerLoads: Map<string, number>;
  peerInFlightBytes: Map<string, number>;
  failure?: { timeoutStreak: number; lastFailedAt: number; cooledDownUntil: number };
  window?: PeerRequestWindow | null;
}) {
  const transportPenalty =
    input.window?.transportScore === "failed"
      ? 10_000
      : input.window?.transportScore === "unstable"
        ? 5_000
        : input.window?.transportScore === "degraded"
          ? 500
          : 0;
  const relayPenalty =
    input.window?.candidateType === "relay" || input.window?.protocol === "tcp" ? 150 : 0;
  const failurePenalty = (input.failure?.timeoutStreak ?? 0) * 1_000;
  const rttPenalty = Math.min(500, Math.max(0, input.window?.currentRoundTripTimeMs ?? 0));
  const speedBonus = Math.min(300, Math.max(0, (input.window?.downloadRateKbps ?? 0) / 20));
  const preferredBonus = input.preferredPeerId === input.peerId ? 120 : 0;
  const freshnessBonus = Math.min(60, Math.max(0, new Date(input.announcedAt).getTime() / 1_000_000_000));

  return (
    transportPenalty +
    relayPenalty +
    failurePenalty +
    rttPenalty +
    (input.peerLoads.get(input.peerId) ?? 0) * 100 +
    Math.round((input.peerInFlightBytes.get(input.peerId) ?? 0) / (128 * 1024)) * 10 -
    input.availableChunks -
    speedBonus -
    preferredBonus -
    freshnessBonus
  );
}

function dedupeTrackPlans(plans: TrackPlan[]) {
  const seenTrackIds = new Set<string>();
  return plans.filter((plan) => {
    if (seenTrackIds.has(plan.track.id)) {
      return false;
    }
    seenTrackIds.add(plan.track.id);
    return true;
  });
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
