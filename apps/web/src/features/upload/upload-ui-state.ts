import type { RoomSnapshot } from "@music-room/shared";
import type { ManualCacheTaskRecord } from "@/lib/indexeddb";
import { hasActivePlaybackIntent } from "@/features/playback/progressive-playback";
import { isCurrentPlaybackSourceDevice } from "@/features/playback/playback-source-identity";
import {
  buildManualCachePieceAvailabilityAnnouncement,
  isManualCachePieceCompatible
} from "./track-availability";

export type ManualCacheTaskStatus =
  | "idle"
  | "queued"
  | "downloading"
  | "paused"
  | "blocked"
  | "assembling"
  | "ready"
  | "failed"
  | "failed-integrity";

export type ManualCacheTask = {
  trackId: string;
  status: ManualCacheTaskStatus;
  mode: "manual" | "playback-demand";
  fileHash: string;
  updatedAt: string;
  errorMessage: string | null;
  completedChunks: number;
  totalChunks: number;
  mimeType: string | null;
  manifestSource: string | null;
  blockedReason: string | null;
  integrityMode: "strong" | "weak" | null;
  providerPeerIds: string[];
  connectedProviderPeerIds: string[];
  selectedProviderPeerId: string | null;
  requestableChunkCount: number;
  pendingChunkCount: number;
  lastRequestedChunks: number[];
  lastPieceReceivedAt: string | null;
  lastError: string | null;
};

type ManualCacheTaskPatch =
  | Partial<ManualCacheTask>
  | ((current: ManualCacheTask | null) => Partial<ManualCacheTask> | null);

export function buildNextManualCacheTask(input: {
  trackId: string;
  existing: ManualCacheTask | null;
  track: { fileHash: string; mimeType?: string | null } | null;
  patch: ManualCacheTaskPatch;
  updatedAt: string;
}) {
  const nextPatch = typeof input.patch === "function" ? input.patch(input.existing) : input.patch;
  if (!nextPatch) {
    return null;
  }

  return {
    trackId: input.trackId,
    status: input.existing?.status ?? "idle",
    mode: input.existing?.mode ?? "manual",
    fileHash: input.existing?.fileHash ?? input.track?.fileHash ?? "",
    errorMessage: input.existing?.errorMessage ?? null,
    completedChunks: input.existing?.completedChunks ?? 0,
    totalChunks: input.existing?.totalChunks ?? 0,
    mimeType: input.existing?.mimeType ?? input.track?.mimeType ?? null,
    manifestSource: input.existing?.manifestSource ?? null,
    blockedReason: input.existing?.blockedReason ?? null,
    integrityMode: input.existing?.integrityMode ?? null,
    providerPeerIds: input.existing?.providerPeerIds ?? [],
    connectedProviderPeerIds: input.existing?.connectedProviderPeerIds ?? [],
    selectedProviderPeerId: input.existing?.selectedProviderPeerId ?? null,
    requestableChunkCount: input.existing?.requestableChunkCount ?? 0,
    pendingChunkCount: input.existing?.pendingChunkCount ?? 0,
    lastRequestedChunks: input.existing?.lastRequestedChunks ?? [],
    lastPieceReceivedAt: input.existing?.lastPieceReceivedAt ?? null,
    lastError: input.existing?.lastError ?? null,
    ...nextPatch,
    updatedAt: input.updatedAt
  } satisfies ManualCacheTask;
}

