"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RoomSnapshot } from "@music-room/shared";
import { isCachedLibraryTrackUsableForRoomTrack } from "@/features/upload/cached-library-track-policy";
import type {
  CachedLibraryTrack,
  CachedLibraryTrackFile,
  UploadedTrack
} from "@/features/upload/audio-utils";
import type { FullLocalPlaybackTrack } from "@/features/playback/use-progressive-runtime";
import {
  getCachedFullLocalPlaybackLoadKey,
  getCachedFullLocalPlaybackLoadMissKey,
  hasPlayableFullLocalPlaybackTrack,
  resolveCachedFullLocalPlaybackLoadTarget,
  selectFullLocalPlaybackTracks,
  shouldNotifyCachedFullLocalPlaybackLoadMiss,
  shouldClearCachedFullLocalPlaybackTrack,
  type CachedFullLocalPlaybackLoadTarget,
  type CachedFullLocalPlaybackTrack
} from "@/components/room/hooks/use-room-page-derived";

type UseRoomCachedFullLocalPlaybackInput = {
  uploadedTracks: Record<string, UploadedTrack>;
  cacheLibraryTracks: CachedLibraryTrack[];
  loadCachedLibraryTrackFile: (fileHash: string) => Promise<CachedLibraryTrackFile | null>;
  roomSnapshot: RoomSnapshot | null;
  currentTrack: RoomSnapshot["tracks"][number] | null;
  currentPlaybackTrackId: string | null;
  onCachedFullLocalPlaybackLoadMiss?: (trackId: string) => void;
};

