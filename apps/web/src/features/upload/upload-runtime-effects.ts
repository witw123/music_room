import { useEffect, useRef, type MutableRefObject, type SetStateAction, type Dispatch } from "react";
import type { GuestSession, RoomSnapshot } from "@music-room/shared";
import {
  getCachedLibraryTrack,
  getCachedLibraryTrackSummary
} from "@/lib/indexeddb";
import { getLocalAudioFile } from "./local-audio-storage";
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
  deleteLocalTrackData: (trackIds: readonly string[]) => Promise<void>;
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
  deleteLocalTrackData,
  setUploadedTracks,
  uploadedTrackUrlsRef,
  uploadedTracks
}: UploadRuntimeEffectsInput) {
  const previousRoomTracksRef = useRef<{ roomId: string | null; trackIds: Set<string> }>({
    roomId: null,
    trackIds: new Set()
  });

  useEffect(() => {
    uploadedTrackUrlsRef.current = syncUploadedTrackObjectUrls({
      currentUrls: uploadedTrackUrlsRef.current,
      uploadedTracks,
      revokeObjectUrl: (objectUrl) => URL.revokeObjectURL(objectUrl)
    });
  }, [uploadedTrackUrlsRef, uploadedTracks]);

  useEffect(() => {
    if (!roomSnapshot?.room.id) {
      previousRoomTracksRef.current = { roomId: null, trackIds: new Set() };
      return;
    }
    const activeTrackIds = new Set(roomTrackIdsKey ? roomTrackIdsKey.split("|") : []);
    applyUploadRuntimePruneForActiveTracks({
      activeTrackIds,
      setUploadedTracks
    });

    const previous = previousRoomTracksRef.current;
    if (previous.roomId === roomSnapshot.room.id) {
      const removedTrackIds = [...previous.trackIds].filter((trackId) => !activeTrackIds.has(trackId));
      if (removedTrackIds.length > 0) {
        void deleteLocalTrackData(removedTrackIds);
      }
    }
    previousRoomTracksRef.current = {
      roomId: roomSnapshot.room.id,
      trackIds: activeTrackIds
    };
  }, [deleteLocalTrackData, roomSnapshot?.room.id, roomTrackIdsKey, setUploadedTracks]);

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
        getLocalAudioFile,
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
