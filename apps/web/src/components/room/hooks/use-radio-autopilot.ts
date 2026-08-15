"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  NeteaseTrackCandidate,
  ProviderTrackCandidate,
  QqMusicTrackCandidate,
  RoomSnapshot,
  TrackMeta
} from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";

type UseRadioAutopilotOptions = {
  roomSnapshot: RoomSnapshot;
  isHost: boolean;
  onImportNeteaseTrack: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportQqMusicTrack: (track: QqMusicTrackCandidate) => Promise<void>;
  onRefreshRoom: () => Promise<RoomSnapshot | null>;
};

type RadioAutopilotState = {
  kind: "idle" | "refilling" | "paused";
  message: string | null;
};

export type RadioAutopilotNextTrack = {
  key: string;
  title: string;
  artist: string;
  album: string | null;
  artworkUrl: string | null;
  durationMs: number;
  provider: "netease" | "qqmusic";
  preloadStatus: "preloading" | "ready";
};

export function useRadioAutopilot({
  roomSnapshot,
  isHost,
  onImportNeteaseTrack,
  onImportQqMusicTrack,
  onRefreshRoom
}: UseRadioAutopilotOptions) {
  const [state, setState] = useState<RadioAutopilotState>({ kind: "idle", message: null });
  const [preloadingCandidate, setPreloadingCandidate] = useState<ProviderTrackCandidate | null>(null);
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const roomSnapshotRef = useRef(roomSnapshot);
  const isAutopilotEnabled = roomSnapshot.room.radioAutopilot?.enabled === true;
  const currentSeedKey = getCurrentAutopilotSeed(roomSnapshot)?.key ?? null;
  const isPlayingLastQueueItem = isRadioPlaybackAtQueueEnd(roomSnapshot);

  useEffect(() => {
    roomSnapshotRef.current = roomSnapshot;
  }, [roomSnapshot]);

  const refill = useCallback(async (mode: "automatic" | "manual") => {
    const snapshot = roomSnapshotRef.current;
    const autopilot = snapshot.room.radioAutopilot;
    const seed = getCurrentAutopilotSeed(snapshot);
    const isAutomatic = mode === "automatic";
    if (
      !isHost ||
      !seed ||
      snapshot.room.playback.status !== "playing" ||
      !snapshot.room.playback.currentTrackId ||
      runningRef.current ||
      (isAutomatic && (
        autopilot?.enabled !== true ||
        pausedRef.current ||
        !isRadioPlaybackAtQueueEnd(snapshot)
      ))
    ) {
      return;
    }

    runningRef.current = true;
    setState({ kind: "refilling", message: "正在分析并准备下一首…" });
    try {
      const relatedCandidates = await loadRelatedCandidates(seed.provider, seed.providerTrackId).catch(() => []);
      let selected = selectRadioAutopilotCandidates(snapshot, relatedCandidates, 1)[0];
      if (!selected) {
        const searchedCandidates = await searchRecommendationCandidates(seed.provider, seed.track);
        selected = selectRadioAutopilotCandidates(snapshot, [...relatedCandidates, ...searchedCandidates], 1)[0];
      }
      if (!selected) {
        pausedRef.current = true;
        setPreloadingCandidate(null);
        setState({ kind: "paused", message: "关联歌单和搜索结果中都没有可用歌曲。" });
        return;
      }

      setPreloadingCandidate(selected);
      setState({ kind: "refilling", message: `正在预加载《${selected.title}》…` });
      if (selected.provider === "netease") {
        await onImportNeteaseTrack(selected);
      } else {
        await onImportQqMusicTrack(selected);
      }

      const freshSnapshot = await musicRoomApi.getRoom(snapshot.room.id);
      const imported = freshSnapshot.tracks.find(
        (track) =>
          track.sourceRef?.provider === selected.provider &&
          track.sourceRef.trackId === selected.providerTrackId
      );
      if (!imported) {
        throw new Error(`《${selected.title}》导入后未同步到曲库。`);
      }
      if (getCurrentAutopilotSeed(freshSnapshot)?.key !== seed.key) {
        setPreloadingCandidate(null);
        setState({ kind: "idle", message: "当前播放歌曲已切换，已取消上一首歌曲的补歌任务。" });
        return;
      }

      await musicRoomApi.insertRadioAutopilotNextTrack(snapshot.room.id, {
        trackId: imported.id
      });

      pausedRef.current = false;
      const refreshedSnapshot = await onRefreshRoom();
      if (refreshedSnapshot) roomSnapshotRef.current = refreshedSnapshot;
      setState({ kind: "idle", message: `已将《${selected.title}》设为下一首。` });
    } catch (error) {
      pausedRef.current = true;
      setPreloadingCandidate(null);
      setState({ kind: "paused", message: toAutopilotErrorMessage(error) });
    } finally {
      runningRef.current = false;
    }
  }, [isHost, onImportNeteaseTrack, onImportQqMusicTrack, onRefreshRoom]);

  useEffect(() => {
    pausedRef.current = false;
    setPreloadingCandidate(null);
  }, [currentSeedKey]);

  useEffect(() => {
    if (!isHost || !isAutopilotEnabled) {
      pausedRef.current = false;
      setPreloadingCandidate(null);
      setState({ kind: "idle", message: null });
      return;
    }

    if (!currentSeedKey) {
      pausedRef.current = true;
      setState({ kind: "paused", message: "请先从节目单播放一首网易云音乐或 QQ 音乐歌曲。" });
      return;
    }

    if (isPlayingLastQueueItem) void refill("automatic");
  }, [currentSeedKey, isAutopilotEnabled, isHost, isPlayingLastQueueItem, refill]);

  const refillNow = useCallback(async () => {
    pausedRef.current = false;
    await refill("manual");
  }, [refill]);

  const queuedNextTrack = getNextAutopilotTrack(roomSnapshot);
  const queuedNextTrackKey = queuedNextTrack?.key ?? null;
  const nextTrack = queuedNextTrack ?? (preloadingCandidate
    ? toNextTrack(preloadingCandidate, "preloading")
    : null);

  useEffect(() => {
    if (queuedNextTrackKey) setPreloadingCandidate(null);
  }, [queuedNextTrackKey]);

  return { state, refillNow, nextTrack };
}