export function mergeHydratedManualCacheTasks(input: {
  currentTasks: Record<string, ManualCacheTask>;
  hydratedTasks: ManualCacheTaskRecord[];
  currentPlaybackTrackId: string | null;
}) {
  const hydrated = Object.fromEntries(
    input.hydratedTasks
      .filter(isManualCacheTaskRecord)
      .filter((task) => task.mode === "manual" || task.trackId === input.currentPlaybackTrackId)
      .map((task) => {
        const status = task.status;
        return [
          task.trackId,
          {
            trackId: task.trackId,
            status,
            mode: task.mode,
            fileHash: task.fileHash,
            updatedAt: task.updatedAt,
            errorMessage: task.errorMessage,
            completedChunks: task.completedChunks,
            totalChunks: task.totalChunks,
            mimeType: task.mimeType,
            manifestSource: task.manifestSource,
            blockedReason: task.blockedReason,
            integrityMode: task.integrityMode,
            providerPeerIds: task.providerPeerIds,
            connectedProviderPeerIds: task.connectedProviderPeerIds,
            selectedProviderPeerId: task.selectedProviderPeerId,
            requestableChunkCount: task.requestableChunkCount,
            pendingChunkCount: task.pendingChunkCount,
            lastRequestedChunks: task.lastRequestedChunks,
            lastPieceReceivedAt: task.lastPieceReceivedAt,
            lastError: task.lastError
          } satisfies ManualCacheTask
        ];
      })
  );

  const preservedCurrent = Object.fromEntries(
    Object.entries(input.currentTasks).filter(([, task]) => {
      if (task.mode === "manual") {
        return true;
      }

      return task.mode === "playback-demand" && task.trackId === input.currentPlaybackTrackId;
    })
  );

  return {
    ...hydrated,
    ...preservedCurrent
  };
}

export function resolveStalePlaybackDemandTaskIds(input: {
  currentTasks: Record<string, ManualCacheTask>;
  currentPlaybackTrackId: string | null;
}) {
  return Object.values(input.currentTasks)
    .filter(
      (task) =>
        task.mode === "playback-demand" &&
        task.trackId !== input.currentPlaybackTrackId
    )
    .map((task) => task.trackId)
    .sort();
}

export function shouldHydrateCacheTaskPieceIndexes(input: {
  mode: ManualCacheTaskRecord["mode"];
  status: ManualCacheTaskRecord["status"];
}) {
  return (
    (input.mode === "manual" || input.mode === "playback-demand") &&
    (input.status === "queued" ||
      input.status === "downloading" ||
      input.status === "blocked")
  );
}

export function shouldCreatePlaybackDemandTaskFromCachePiece(input: {
  playback: RoomSnapshot["room"]["playback"] | null | undefined;
  trackId: string;
  peerId: string | null | undefined;
  activeSessionId: string | null | undefined;
  hasLocalFullTrack?: boolean;
  hasCurrentTask: boolean;
}) {
  const playback = input.playback;
  if (
    input.hasCurrentTask ||
    !playback?.currentTrackId ||
    playback.currentTrackId !== input.trackId ||
    !hasActivePlaybackIntent(playback)
  ) {
    return false;
  }

  return !isCurrentPlaybackSourceDevice({
    playback,
    peerId: input.peerId,
    activeSessionId: input.activeSessionId
  }) || input.hasLocalFullTrack === false;
}

function isManualCacheTaskRecord(
  task: ManualCacheTaskRecord
): task is ManualCacheTaskRecord & { mode: "manual" | "playback-demand" } {
  return task.mode === "manual" || task.mode === "playback-demand";
}

export function resolveAutomaticPlaybackCacheTaskMode(): ManualCacheTask["mode"] {
  return "playback-demand";
}