export function useRoomCachedFullLocalPlayback({
  uploadedTracks,
  cacheLibraryTracks,
  loadCachedLibraryTrackFile,
  roomSnapshot,
  currentTrack,
  currentPlaybackTrackId,
  onCachedFullLocalPlaybackLoadMiss
}: UseRoomCachedFullLocalPlaybackInput) {
  const [cachedFullLocalPlaybackTrack, setCachedFullLocalPlaybackTrack] =
    useState<CachedFullLocalPlaybackTrack | null>(null);
  const cachedFullLocalPlaybackTrackRef = useRef<CachedFullLocalPlaybackTrack | null>(null);
  const notifiedCachedFullLocalPlaybackLoadMissKeysRef = useRef<Set<string>>(new Set());
  const replaceLoadedTrack = useCallback((next: CachedFullLocalPlaybackTrack | null) => {
    const previous = cachedFullLocalPlaybackTrackRef.current;
    if (previous && previous.objectUrl !== next?.objectUrl) {
      URL.revokeObjectURL(previous.objectUrl);
    }
    cachedFullLocalPlaybackTrackRef.current = next;
    setCachedFullLocalPlaybackTrack(next);
  }, []);
  const notifyCachedFullLocalPlaybackLoadMiss = useCallback(
    (target: CachedFullLocalPlaybackLoadTarget, cachedTrackFileLoaded: boolean) => {
      if (
        !shouldNotifyCachedFullLocalPlaybackLoadMiss({
          target,
          cachedTrackFileLoaded,
          notifiedMissKeys: notifiedCachedFullLocalPlaybackLoadMissKeysRef.current
        })
      ) {
        return;
      }

      const missKey = getCachedFullLocalPlaybackLoadMissKey(target);
      if (missKey) {
        notifiedCachedFullLocalPlaybackLoadMissKeysRef.current.add(missKey);
      }
      onCachedFullLocalPlaybackLoadMiss?.(target.trackId);
    },
    [onCachedFullLocalPlaybackLoadMiss]
  );

  const fullLocalPlaybackTracks = useMemo(
    () =>
      selectFullLocalPlaybackTracks({
        uploadedTracks,
        cachedPlaybackTrack: cachedFullLocalPlaybackTrack
      }),
    [cachedFullLocalPlaybackTrack, uploadedTracks]
  );
  const hasPlayableFullLocalTrack = useMemo(
    () =>
      hasPlayableFullLocalPlaybackTrack({
        currentPlaybackTrackId,
        fullLocalPlaybackTracks
      }),
    [currentPlaybackTrackId, fullLocalPlaybackTracks]
  );

  const loadCachedFullLocalPlaybackTrack = useCallback(
    async (trackId: string | null | undefined): Promise<FullLocalPlaybackTrack | null> => {
      if (!trackId) {
        return null;
      }

      const uploadedTrack = uploadedTracks[trackId] ?? null;
      if (uploadedTrack) {
        return uploadedTrack;
      }

      const roomTrack =
        roomSnapshot?.tracks.find((entry) => entry.id === trackId) ??
        (currentTrack?.id === trackId ? currentTrack : null);
      if (!roomTrack) {
        return null;
      }

      const existing = cachedFullLocalPlaybackTrackRef.current;
      if (existing?.trackId === trackId && existing.fileHash === roomTrack.fileHash) {
        return existing;
      }

      const cachedTrack = cacheLibraryTracks.find((entry) =>
        isCachedLibraryTrackUsableForRoomTrack({
          cachedTrack: entry,
          roomTrack
        })
      );
      if (!cachedTrack) {
        return null;
      }

      const cachedTrackFile = await loadCachedLibraryTrackFile(cachedTrack.fileHash);
      if (
        !cachedTrackFile ||
        !isCachedLibraryTrackUsableForRoomTrack({
          cachedTrack: cachedTrackFile,
          roomTrack
        })
      ) {
        notifyCachedFullLocalPlaybackLoadMiss(
          {
            trackId,
            fileHash: roomTrack.fileHash,
            cachedFileHash: cachedTrack.fileHash,
            roomTrack: {
              id: roomTrack.id,
              fileHash: roomTrack.fileHash,
              durationMs: roomTrack.durationMs ?? undefined,
              sizeBytes: roomTrack.sizeBytes ?? undefined
            }
          },
          false
        );
        return null;
      }

      const next = {
        trackId,
        fileHash: roomTrack.fileHash,
        file: cachedTrackFile.file,
        objectUrl: URL.createObjectURL(cachedTrackFile.file)
      };
      replaceLoadedTrack(next);
      return next;
    },
    [
      cacheLibraryTracks,
      currentTrack,
      loadCachedLibraryTrackFile,
      notifyCachedFullLocalPlaybackLoadMiss,
      replaceLoadedTrack,
      roomSnapshot?.tracks,
      uploadedTracks
    ]
  );

  const currentUploadedPlaybackTrack = currentPlaybackTrackId
    ? uploadedTracks[currentPlaybackTrackId] ?? null
    : null;
  const cachedFullLocalPlaybackLoadTarget = useMemo(
    () =>
      resolveCachedFullLocalPlaybackLoadTarget({
        currentPlaybackTrackId,
        currentTrack,
        uploadedTrack: currentUploadedPlaybackTrack,
        cachedPlaybackTrack: cachedFullLocalPlaybackTrack,
        cacheLibraryTracks
      }),
    [
      cacheLibraryTracks,
      cachedFullLocalPlaybackTrack,
      currentPlaybackTrackId,
      currentTrack,
      currentUploadedPlaybackTrack
    ]
  );
  const cachedFullLocalPlaybackLoadKey = getCachedFullLocalPlaybackLoadKey(
    cachedFullLocalPlaybackLoadTarget
  );
  const cachedFullLocalPlaybackLoadTargetRef =
    useRef<CachedFullLocalPlaybackLoadTarget | null>(null);
  useEffect(() => {
    cachedFullLocalPlaybackLoadTargetRef.current = cachedFullLocalPlaybackLoadTarget;
  }, [cachedFullLocalPlaybackLoadTarget]);

  useEffect(() => {
    const target = cachedFullLocalPlaybackLoadTargetRef.current;
    if (!target || !cachedFullLocalPlaybackLoadKey) {
      if (
        shouldClearCachedFullLocalPlaybackTrack({
          currentPlaybackTrackId,
          currentTrackFileHash: currentTrack?.fileHash ?? null,
          uploadedTrack: currentUploadedPlaybackTrack,
          cachedPlaybackTrack: cachedFullLocalPlaybackTrackRef.current
        })
      ) {
        replaceLoadedTrack(null);
      }
      return;
    }

    let cancelled = false;
    void (async () => {
      const cachedTrackFile = await loadCachedLibraryTrackFile(target.cachedFileHash);
      const latestTarget = cachedFullLocalPlaybackLoadTargetRef.current;
      const latestTargetMatches =
        getCachedFullLocalPlaybackLoadKey(latestTarget) === cachedFullLocalPlaybackLoadKey;
      const cachedTrackFileUsable = !!(
        cachedTrackFile &&
        isCachedLibraryTrackUsableForRoomTrack({
          cachedTrack: cachedTrackFile,
          roomTrack: target.roomTrack
        })
      );
      if (
        cancelled ||
        !latestTargetMatches
      ) {
        return;
      }
      if (!cachedTrackFileUsable) {
        notifyCachedFullLocalPlaybackLoadMiss(target, false);
        return;
      }

      const objectUrl = URL.createObjectURL(cachedTrackFile.file);
      if (cancelled) {
        URL.revokeObjectURL(objectUrl);
        return;
      }

      replaceLoadedTrack({
        trackId: target.trackId,
        fileHash: target.fileHash,
        file: cachedTrackFile.file,
        objectUrl
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    cacheLibraryTracks,
    cachedFullLocalPlaybackLoadKey,
    currentPlaybackTrackId,
    currentTrack?.fileHash,
    currentUploadedPlaybackTrack,
    loadCachedLibraryTrackFile,
    notifyCachedFullLocalPlaybackLoadMiss,
    replaceLoadedTrack
  ]);

  useEffect(
    () => () => {
      const cachedTrack = cachedFullLocalPlaybackTrackRef.current;
      if (cachedTrack) {
        URL.revokeObjectURL(cachedTrack.objectUrl);
        cachedFullLocalPlaybackTrackRef.current = null;
      }
    },
    []
  );

  return {
    cachedFullLocalPlaybackTrack,
    fullLocalPlaybackTracks,
    hasPlayableFullLocalTrack,
    loadCachedFullLocalPlaybackTrack
  };
}
