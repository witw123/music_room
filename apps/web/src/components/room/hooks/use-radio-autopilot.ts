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
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const roomSnapshotRef = useRef(roomSnapshot);
  const isAutopilotEnabled = roomSnapshot.room.radioAutopilot.enabled;

  useEffect(() => {
    roomSnapshotRef.current = roomSnapshot;
  }, [roomSnapshot]);

  const refill = useCallback(async (force = false) => {
    const snapshot = roomSnapshotRef.current;
    const autopilot = snapshot.room.radioAutopilot;
    if (
      !isHost ||
      !autopilot.enabled ||
      !autopilot.seedProvider ||
      !autopilot.seedProviderTrackId ||
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
      const candidates = await loadRelatedCandidates(autopilot.seedProvider, autopilot.seedProviderTrackId);
      const selected = selectCandidates(snapshot, candidates, targetPendingQueueDepth - getPendingQueueDepth(snapshot));
      if (selected.length === 0) {
        pausedRef.current = true;
        setState({ kind: "paused", message: "没有可加入的关联歌曲。" });
        return;
      }

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

      const queued = await musicRoomApi.appendRadioAutopilotQueueItems(snapshot.room.id, {
        trackIds: importedTrackIds
      });
      if (queued.appendedQueueItemIds.length === 0) {
        pausedRef.current = true;
        setState({ kind: "paused", message: "候选歌曲未通过节目单去重。" });
        return;
      }

      pausedRef.current = false;
      await onRefreshRoom();
      setState({ kind: "idle", message: `已补充 ${queued.appendedQueueItemIds.length} 首自动推荐。` });
    } catch (error) {
      pausedRef.current = true;
      setState({ kind: "paused", message: toAutopilotErrorMessage(error) });
    } finally {
      runningRef.current = false;
    }
  }, [isHost, onImportNeteaseTrack, onImportQqMusicTrack, onRefreshRoom]);

  useEffect(() => {
    if (!isHost || !isAutopilotEnabled) {
      pausedRef.current = false;
      setState({ kind: "idle", message: null });
      return;
    }

    void refill();
    const intervalId = window.setInterval(() => void refill(), refillIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [isAutopilotEnabled, isHost, refill]);

  const retry = useCallback(async () => {
    pausedRef.current = false;
    await refill(true);
  }, [refill]);

  return { state, retry };
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

function normalizeArtist(value: string) {
  return value.trim().toLocaleLowerCase();
}

function toAutopilotErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return `自动推荐已暂停：${error.message}`;
  }
  return "自动推荐已暂停，可重试。";
}