export function mergeManualCachePlanTaskProgress(input: {
  current:
    | Pick<
        ManualCacheTask,
        | "completedChunks"
        | "totalChunks"
        | "status"
        | "blockedReason"
        | "lastPieceReceivedAt"
        | "lastError"
      >
    | null
    | undefined;
  planLocalPieceIndexes: number[];
  inMemoryPieceIndexes: Set<number> | null | undefined;
  planTotalChunks: number | null | undefined;
  planBlockedReason: string | null | undefined;
}) {
  const currentCompletedChunks = input.current?.completedChunks ?? 0;
  const indexedPieceCount = input.planLocalPieceIndexes.length;
  const inMemoryPieceCount = input.inMemoryPieceIndexes?.size ?? 0;
  const completedChunks = Math.max(
    currentCompletedChunks,
    indexedPieceCount,
    inMemoryPieceCount
  );
  const totalChunks = Math.max(input.current?.totalChunks ?? 0, input.planTotalChunks ?? 0);
  const isComplete = totalChunks > 0 && completedChunks >= totalChunks;
  const pendingWindowFull = input.planBlockedReason === "pending-window-full";
  const actuallyBlocked =
    !!input.planBlockedReason && input.planBlockedReason !== "complete" && !pendingWindowFull;

  return {
    completedChunks,
    totalChunks,
    status:
      actuallyBlocked && !isComplete
        ? ("blocked" as const)
        : !input.current ||
            input.current.status === "queued" ||
            input.current.status === "blocked"
          ? ("downloading" as const)
          : input.current.status,
    blockedReason: input.planBlockedReason === "complete" || isComplete ? null : input.planBlockedReason,
    lastPieceReceivedAt: input.current?.lastPieceReceivedAt ?? null,
    lastError: actuallyBlocked && !isComplete ? input.planBlockedReason : (input.current?.lastError ?? null)
  };
}

export function mergeManualCachePieceTaskProgress(input: {
  current:
    | Pick<ManualCacheTask, "completedChunks" | "totalChunks" | "status">
    | null
    | undefined;
  knownChunkIndexes: Set<number> | null | undefined;
  receivedTotalChunks: number | null | undefined;
}) {
  const completedChunks = Math.max(
    input.current?.completedChunks ?? 0,
    input.knownChunkIndexes?.size ?? 0
  );
  const totalChunks = Math.max(input.current?.totalChunks ?? 0, input.receivedTotalChunks ?? 0);

  return {
    completedChunks,
    totalChunks,
    status:
      input.current?.status === "paused" ||
      input.current?.status === "ready" ||
      input.current?.status === "assembling"
        ? input.current.status
        : ("downloading" as const)
  };
}

export function shouldIgnoreManualCachePieceTaskUpdate(status: ManualCacheTaskStatus) {
  return status === "ready" || status === "assembling";
}

