"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import type { GuestSession, RoomSnapshot } from "@music-room/shared";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import {
  deleteLocalTrackDataForTracks,
  listCachedLibraryTrackSummaries
} from "@/lib/indexeddb";
import type { CachedLibraryTrack, UploadedTrack } from "./audio-utils";
import {
  buildCachedLibraryTrackUpsertRecord,
  createInFlightCachedLibraryTrackFileLoader,
  hasUsableCachedLibraryFileForRoomTrack,
  loadCacheLibrarySnapshot
} from "./cache-library";
import { useUploadRuntimeEffects } from "./upload-runtime-effects";
import { useUploadPipelineActions } from "./use-upload-pipeline-actions";

export {
  buildRegisterTrackPayload,
  processSelectedTrackFiles
} from "./upload-pipeline";
export {
  buildCachedLibraryFileName,
  createInFlightCachedLibraryTrackFileLoader,
  hasUsableCachedLibraryFileForRoomTrack,
  toCachedLibraryFile,
  toCachedLibraryFileFromBlob,
  toCachedLibraryTrack,
  toCachedLibraryTrackFile
} from "./cache-library";

export function useTrackUploads(options: {
  activeSession: GuestSession | null;
  roomSnapshot: RoomSnapshot | null;
  dispatchRoomStateEvent: Dispatch<RoomStateEvent>;
  setStatusMessage: (message: string) => void;
}) {
  const {
    activeSession,
    roomSnapshot,
    dispatchRoomStateEvent,
    setStatusMessage
  } = options;
  const [uploadedTracks, setUploadedTracks] = useState<Record<string, UploadedTrack>>({});
  const [cacheLibraryVersion, setCacheLibraryVersion] = useState(0);
  const uploadedTrackUrlsRef = useRef<Map<string, string>>(new Map());
  const cacheLibraryTracksRef = useRef<Map<string, CachedLibraryTrack>>(new Map());
  const inFlightUploadHashesRef = useRef<Set<string>>(new Set());
  const roomTrackIdsKey = [...new Set(roomSnapshot?.tracks.map((track) => track.id) ?? [])]
    .sort()
    .join("|");

  const refreshCacheLibrary = useCallback(async () => {
    const snapshot = await loadCacheLibrarySnapshot({
      listCachedLibraryTrackSummaries
    });
    cacheLibraryTracksRef.current = snapshot.tracksByHash;
    setCacheLibraryVersion((current) => current + 1);
  }, []);

  useUploadRuntimeEffects({
    activeSession,
    cacheLibraryVersion,
    cacheLibraryTracksRef,
    deleteLocalTrackData: deleteLocalTrackDataForTracks,
    roomSnapshot,
    roomTrackIdsKey,
    setUploadedTracks,
    uploadedTrackUrlsRef,
    uploadedTracks
  });

  const { syncRoomSnapshot, handleFilesSelected } = useUploadPipelineActions({
    activeSession,
    dispatchRoomStateEvent,
    inFlightUploadHashesRef,
    refreshCacheLibrary,
    roomSnapshot,
    setStatusMessage,
    setUploadedTracks,
    uploadedTracks
  });

  const deleteUploadedTrackArtifacts = useCallback(async (trackId: string) => {
    setUploadedTracks((current) => {
      if (!current[trackId]) {
        return current;
      }
      const next = { ...current };
      delete next[trackId];
      return next;
    });
    await deleteLocalTrackDataForTracks([trackId]);
  }, []);

  const deleteRoomTrackArtifacts = useCallback(async (trackIds: string[]) => {
    const removed = new Set(trackIds);
    setUploadedTracks((current) => {
      const next = { ...current };
      for (const trackId of removed) {
        delete next[trackId];
      }
      return next;
    });
    await deleteLocalTrackDataForTracks([...removed]);
  }, []);

  useEffect(() => {
    void refreshCacheLibrary();
  }, [refreshCacheLibrary]);

  return {
    uploadedTracks,
    setUploadedTracks,
    refreshCacheLibrary,
    handleFilesSelected,
    syncRoomSnapshot,
    deleteUploadedTrackArtifacts,
    deleteRoomTrackArtifacts,
    hasUsableCachedLibraryFileForRoomTrack,
    createInFlightCachedLibraryTrackFileLoader,
    buildCachedLibraryTrackUpsertRecord
  };
}
