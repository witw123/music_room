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

const targetPendingQueueDepth = 3;
const refillIntervalMs = 15_000;

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
  const currentSourceKey = getCurrentProviderSource(roomSnapshot)?.key ?? null;

  useEffect(() => {
    roomSnapshotRef.current = roomSnapshot;
  }, [roomSnapshot]);

  const refill = useCallback(async (force = false) => {
    const snapshot = roomSnapshotRef.current;
    const autopilot = snapshot.room.radioAutopilot;
    const source = getCurrentProviderSource(snapshot);
    if (
      !isHost ||
      autopilot?.enabled !== true ||
      !source ||
      snapshot.room.playback.status !== "playing" ||
      !snapshot.room.playback.currentTrackId ||
      runningRef.current ||
      (pausedRef.current && !force) ||
      getPendingQueueDepth(snapshot) >= targetPendingQueueDepth
    ) {
      return;
    }

    runningRef.current = true;
    setState({ kind: "refilling", message: "正在补充节目单…" });
    try {
      const candidates = await loadRelatedCandidates(source.provider, source.providerTrackId);
      const selected = selectCandidates(snapshot, candidates, targetPendingQueueDepth - getPendingQueueDepth(snapshot));
      if (selected.length === 0) {
        pausedRef.current = true;
        setPreloadingCandidate(null);
        setState({ kind: "paused", message: "没有可加入的关联歌曲。" });
        return;
      }

      setPreloadingCandidate(selected[0] ?? null);
      setState({ kind: "refilling", message: `正在预加载《${selected[0]?.title ?? "下一首"}》…` });
      const importedTrackIds: string[] = [];
      for (const candidate of selected) {
        if (candidate.provider === "netease") {
          await onImportNeteaseTrack(candidate);
        } else {
          await onImportQqMusicTrack(candidate);
        }

        const freshSnapshot = await musicRoomApi.getRoom(snapshot.room.id);
        const imported = freshSnapshot.tracks.find(
          (track) =>
            track.sourceRef?.provider === candidate.provider &&
            track.sourceRef.trackId === candidate.providerTrackId
        );
        if (!imported) {
          throw new Error(`《${candidate.title}》导入后未同步到曲库。`);
        }
        importedTrackIds.push(imported.id);
      }

      if (getCurrentProviderSource(roomSnapshotRef.current)?.key !== source.key) {
        setPreloadingCandidate(null);
        setState({ kind: "idle", message: "当前播放歌曲已切换，已取消上一首歌曲的补歌任务。" });
        return;
      }

      const queued = await musicRoomApi.appendRadioAutopilotQueueItems(snapshot.room.id, {
        trackIds: importedTrackIds
      });
      if (queued.appendedQueueItemIds.length === 0) {
        pausedRef.current = true;
        setState({ kind: "paused", message: "候选歌曲未通过节目单去重。" });
        return;
      }

      pausedRef.current = false;
      const refreshedSnapshot = await onRefreshRoom();
      if (refreshedSnapshot) roomSnapshotRef.current = refreshedSnapshot;
      setState({ kind: "idle", message: `已根据《${source.track.title}》补充 ${queued.appendedQueueItemIds.length} 首歌曲。` });
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
  }, [currentSourceKey]);

  useEffect(() => {
    if (!isHost || !isAutopilotEnabled) {
      pausedRef.current = false;
      setPreloadingCandidate(null);
      setState({ kind: "idle", message: null });
      return;
    }

    if (!currentSourceKey) {
      pausedRef.current = true;
      setState({ kind: "paused", message: "请先播放一首网易云音乐或 QQ 音乐歌曲，再开启自动续播。" });
      return;
    }

    void refill();
    const intervalId = window.setInterval(() => void refill(), refillIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [currentSourceKey, isAutopilotEnabled, isHost, refill]);

  const retry = useCallback(async () => {
    pausedRef.current = false;
    await refill(true);
  }, [refill]);

  const queuedNextTrack = isAutopilotEnabled ? getNextAutopilotTrack(roomSnapshot) : null;
  const queuedNextTrackKey = queuedNextTrack?.key ?? null;
  const nextTrack = queuedNextTrack ?? (preloadingCandidate
    ? toNextTrack(preloadingCandidate, "preloading")
    : null);

  useEffect(() => {
    if (queuedNextTrackKey) setPreloadingCandidate(null);
  }, [queuedNextTrackKey]);

  return { state, retry, nextTrack };
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
  const related = provider === "netease"
    ? await musicRoomApi.listNeteaseRelatedPlaylists(providerTrackId)
    : await musicRoomApi.listQqMusicRelatedPlaylists(providerTrackId);
  const playlists = related.items.slice(0, 3);
  const details = await Promise.all(
    playlists.map((playlist) => provider === "netease"
      ? musicRoomApi.getNeteasePlaylist(playlist.providerPlaylistId)
      : musicRoomApi.getQqMusicPlaylist(playlist.providerPlaylistId))
  );
  return details.flatMap((playlist) => playlist.tracks);
}

function selectCandidates(
  snapshot: RoomSnapshot,
  candidates: ProviderTrackCandidate[],
  limit: number
) {
  const knownProviderTrackIds = new Set(
    snapshot.tracks.flatMap((track) => track.sourceRef
      ? [`${track.sourceRef.provider}:${track.sourceRef.trackId}`]
      : [])
  );
  const currentQueueIndex = snapshot.room.playback.currentQueueItemId
    ? snapshot.queue.findIndex((item) => item.id === snapshot.room.playback.currentQueueItemId)
    : -1;
  const recentTracks = currentQueueIndex < 0
    ? []
    : snapshot.queue
      .slice(Math.max(0, currentQueueIndex - 49), currentQueueIndex + 1)
      .map((item) => snapshot.tracks.find((track) => track.id === item.trackId))
      .filter((track): track is TrackMeta => !!track);
  const recentArtists = new Set(
    recentTracks.slice(-3).map((track) => normalizeArtist(track.artist))
  );
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    const key = `${candidate.provider}:${candidate.providerTrackId}`;
    if (knownProviderTrackIds.has(key) || seen.has(key) || recentArtists.has(normalizeArtist(candidate.artist))) {
      return false;
    }
    seen.add(key);
    return true;
  }).slice(0, Math.max(0, limit));
}

function getPendingQueueDepth(snapshot: RoomSnapshot) {
  const currentQueueItemId = snapshot.room.playback.currentQueueItemId;
  if (!currentQueueItemId) return snapshot.queue.length;
  const currentIndex = snapshot.queue.findIndex((item) => item.id === currentQueueItemId);
  return currentIndex < 0 ? snapshot.queue.length : snapshot.queue.length - currentIndex - 1;
}

function getNextAutopilotTrack(snapshot: RoomSnapshot): RadioAutopilotNextTrack | null {
  const currentQueueItemId = snapshot.room.playback.currentQueueItemId;
  const currentIndex = currentQueueItemId
    ? snapshot.queue.findIndex((item) => item.id === currentQueueItemId)
    : -1;
  const upcomingItems = snapshot.queue.slice(currentIndex < 0 ? 0 : currentIndex + 1);
  const nextItem = upcomingItems.find((item) => item.source === "autopilot");
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

function normalizeArtist(value: string) {
  return value.trim().toLocaleLowerCase();
}

function toAutopilotErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return `自动推荐已暂停：${error.message}`;
  }
  return "自动推荐已暂停，可重试。";
}