export function resolveManualCachePieceReceivedAction(input: {
  piece: {
    trackId: string;
    chunkIndex: number;
    totalChunks: number;
    chunkSize: number;
    mimeType: string;
  };
  currentTask: ManualCacheTask | null;
  knownChunkIndexes: Set<number>;
  track: {
    id: string;
    fileHash: string;
    mimeType?: string | null;
    relayManifest?: { totalChunks: number; chunkSize: number } | null;
    pieceManifest?: { totalChunks: number; chunkSize: number; pieceMimeType?: string | null } | null;
  } | null;
  roomId: string | null | undefined;
  activeSession: { userId: string; nickname: string } | null;
  peerId: string | null | undefined;
  playback: RoomSnapshot["room"]["playback"] | null | undefined;
  hasLocalFullTrack: boolean;
  nowIso: string;
}) {
  const expectedManifest = input.track?.relayManifest ?? input.track?.pieceManifest ?? null;
  if (
    !isManualCachePieceCompatible({
      piece: input.piece,
      expectedManifest
    })
  ) {
    return {
      accepted: false,
      nextChunkIndexes: new Set(input.knownChunkIndexes),
      availability: null,
      taskPatch: null,
      assembleRequest: null
    };
  }

  const nextChunkIndexes = new Set(input.knownChunkIndexes);
  nextChunkIndexes.add(input.piece.chunkIndex);

  const availability =
    input.roomId && input.activeSession && input.peerId && input.track
      ? buildManualCachePieceAvailabilityAnnouncement({
          existing: undefined,
          roomId: input.roomId,
          trackId: input.piece.trackId,
          fileHash: input.track.fileHash,
          peerId: input.peerId,
          nickname: input.activeSession.nickname,
          chunkIndex: input.piece.chunkIndex,
          totalChunks: input.piece.totalChunks,
          chunkSize: input.piece.chunkSize,
          availableChunks: [...nextChunkIndexes]
        })
      : null;

  let current = input.currentTask;
  if (
    !current &&
    shouldCreatePlaybackDemandTaskFromCachePiece({
      playback: input.playback,
      trackId: input.piece.trackId,
      peerId: input.peerId,
      activeSessionId: input.activeSession?.userId,
      hasLocalFullTrack: input.hasLocalFullTrack,
      hasCurrentTask: false
    })
  ) {
    current = {
      trackId: input.piece.trackId,
      status: "downloading",
      mode: resolveAutomaticPlaybackCacheTaskMode(),
      fileHash: input.track?.fileHash ?? "",
      updatedAt: input.nowIso,
      errorMessage: null,
      completedChunks: 0,
      totalChunks: input.piece.totalChunks,
      mimeType: input.piece.mimeType || input.track?.mimeType || null,
      manifestSource: expectedManifest ? "snapshot" : null,
      blockedReason: null,
      integrityMode: "weak",
      providerPeerIds: [],
      connectedProviderPeerIds: [],
      selectedProviderPeerId: null,
      requestableChunkCount: 0,
      pendingChunkCount: 0,
      lastRequestedChunks: [],
      lastPieceReceivedAt: null,
      lastError: null
    };
  }

  if (!current || shouldIgnoreManualCachePieceTaskUpdate(current.status)) {
    return {
      accepted: true,
      nextChunkIndexes,
      availability,
      taskPatch: null,
      assembleRequest: null
    };
  }

  const progress = mergeManualCachePieceTaskProgress({
    current,
    knownChunkIndexes: nextChunkIndexes,
    receivedTotalChunks: input.piece.totalChunks
  });
  const shouldAssemble =
    current.status !== "paused" &&
    progress.totalChunks > 0 &&
    progress.completedChunks >= progress.totalChunks;
  const taskPatch = {
    status: current.status === "paused" || shouldAssemble ? current.status : progress.status,
    errorMessage: null,
    blockedReason: null,
    completedChunks: progress.completedChunks,
    totalChunks: progress.totalChunks,
    mimeType: input.piece.mimeType || current.mimeType,
    lastPieceReceivedAt: input.nowIso,
    lastError: null
  } satisfies Partial<ManualCacheTask>;

  return {
    accepted: true,
    nextChunkIndexes,
    availability,
    taskPatch,
    assembleRequest: shouldAssemble
      ? {
          trackId: input.piece.trackId,
          mimeType: input.piece.mimeType,
          totalChunks: Math.max(input.piece.totalChunks, nextChunkIndexes.size)
        }
      : null
  };
}

export function pruneManualCacheChunkIndexesByActiveTracks(
  chunkIndexesByTrack: Map<string, Set<number>>,
  activeTrackIds: Set<string>
) {
  for (const trackId of chunkIndexesByTrack.keys()) {
    if (!activeTrackIds.has(trackId)) {
      chunkIndexesByTrack.delete(trackId);
    }
  }
}

export function shouldAssembleManualCachePlanProgress(input: {
  status: ManualCacheTaskStatus | null | undefined;
  completedChunks: number;
  totalChunks: number;
}) {
  return (
    input.status !== "paused" &&
    input.status !== "ready" &&
    input.status !== "assembling" &&
    input.totalChunks > 0 &&
    input.completedChunks >= input.totalChunks
  );
}

