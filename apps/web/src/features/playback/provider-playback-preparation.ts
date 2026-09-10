import {
  getLocalAudioFileRecord,
  listLocalPlaylistTracks,
  type LocalPlaylistTrackRecord
} from "@/features/library/indexeddb";
import {
  toCachedProviderTrack,
  type ProviderTrack
} from "@/features/playlist/local-playlist";
import {
  cacheProviderTrackForPlayback,
  findCachedProviderPlaybackRecord,
  hasProviderTrackPlaybackCache
} from "./provider-track-cache";

/**
 * Where the audio for a prepared track came from:
 * - `saved-library`: explicitly downloaded into the user's local audio directory.
 * - `playback-cache`: reusable entry of the disposable playback cache.
 * - `playback-download`: freshly downloaded into the disposable playback cache.
 */
export type PreparedPlaybackSource = "saved-library" | "playback-cache" | "playback-download";

export type PreparedPlaybackTrack = {
  record: LocalPlaylistTrackRecord;
  source: PreparedPlaybackSource;
};

export type PlaybackPreparationErrorCode =
  | "missing-audio-source"
  | "preparation-failed";

export class PlaybackPreparationError extends Error {
  readonly code: PlaybackPreparationErrorCode;

  constructor(code: PlaybackPreparationErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PlaybackPreparationError";
    this.code = code;
  }
}

export function isProviderTrackInput(
  input: ProviderTrack | LocalPlaylistTrackRecord
): input is ProviderTrack {
  return "access" in input;
}

function isProviderBackedRecord(
  record: LocalPlaylistTrackRecord
): record is LocalPlaylistTrackRecord & {
  provider: "netease" | "qqmusic";
  providerTrackId: string;
} {
  return (
    (record.provider === "netease" || record.provider === "qqmusic") &&
    !!record.providerTrackId
  );
}

function toProviderTrackView(
  input: ProviderTrack | LocalPlaylistTrackRecord
): ProviderTrack | null {
  if (isProviderTrackInput(input)) return input;
  return toCachedProviderTrack(input);
}

function preparationKeyFor(input: ProviderTrack | LocalPlaylistTrackRecord): string {
  if (isProviderTrackInput(input) || isProviderBackedRecord(input)) {
    return `provider:${input.provider}:${input.providerTrackId}`;
  }
  return input.fileHash ? `local:${input.fileHash}` : `record:${input.id}`;
}

// Concurrent clicks on the same track (row + "play all", double click, ...) must
// share one download instead of racing each other.
const inflightPreparations = new Map<string, Promise<PreparedPlaybackTrack>>();

/**
 * Unified entry point used by every "click to play" path (discover page,
 * network playlists, favorites, search results). Resolution order:
 *
 * 1. explicitly saved local file (user's local audio directory);
 * 2. persistent playback cache (disposable, may be cleaned up automatically);
 * 3. provider download into the playback cache - never into the saved library.
 *
 * The returned record always carries a `fileHash`, so `LocalPlayerProvider`
 * can resolve the audio blob and start playback immediately.
 */
export async function prepareTrackForImmediatePlayback(
  input: ProviderTrack | LocalPlaylistTrackRecord
): Promise<PreparedPlaybackTrack> {
  const key = preparationKeyFor(input);
  const inflight = inflightPreparations.get(key);
  if (inflight) return inflight;

  const promise = runPreparation(input).finally(() => {
    inflightPreparations.delete(key);
  });
  inflightPreparations.set(key, promise);
  return promise;
}

async function runPreparation(
  input: ProviderTrack | LocalPlaylistTrackRecord
): Promise<PreparedPlaybackTrack> {
  // 1) The record itself is an explicitly saved local file.
  if (!isProviderTrackInput(input) && input.availableOffline && input.fileHash) {
    return { record: input, source: "saved-library" };
  }

  // 2) The record already points at a living playback-cache entry.
  if (
    !isProviderTrackInput(input) &&
    input.fileHash &&
    (await hasProviderTrackPlaybackCache(input.fileHash).catch(() => false))
  ) {
    return { record: input, source: "playback-cache" };
  }

  // 3) A saved copy exists in the local audio directory (resolves bare
  //    provider candidates against the library, and repairs stale
  //    availability flags on persisted rows).
  const savedRecord = await findSavedLibraryRecord(input);
  if (savedRecord) return { record: savedRecord, source: "saved-library" };

  // 4) Reusable playback-cache entry.
  const providerTrack = toProviderTrackView(input);
  if (providerTrack) {
    const cachedRecord = await findCachedProviderPlaybackRecord(providerTrack).catch(() => null);
    if (cachedRecord) return { record: cachedRecord, source: "playback-cache" };
  }

  // 5) Download into the playback cache.
  if (!providerTrack) {
    throw new PlaybackPreparationError(
      "missing-audio-source",
      `《${input.title}》没有可用的播放音频，请先下载到本地后播放。`
    );
  }
  try {
    const record = await cacheProviderTrackForPlayback(providerTrack);
    return { record, source: "playback-download" };
  } catch (error) {
    if (error instanceof PlaybackPreparationError) throw error;
    throw new PlaybackPreparationError("preparation-failed", toPreparationFailureMessage(error), {
      cause: error
    });
  }
}

