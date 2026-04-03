"use client";

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { ChunkScheduler } from "@/features/p2p";

type UseTrackHydrationQueueInput = {
  isPageVisible: boolean;
  uploadedTrackIdsRef: MutableRefObject<string[]>;
  chunkSchedulerRef: MutableRefObject<ChunkScheduler | null>;
  canHydrateTrack?: (trackId: string) => boolean;
  hydrateTrackFromPieces: (
    trackId: string,
    mimeType: string,
    totalChunks: number
  ) => Promise<unknown>;
};

export function useTrackHydrationQueue({
  isPageVisible,
  uploadedTrackIdsRef,
  chunkSchedulerRef,
  canHydrateTrack,
  hydrateTrackFromPieces
}: UseTrackHydrationQueueInput) {
  const hydrationQueueRef = useRef(new Map<string, { mimeType: string; totalChunks: number }>());
  const hydrationTimerRef = useRef<number | null>(null);
  const hydratingTrackIdsRef = useRef(new Set<string>());

  const hydrateTrackFromPiecesWithCleanup = useCallback(
    async (trackId: string, mimeType: string, totalChunks: number) => {
      await hydrateTrackFromPieces(trackId, mimeType, totalChunks);
      chunkSchedulerRef.current?.markTrackHydrated(trackId);
    },
    [chunkSchedulerRef, hydrateTrackFromPieces]
  );

  const drainHydrationQueue = useCallback(function scheduleDrain() {
    if (hydrationTimerRef.current !== null) {
      return;
    }

    hydrationTimerRef.current = window.setTimeout(() => {
      hydrationTimerRef.current = null;
      const nextJob = hydrationQueueRef.current.entries().next();
      if (nextJob.done) {
        return;
      }

      const [trackId, job] = nextJob.value;
      hydrationQueueRef.current.delete(trackId);

      if (
        uploadedTrackIdsRef.current.includes(trackId) ||
        hydratingTrackIdsRef.current.has(trackId)
      ) {
        if (hydrationQueueRef.current.size > 0) {
          scheduleDrain();
        }
        return;
      }

      hydratingTrackIdsRef.current.add(trackId);
      void hydrateTrackFromPiecesWithCleanup(trackId, job.mimeType, job.totalChunks)
        .catch(() => undefined)
        .finally(() => {
          hydratingTrackIdsRef.current.delete(trackId);
          if (hydrationQueueRef.current.size > 0) {
            scheduleDrain();
          }
        });
    }, isPageVisible ? 220 : 60);
  }, [hydrateTrackFromPiecesWithCleanup, isPageVisible, uploadedTrackIdsRef]);

  const scheduleTrackHydration = useCallback(
    (trackId: string, mimeType: string, totalChunks: number) => {
      if (uploadedTrackIdsRef.current.includes(trackId)) {
        return;
      }

      if (!chunkSchedulerRef.current?.isTrackComplete(trackId, totalChunks)) {
        return;
      }

      if (canHydrateTrack && !canHydrateTrack(trackId)) {
        return;
      }

      hydrationQueueRef.current.set(trackId, {
        mimeType,
        totalChunks
      });
      drainHydrationQueue();
    },
    [canHydrateTrack, chunkSchedulerRef, drainHydrationQueue, uploadedTrackIdsRef]
  );

  const resetHydrationQueue = useCallback(() => {
    hydrationQueueRef.current.clear();
    hydratingTrackIdsRef.current.clear();
    if (hydrationTimerRef.current !== null) {
      window.clearTimeout(hydrationTimerRef.current);
      hydrationTimerRef.current = null;
    }
  }, []);

  useEffect(() => resetHydrationQueue, [resetHydrationQueue]);

  return {
    scheduleTrackHydration,
    resetHydrationQueue
  };
}