export function isRadioPlaybackAtQueueEnd(snapshot: RoomSnapshot) {
  const currentQueueItemId = snapshot.room.playback.currentQueueItemId;
  if (!currentQueueItemId || snapshot.room.playback.status !== "playing") return false;
  return snapshot.queue.at(-1)?.id === currentQueueItemId;
}

function getCurrentAutopilotSeed(snapshot: RoomSnapshot) {
  const currentQueueItemId = snapshot.room.playback.currentQueueItemId;
  const source = getCurrentProviderSource(snapshot);
  if (!currentQueueItemId || !source) return null;
  return {
    ...source,
    key: `${currentQueueItemId}:${source.key}`
  };
}

function getCurrentProviderSource(snapshot: RoomSnapshot) {
  const trackId = snapshot.room.playback.currentTrackId;
  const track = trackId ? snapshot.tracks.find((item) => item.id === trackId) : null;
  if (
    !track?.sourceRef ||
    (track.sourceType !== "netease" && track.sourceType !== "qqmusic")
  ) {
    return null;
  }

  return {
    provider: track.sourceRef.provider,
    providerTrackId: track.sourceRef.trackId,
    track,
    key: `${track.sourceRef.provider}:${track.sourceRef.trackId}`
  };
}

async function loadRelatedCandidates(
  provider: "netease" | "qqmusic",
  providerTrackId: string
) {
  const relatedTrackId = provider === "qqmusic"
    ? (await musicRoomApi.getQqMusicTrack(providerTrackId)).relatedTrackId ?? providerTrackId
    : providerTrackId;
  const related = provider === "netease"
    ? await musicRoomApi.listNeteaseRelatedPlaylists(relatedTrackId)
    : await musicRoomApi.listQqMusicRelatedPlaylists(relatedTrackId);
  const playlists = related.items.slice(0, 3);
  const details = await Promise.all(
    playlists.map((playlist) => provider === "netease"
      ? musicRoomApi.getNeteasePlaylist(playlist.providerPlaylistId)
      : musicRoomApi.getQqMusicPlaylist(playlist.providerPlaylistId))
  );
  return details.flatMap((playlist) => playlist.tracks);
}

async function searchRecommendationCandidates(
  provider: "netease" | "qqmusic",
  track: TrackMeta
) {
  const queries = [...new Set(
    [track.artist, track.album ?? track.title]
      .map((value) => value.trim())
      .filter(Boolean)
  )];
  const candidates: ProviderTrackCandidate[] = [];
  let firstError: unknown = null;
  for (const keywords of queries) {
    try {
      const result = provider === "netease"
        ? await musicRoomApi.searchNeteaseTracks(keywords, { limit: 30 })
        : await musicRoomApi.searchQqMusicTracks(keywords, { limit: 30 });
      candidates.push(...result.items);
    } catch (error) {
      firstError ??= error;
    }
  }
  if (candidates.length === 0 && firstError) throw firstError;
  return candidates;
}

export function selectRadioAutopilotCandidates(
  snapshot: RoomSnapshot,
  candidates: ProviderTrackCandidate[],
  limit: number
) {
  const queuedProviderTrackIds = new Set(
    snapshot.queue.flatMap((queueItem) => {
      const track = snapshot.tracks.find((item) => item.id === queueItem.trackId);
      return track?.sourceRef
        ? [`${track.sourceRef.provider}:${track.sourceRef.trackId}`]
        : [];
    })
  );
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    const key = `${candidate.provider}:${candidate.providerTrackId}`;
    if (queuedProviderTrackIds.has(key) || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).slice(0, Math.max(0, limit));
}

function getNextAutopilotTrack(snapshot: RoomSnapshot): RadioAutopilotNextTrack | null {
  const currentQueueItemId = snapshot.room.playback.currentQueueItemId;
  const currentIndex = currentQueueItemId
    ? snapshot.queue.findIndex((item) => item.id === currentQueueItemId)
    : -1;
  const nextItem = currentIndex >= 0 ? snapshot.queue[currentIndex + 1] : null;
  if (nextItem?.source !== "autopilot") return null;
  const track = nextItem
    ? snapshot.tracks.find((item) => item.id === nextItem.trackId)
    : null;
  if (!track?.sourceRef) return null;

  return {
    key: nextItem?.id ?? track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    artworkUrl: track.artworkUrl,
    durationMs: track.durationMs,
    provider: track.sourceRef.provider,
    preloadStatus: track.playbackAsset ? "ready" : "preloading"
  };
}

function toNextTrack(
  candidate: ProviderTrackCandidate,
  preloadStatus: RadioAutopilotNextTrack["preloadStatus"]
): RadioAutopilotNextTrack {
  return {
    key: `${candidate.provider}:${candidate.providerTrackId}`,
    title: candidate.title,
    artist: candidate.artist,
    album: candidate.album,
    artworkUrl: candidate.artworkUrl,
    durationMs: candidate.durationMs,
    provider: candidate.provider,
    preloadStatus
  };
}

function toAutopilotErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return `自动推荐已暂停：${error.message}`;
  }
  return "自动推荐已暂停，可重试。";
}
