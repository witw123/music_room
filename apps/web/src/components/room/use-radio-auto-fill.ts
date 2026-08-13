"use client";

import { useEffect, useRef, useState } from "react";
import type { NeteaseTrackCandidate, QqMusicTrackCandidate, RoomSnapshot } from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";

type Props = {
  roomSnapshot: RoomSnapshot;
  enabled: boolean;
  isHost: boolean;
  onImportNeteaseTrack: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportQqMusicTrack: (track: QqMusicTrackCandidate) => Promise<void>;
  onAddToQueue: (trackId: string) => Promise<unknown>;
};

export function useRadioAutoFill({
  roomSnapshot,
  enabled,
  isHost,
  onImportNeteaseTrack,
  onImportQqMusicTrack,
  onAddToQueue
}: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const runningRef = useRef(false);
  const attemptedSeedRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      !enabled ||
      !isHost ||
      roomSnapshot.room.roomType !== "radio" ||
      roomSnapshot.room.radioAutoFill === false ||
      roomSnapshot.queue.length >= 3 ||
      runningRef.current
    ) {
      return;
    }

    const source = roomSnapshot.tracks.find((track) => track.id === roomSnapshot.room.playback.currentTrackId)
      ?? roomSnapshot.tracks[0];
    const provider = source?.sourceRef?.provider;
    const sourceTrackId = source?.sourceRef?.trackId;
    if ((provider !== "netease" && provider !== "qqmusic") || !sourceTrackId) {
      return;
    }

    const seedKey = `${provider}:${sourceTrackId}:${roomSnapshot.room.roomRevision ?? 0}`;
    if (attemptedSeedRef.current === seedKey) return;
    attemptedSeedRef.current = seedKey;
    runningRef.current = true;
    let cancelled = false;
    setStatus("正在补充推荐歌曲…");

    const fillQueue = async () => {
      const related = provider === "netease"
        ? await musicRoomApi.listNeteaseRelatedPlaylists(sourceTrackId)
        : await musicRoomApi.listQqMusicRelatedPlaylists(sourceTrackId);
      const playlist = related.items[0];
      if (!playlist) throw new Error("No related playlist available.");
      const detail = provider === "netease"
        ? await musicRoomApi.getNeteasePlaylist(playlist.providerPlaylistId)
        : await musicRoomApi.getQqMusicPlaylist(playlist.providerPlaylistId);
      const known = new Set(roomSnapshot.tracks.map((track) => `${track.sourceRef?.provider}:${track.sourceRef?.trackId}`));
      const candidates = detail.tracks
        .filter((track) => !known.has(`${track.provider}:${track.providerTrackId}`))
        .slice(0, Math.max(0, 3 - roomSnapshot.queue.length));

      for (const candidate of candidates) {
        if (candidate.provider === "netease") await onImportNeteaseTrack(candidate);
        else await onImportQqMusicTrack(candidate);
        const refreshed = await musicRoomApi.getRoom(roomSnapshot.room.id);
        const importedTrack = refreshed.tracks.find((track) =>
          track.sourceRef?.provider === candidate.provider &&
          track.sourceRef.trackId === candidate.providerTrackId
        );
        if (importedTrack && !refreshed.queue.some((item) => item.trackId === importedTrack.id)) {
          await onAddToQueue(importedTrack.id);
        }
      }
    };

    void fillQueue()
      .then(() => { if (!cancelled) setStatus("已补充推荐歌曲"); })
      .catch(() => {
        attemptedSeedRef.current = null;
        if (!cancelled) setStatus("暂时无法补充推荐歌曲");
      })
      .finally(() => { runningRef.current = false; });

    return () => { cancelled = true; };
  }, [enabled, isHost, onAddToQueue, onImportNeteaseTrack, onImportQqMusicTrack, roomSnapshot]);

  return status;
}
