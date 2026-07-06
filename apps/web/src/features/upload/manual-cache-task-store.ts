import type { ManualCacheTaskRecord } from "@/lib/indexeddb";

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

export type ManualCacheTaskPatch =
  | Partial<ManualCacheTask>
  | ((current: ManualCacheTask | null) => Partial<ManualCacheTask> | null);

export type ManualCacheTaskUpsertRecord = Omit<
  ManualCacheTaskRecord,
  "taskKey" | "updatedAt"
> & {
  taskKey?: string;
  updatedAt?: string;
};

type ManualCacheTaskStateSetter = (
  updater: (current: Record<string, ManualCacheTask>) => Record<string, ManualCacheTask>
) => void;

type TrackIdRuntimeStore = {
  delete: (trackId: string) => boolean;
};

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

export function resolveManualCacheTaskStateUpdate(input: {
  currentTasks: Record<string, ManualCacheTask>;
  trackId: string;
  roomTracks: Array<{ id: string; fileHash: string; mimeType?: string | null }> | null | undefined;
  patch: ManualCacheTaskPatch;
  updatedAt: string;
}) {
  const existing = input.currentTasks[input.trackId] ?? null;
  const track = input.roomTracks?.find((entry) => entry.id === input.trackId) ?? null;
  const nextTask = buildNextManualCacheTask({
    trackId: input.trackId,
    existing,
    track,
    patch: input.patch,
    updatedAt: input.updatedAt
  });
  if (!nextTask) {
    return {
      nextTasks: input.currentTasks,
      nextTask: null
    };
  }

  return {
    nextTasks: {
      ...input.currentTasks,
      [input.trackId]: nextTask
    },
    nextTask
  };
}

export function applyManualCacheTaskUpdate(input: {
  trackId: string;
  patch: ManualCacheTaskPatch;
  roomId: string | null | undefined;
  roomTracks: Array<{ id: string; fileHash: string; mimeType?: string | null }> | null | undefined;
  updatedAt: string;
  setManualCacheTasks: ManualCacheTaskStateSetter;
  upsertManualCacheTask: (record: ManualCacheTaskUpsertRecord) => void | Promise<void>;
}) {
  input.setManualCacheTasks((current) => {
    const result = resolveManualCacheTaskStateUpdate({
      currentTasks: current,
      trackId: input.trackId,
      roomTracks: input.roomTracks,
      patch: input.patch,
      updatedAt: input.updatedAt
    });
    if (!result.nextTask) {
      return current;
    }
    if (input.roomId && result.nextTask.fileHash) {
      void input.upsertManualCacheTask(
        buildManualCacheTaskRecord({
          roomId: input.roomId,
          task: result.nextTask
        })
      );
    }

    return result.nextTasks;
  });
}

export function applyManualCacheTaskDrop(input: {
  trackId: string;
  roomId: string | null | undefined;
  chunkIndexesByTrack: TrackIdRuntimeStore;
  assemblingTrackIdsByTrack: TrackIdRuntimeStore;
  setManualCacheTasks: ManualCacheTaskStateSetter;
  deleteManualCacheTask: (roomId: string, trackId: string) => void | Promise<void>;
}) {
  input.chunkIndexesByTrack.delete(input.trackId);
  input.assemblingTrackIdsByTrack.delete(input.trackId);
  if (input.roomId) {
    void input.deleteManualCacheTask(input.roomId, input.trackId);
  }
  input.setManualCacheTasks((current) => {
    if (!(input.trackId in current)) {
      return current;
    }

    const next = { ...current };
    delete next[input.trackId];
    return next;
  });
}

export function applyManualCacheDownloadStartResult(input: {
  trackId: string;
  result: {
    shouldClearChunkIndexes: boolean;
    chunkIndexes: Set<number> | null;
    taskPatch: Partial<ManualCacheTask> | null;
    statusMessage: string | null;
    assembleRequest: { trackId: string; mimeType: string | null; totalChunks: number } | null;
  };
  chunkIndexesByTrack: Map<string, Set<number>>;
  updateManualCacheTask: (trackId: string, patch: Partial<ManualCacheTask>) => void;
  setStatusMessage: (message: string) => void;
  assembleManualCacheTrack: (
    trackId: string,
    mimeType: string | null,
    totalChunks: number
  ) => void;
}) {
  if (input.result.shouldClearChunkIndexes) {
    input.chunkIndexesByTrack.delete(input.trackId);
  }
  if (input.result.chunkIndexes) {
    input.chunkIndexesByTrack.set(input.trackId, input.result.chunkIndexes);
  }
  if (input.result.taskPatch) {
    input.updateManualCacheTask(input.trackId, input.result.taskPatch);
  }
  if (input.result.statusMessage) {
    input.setStatusMessage(input.result.statusMessage);
  }
  if (input.result.assembleRequest) {
    input.assembleManualCacheTrack(
      input.result.assembleRequest.trackId,
      input.result.assembleRequest.mimeType,
      input.result.assembleRequest.totalChunks
    );
  }
}