async function findSavedLibraryRecord(
  input: ProviderTrack | LocalPlaylistTrackRecord
): Promise<LocalPlaylistTrackRecord | null> {
  const explicitTracks = await listLocalPlaylistTracks().catch(() => []);
  const matched = explicitTracks.find((candidate) => {
    if (isProviderTrackInput(input)) {
      return candidate.provider === input.provider &&
        candidate.providerTrackId === input.providerTrackId;
    }
    if (isProviderBackedRecord(input)) {
      return candidate.provider === input.provider &&
        candidate.providerTrackId === input.providerTrackId;
    }
    return candidate.id === input.id ||
      (!!input.fileHash && candidate.fileHash === input.fileHash);
  });
  if (!matched?.fileHash) return null;
  if (matched.availableOffline) return matched;

  // Persisted rows can carry stale availability flags; only treat the track
  // as saved when the managed library really holds the file.
  const savedFile = await getLocalAudioFileRecord(matched.fileHash, "saved").catch(() => null);
  return savedFile ? { ...matched, availableOffline: true } : null;
}

/** User-facing message describing what "play" did with the audio. */
export function buildPlaybackStatusMessage(title: string, source: PreparedPlaybackSource): string {
  switch (source) {
    case "saved-library":
      return `正在播放《${title}》`;
    case "playback-cache":
      return `正在播放《${title}》，已使用播放缓存（播放缓存可能会被自动清理）。`;
    case "playback-download":
      return `正在播放《${title}》，音频已写入播放缓存（播放缓存可能会被自动清理）。`;
  }
}

export function toPlaybackPreparationErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof PlaybackPreparationError) return error.message;
  return error instanceof Error && error.message ? error.message : fallback;
}

function toPreparationFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "音频准备失败，请稍后重试。";
}

export type BackgroundPreloadHandle = {
  cancel: () => void;
};

/**
 * Prepare a list of upcoming queue tracks in the background (default two at a
 * time) without blocking whatever is currently playing. Prepared records are
 * handed to `onPrepared` so callers can swap them into the player queue;
 * failures never abort the rest of the preload and are reported via
 * `onFailed` / the final `onSettled` summary.
 */
export function preloadProviderTracksInBackground(
  tracks: ReadonlyArray<ProviderTrack | LocalPlaylistTrackRecord>,
  options: {
    concurrency?: number;
    onPrepared?: (
      prepared: PreparedPlaybackTrack,
      track: ProviderTrack | LocalPlaylistTrackRecord
    ) => void;
    onFailed?: (track: ProviderTrack | LocalPlaylistTrackRecord, error: unknown) => void;
    onSettled?: (summary: { prepared: number; failed: number; cancelled: boolean }) => void;
  } = {}
): BackgroundPreloadHandle {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, 4));
  const queue = [...tracks];
  let cursor = 0;
  let preparedCount = 0;
  let failedCount = 0;
  let cancelled = false;
  let settled = false;
  let activeWorkers = 0;

  const settle = () => {
    if (settled) return;
    settled = true;
    options.onSettled?.({ prepared: preparedCount, failed: failedCount, cancelled });
  };

  const runWorker = async () => {
    activeWorkers += 1;
    try {
      while (!cancelled) {
        const index = cursor;
        if (index >= queue.length) return;
        cursor += 1;
        const track = queue[index]!;
        try {
          const prepared = await prepareTrackForImmediatePlayback(track);
          if (cancelled) return;
          preparedCount += 1;
          options.onPrepared?.(prepared, track);
        } catch (error) {
          if (cancelled) return;
          failedCount += 1;
          options.onFailed?.(track, error);
        }
      }
    } finally {
      activeWorkers -= 1;
      if (activeWorkers === 0) settle();
    }
  };

  for (let index = 0; index < Math.min(concurrency, queue.length); index += 1) {
    void runWorker();
  }
  if (queue.length === 0) settle();

  return {
    cancel: () => {
      cancelled = true;
      settle();
    }
  };
}