export function shouldEnsurePlaybackDemandCacheTask(input: {
  enableManualTrackCaching: boolean;
  playback: RoomSnapshot["room"]["playback"] | null | undefined;
  trackExists: boolean;
  peerId: string | null | undefined;
  activeSessionId: string | null | undefined;
  hasLocalFullTrack?: boolean;
  existingTask: Pick<ManualCacheTask, "mode" | "status"> | null | undefined;
}) {
  const playback = input.playback;
  if (
    !input.enableManualTrackCaching ||
    !playback?.currentTrackId ||
    !hasActivePlaybackIntent(playback) ||
    !input.trackExists
  ) {
    return false;
  }

  if (
    isCurrentPlaybackSourceDevice({
      playback,
      peerId: input.peerId,
      activeSessionId: input.activeSessionId
    }) &&
    input.hasLocalFullTrack !== false
  ) {
    return false;
  }

  if (!input.existingTask) {
    return true;
  }

  if (input.existingTask.mode === "manual") {
    if (input.existingTask.status === "ready") {
      return input.hasLocalFullTrack === false;
    }

    return (
      input.existingTask.status === "idle" ||
      input.existingTask.status === "failed" ||
      input.existingTask.status === "failed-integrity"
    );
  }

  if (input.existingTask.status === "ready") {
    return input.hasLocalFullTrack === false;
  }

  return (
    input.existingTask.status === "idle" ||
    input.existingTask.status === "failed" ||
    input.existingTask.status === "failed-integrity"
  );
}

export function resolveManualCachePlanTaskUpdate(input: {
  current: ManualCacheTask | null;
  plan: {
    localPieceIndexes: readonly number[];
    manifest: { totalChunks: number; pieceMimeType?: string | null } | null;
    manifestSource: string;
    blockedReason: string | null;
    integrityMode: ManualCacheTask["integrityMode"];
    providerPeerIds: readonly string[];
    connectedProviderPeerIds: readonly string[];
    selectedProviderPeerId: string | null;
    requestableChunks: readonly number[];
    pendingChunkCount: number;
  };
  track: { fileHash: string; mimeType?: string | null };
  knownChunkIndexes: Set<number>;
  isCurrentPlaybackDemand: boolean;
}) {
  if (!input.current && !input.isCurrentPlaybackDemand) {
    return {
      patch: null,
      shouldAssemble: false,
      assembleMimeType: null,
      assembleTotalChunks: 0
    };
  }
  if (input.current?.status === "paused" || input.current?.status === "ready") {
    return {
      patch: null,
      shouldAssemble: false,
      assembleMimeType: null,
      assembleTotalChunks: 0
    };
  }

  const progress = mergeManualCachePlanTaskProgress({
    current: input.current,
    planLocalPieceIndexes: [...input.plan.localPieceIndexes],
    inMemoryPieceIndexes: input.knownChunkIndexes,
    planTotalChunks: input.plan.manifest?.totalChunks ?? input.current?.totalChunks ?? 0,
    planBlockedReason: input.plan.blockedReason
  });
  const mimeType =
    input.plan.manifest?.pieceMimeType ?? input.current?.mimeType ?? input.track.mimeType ?? null;
  const shouldAssemble = shouldAssembleManualCachePlanProgress({
    status: progress.status,
    completedChunks: progress.completedChunks,
    totalChunks: progress.totalChunks
  });

  return {
    patch: {
      status: shouldAssemble ? "assembling" as const : progress.status,
      mode: input.current?.mode ?? resolveAutomaticPlaybackCacheTaskMode(),
      fileHash: input.track.fileHash,
      completedChunks: progress.completedChunks,
      totalChunks: progress.totalChunks,
      mimeType,
      manifestSource: input.plan.manifestSource === "none" ? null : input.plan.manifestSource,
      blockedReason: progress.blockedReason,
      integrityMode: input.plan.integrityMode,
      providerPeerIds: [...input.plan.providerPeerIds],
      connectedProviderPeerIds: [...input.plan.connectedProviderPeerIds],
      selectedProviderPeerId: input.plan.selectedProviderPeerId,
      requestableChunkCount: input.plan.requestableChunks.length,
      pendingChunkCount: input.plan.pendingChunkCount,
      lastRequestedChunks: [...input.plan.requestableChunks],
      lastPieceReceivedAt: progress.lastPieceReceivedAt,
      lastError: progress.lastError
    },
    shouldAssemble,
    assembleMimeType: mimeType,
    assembleTotalChunks: progress.totalChunks
  };
}