export function applyManualCacheProgressResult<TAvailability>(input: {
  trackId: string;
  result: {
    accepted?: boolean;
    nextChunkIndexes: Set<number>;
    availability?: TAvailability | null;
    taskPatch: Partial<ManualCacheTask> | null;
    assembleRequest: { trackId: string; mimeType: string | null; totalChunks: number } | null;
  };
  chunkIndexesByTrack: Map<string, Set<number>>;
  publishAvailability: (availability: TAvailability) => void;
  updateManualCacheTask: (trackId: string, patch: Partial<ManualCacheTask>) => void;
  assembleManualCacheTrack: (
    trackId: string,
    mimeType: string | null,
    totalChunks: number
  ) => void;
}) {
  if (input.result.accepted === false) {
    return false;
  }

  input.chunkIndexesByTrack.set(input.trackId, input.result.nextChunkIndexes);

  if (input.result.availability) {
    input.publishAvailability(input.result.availability);
  }

  if (input.result.taskPatch) {
    input.updateManualCacheTask(input.trackId, input.result.taskPatch);
  }

  if (input.result.assembleRequest) {
    input.assembleManualCacheTrack(
      input.result.assembleRequest.trackId,
      input.result.assembleRequest.mimeType,
      input.result.assembleRequest.totalChunks
    );
  }

  return true;
}

export function buildManualCacheTaskRecord(input: {
  roomId: string;
  task: ManualCacheTask;
}) {
  return {
    roomId: input.roomId,
    trackId: input.task.trackId,
    fileHash: input.task.fileHash,
    status: input.task.status,
    mode: input.task.mode,
    errorMessage: input.task.errorMessage,
    completedChunks: input.task.completedChunks,
    totalChunks: input.task.totalChunks,
    mimeType: input.task.mimeType,
    manifestSource: input.task.manifestSource,
    blockedReason: input.task.blockedReason,
    integrityMode: input.task.integrityMode,
    providerPeerIds: input.task.providerPeerIds,
    connectedProviderPeerIds: input.task.connectedProviderPeerIds,
    selectedProviderPeerId: input.task.selectedProviderPeerId,
    requestableChunkCount: input.task.requestableChunkCount,
    pendingChunkCount: input.task.pendingChunkCount,
    lastRequestedChunks: input.task.lastRequestedChunks,
    lastPieceReceivedAt: input.task.lastPieceReceivedAt,
    lastError: input.task.lastError,
    updatedAt: input.task.updatedAt
  };
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

export async function hydrateManualCacheTasksForRoom(input: {
  roomId: string;
  peerId: string;
  currentPlaybackTrackId: string | null;
  roomTracks: Array<{
    id: string;
    relayManifest?: { chunkSize: number; totalChunks?: number; pieceMimeType?: string | null } | null;
    pieceManifest?: { chunkSize: number; totalChunks?: number; pieceMimeType?: string | null } | null;
  }>;
  listManualCacheTasksForRoom: (roomId: string) => Promise<ManualCacheTaskRecord[]>;
  getCachedPieceIndexes: (
    trackId: string,
    peerId: string,
    options?: { fileHash?: string; ownerKey?: string; chunkSize?: number }
  ) => Promise<number[]>;
  localCacheOwnerKey: string;
}) {
  const tasks = await input.listManualCacheTasksForRoom(input.roomId);
  const staleTasks = tasks
    .filter(
      (task) =>
        (task.mode !== "manual" && task.mode !== "playback-demand") ||
        (task.mode === "playback-demand" && task.trackId !== input.currentPlaybackTrackId)
    )
    .map((task) => ({
      roomId: task.roomId,
      trackId: task.trackId
    }));
  const chunkIndexesByTrack = new Map<string, Set<number>>();

  for (const task of tasks) {
    if (!shouldHydrateCacheTaskPieceIndexes(task)) {
      continue;
    }

    const track = input.roomTracks.find((entry) => entry.id === task.trackId) ?? null;
    const expectedManifest = track?.relayManifest ?? track?.pieceManifest ?? null;
    const indexes = await input.getCachedPieceIndexes(task.trackId, input.peerId, {
      fileHash: task.fileHash,
      ownerKey: input.localCacheOwnerKey,
      chunkSize: expectedManifest?.chunkSize
    });
    chunkIndexesByTrack.set(task.trackId, new Set(indexes));
  }

  return {
    tasks,
    staleTasks,
    chunkIndexesByTrack
  };
}

export function resolveAutomaticPlaybackCacheTaskMode(): ManualCacheTask["mode"] {
  return "playback-demand";
}

function isManualCacheTaskRecord(
  task: ManualCacheTaskRecord
): task is ManualCacheTaskRecord & { mode: "manual" | "playback-demand" } {
  return task.mode === "manual" || task.mode === "playback-demand";
}
