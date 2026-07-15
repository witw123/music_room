import { useEffect, type MutableRefObject, type SetStateAction, type Dispatch } from "react";
import type { GuestSession, RoomSnapshot } from "@music-room/shared";
import {
  getCachedLibraryTrack,
  getCachedLibraryTrackSummary
} from "@/lib/indexeddb";
import type { CachedLibraryTrack, UploadedTrack } from "./audio-utils";
import {
  applyOwnedUploadRehydrationResult,
  rehydrateOwnedUploadedTracksFromCache
} from "./upload-rehydration";
import {
  applyUploadRuntimePruneForActiveTracks,
  cleanupUploadRuntimeRefs,
  syncUploadedTrackObjectUrls
} from "./upload-runtime-cleanup";

type UploadRuntimeEffectsInput = {
  activeSession: GuestSession | null;
  cacheLibraryVersion: number;
  cacheLibraryTracksRef: MutableRefObject<Map<string, CachedLibraryTrack>>;
  roomSnapshot: RoomSnapshot | null;
  roomTrackIdsKey: string;
  setUploadedTracks: Dispatch<SetStateAction<Record<string, UploadedTrack>>>;
  uploadedTrackUrlsRef: MutableRefObject<Map<string, string>>;
  uploadedTracks: Record<string, UploadedTrack>;
};

export function useUploadRuntimeEffects({
  activeSession,
  cacheLibraryVersion,
  cacheLibraryTracksRef,
  roomSnapshot,
  roomTrackIdsKey,
  setUploadedTracks,
  uploadedTrackUrlsRef,
  uploadedTracks
}: UploadRuntimeEffectsInput) {
  useEffect(() => {
    uploadedTrackUrlsRef.current = syncUploadedTrackObjectUrls({
      currentUrls: uploadedTrackUrlsRef.current,
      uploadedTracks,
      revokeObjectUrl: (objectUrl) => URL.revokeObjectURL(objectUrl)
    });
  }, [uploadedTrackUrlsRef, uploadedTracks]);

  useEffect(() => {
    if (!roomSnapshot?.room.id) {
      return;
    }
    const activeTrackIds = new Set(roomTrackIdsKey ? roomTrackIdsKey.split("|") : []);
    applyUploadRuntimePruneForActiveTracks({
      activeTrackIds,
      setUploadedTracks
    });
  }, [roomSnapshot?.room.id, roomTrackIdsKey, setUploadedTracks]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !activeSession) {
      return;
    }

    const missingOwnedTracks = roomSnapshot.tracks.filter(
      (track) =>
        track.ownerSessionId === activeSession.userId &&
        !uploadedTracks[track.id]
    );
    if (missingOwnedTracks.length === 0) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const result = await rehydrateOwnedUploadedTracksFromCache({
        missingOwnedTracks,
        cachedLibraryTracksByHash: cacheLibraryTracksRef.current,
        getCachedLibraryTrackSummary,
        getCachedLibraryTrack,
        createObjectUrl: (file) => URL.createObjectURL(file)
      });

      applyOwnedUploadRehydrationResult({
        cancelled,
        result,
        setUploadedTracks,
        revokeObjectUrl: (objectUrl) => URL.revokeObjectURL(objectUrl)
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeSession,
    cacheLibraryVersion,
    cacheLibraryTracksRef,
    roomSnapshot?.room.id,
    roomSnapshot?.tracks,
    setUploadedTracks,
    uploadedTracks
  ]);

  useEffect(() => {
    return () => {
      cleanupUploadRuntimeRefs({
        uploadedTrackUrlsRef,
        cacheLibraryTracksRef,
        revokeObjectUrl: (objectUrl) => URL.revokeObjectURL(objectUrl)
      });
    };
  }, [cacheLibraryTracksRef, uploadedTrackUrlsRef]);
}
