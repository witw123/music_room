"use client";

import { useMemo, useRef } from "react";
import type { RoomSnapshot, TrackAvailabilityAnnouncement } from "@music-room/shared";
import {
  buildProgressiveTrackManifest,
  getProgressiveEngineType,
  type ProgressiveEngineType
} from "@/features/playback/progressive-playback";
import type { FullLocalPlaybackTrack } from "@/features/playback/use-progressive-runtime";
import { selectCanonicalTrackAvailabilityAnnouncement } from "@/features/p2p";
import { isCurrentPlaybackSourceDevice } from "@/features/playback/playback-source-identity";
import { resolveSlidingWindowFormat } from "@/features/playback/sliding-window/format-detection";
import { isCachedLibraryTrackUsableForRoomTrack } from "@/features/upload/cached-library-track-policy";
import {
  resolvePlaybackSurfaceKey,
  resolvePlaybackTimelineKey
} from "@/features/room/hooks/room-playback-topology";

export type CachedFullLocalPlaybackTrack = FullLocalPlaybackTrack & {
  trackId: string;
  fileHash: string;
};

export type CachedFullLocalPlaybackLoadTarget = {
  trackId: string;
  fileHash: string;
  cachedFileHash: string;
  roomTrack: {
    id: string;
    fileHash: string;
    durationMs?: number;
    sizeBytes?: number;
  };
};

type StableTrackMeta = Pick<
  RoomSnapshot["tracks"][number],
  | "id"
  | "title"
  | "artist"
  | "album"
  | "durationMs"
  | "bitrate"
  | "sizeBytes"
  | "codec"
  | "mimeType"
  | "fileHash"
  | "artworkUrl"
  | "ownerSessionId"
  | "ownerNickname"
  | "sourceType"
  | "pieceManifest"
  | "relayManifest"
>;

type UseRoomPageDerivedInput = {
  activeSessionId: string | null | undefined;
  peerId: string;
  roomSnapshot: RoomSnapshot | null;
};

function areTrackPieceManifestsEqual(
  previous: StableTrackMeta["pieceManifest"] | StableTrackMeta["relayManifest"],
  next: StableTrackMeta["pieceManifest"] | StableTrackMeta["relayManifest"]
) {
  if (previous === next) {
    return true;
  }

  if (!previous || !next) {
    return previous === next;
  }

  return (
    previous.totalChunks === next.totalChunks &&
    previous.chunkSize === next.chunkSize &&
    previous.pieceMimeType === next.pieceMimeType
  );
}

function areTrackMetasEqual(previous: StableTrackMeta, next: StableTrackMeta) {
  return (
    previous.id === next.id &&
    previous.title === next.title &&
    previous.artist === next.artist &&
    previous.album === next.album &&
    previous.durationMs === next.durationMs &&
    previous.bitrate === next.bitrate &&
    previous.sizeBytes === next.sizeBytes &&
    previous.codec === next.codec &&
    previous.mimeType === next.mimeType &&
    previous.fileHash === next.fileHash &&
    previous.artworkUrl === next.artworkUrl &&
    previous.ownerSessionId === next.ownerSessionId &&
    previous.ownerNickname === next.ownerNickname &&
    previous.sourceType === next.sourceType &&
    areTrackPieceManifestsEqual(previous.pieceManifest, next.pieceManifest) &&
    areTrackPieceManifestsEqual(previous.relayManifest, next.relayManifest)
  );
}

export function resolveStableCurrentTrack<TTrack extends StableTrackMeta>(
  previousTrack: TTrack | null,
  currentPlaybackTrackId: string | null | undefined,
  tracks: TTrack[] | null | undefined
) {
  const nextTrack = currentPlaybackTrackId
    ? tracks?.find((track) => track.id === currentPlaybackTrackId) ?? null
    : null;
  if (previousTrack && nextTrack && areTrackMetasEqual(previousTrack, nextTrack)) {
    return previousTrack;
  }

  return nextTrack;
}

export function resolveRoomPagePlaybackState(input: UseRoomPageDerivedInput) {
  const roomPlayback = input.roomSnapshot?.room.playback ?? null;
  const currentPlaybackTrackId = roomPlayback?.currentTrackId ?? null;
  const playbackMediaEpoch = roomPlayback?.mediaEpoch ?? null;
  const playbackQueueVersion = roomPlayback?.queueVersion ?? null;
  const playbackRevision = roomPlayback?.playbackRevision ?? null;
  const playbackSourcePeerId = roomPlayback?.sourcePeerId ?? null;
  const playbackSourceSessionId = roomPlayback?.sourceSessionId ?? null;
  const playbackStatus = roomPlayback?.status ?? null;

  return {
    roomPlayback,
    currentPlaybackTrackId,
    playbackMediaEpoch,
    playbackQueueVersion,
    playbackRevision,
    playbackSourcePeerId,
    playbackSourceSessionId,
    playbackStatus,
    isCurrentSourceOwner: isCurrentPlaybackSourceDevice({
      playback: roomPlayback,
      peerId: input.peerId,
      activeSessionId: input.activeSessionId
    }),
    playbackSurfaceKey: resolvePlaybackSurfaceKey(roomPlayback),
    playbackTimelineKey: resolvePlaybackTimelineKey(roomPlayback),
    playbackTopologySnapshot: currentPlaybackTrackId
      ? {
          currentTrackId: currentPlaybackTrackId,
          mediaEpoch: playbackMediaEpoch,
          sourcePeerId: playbackSourcePeerId,
          sourceSessionId: playbackSourceSessionId
        }
      : null
  };
}

export function useRoomPageDerived({
  activeSessionId,
  peerId,
  roomSnapshot
}: UseRoomPageDerivedInput) {
  const roomPlayback = roomSnapshot?.room.playback ?? null;
  const currentPlaybackTrackId = roomPlayback?.currentTrackId ?? null;
  const playbackMediaEpoch = roomPlayback?.mediaEpoch ?? null;
  const playbackQueueVersion = roomPlayback?.queueVersion ?? null;
  const playbackRevision = roomPlayback?.playbackRevision ?? null;
  const playbackSourcePeerId = roomPlayback?.sourcePeerId ?? null;
  const playbackSourceSessionId = roomPlayback?.sourceSessionId ?? null;
  const playbackStatus = roomPlayback?.status ?? null;

  const isCurrentSourceOwner = useMemo(
    () => {
      if (!currentPlaybackTrackId) {
        return false;
      }

      if (peerId && playbackSourcePeerId) {
        return playbackSourcePeerId === peerId;
      }

      return Boolean(activeSessionId && playbackSourceSessionId === activeSessionId);
    },
    [
      activeSessionId,
      currentPlaybackTrackId,
      peerId,
      playbackSourcePeerId,
      playbackSourceSessionId
    ]
  );
  const playbackSurfaceKey = useMemo(
    () => {
      if (!currentPlaybackTrackId) {
        return null;
      }

      const sourceIdentity = playbackSourceSessionId ?? playbackSourcePeerId ?? "none";
      const mediaEpoch = typeof playbackMediaEpoch === "number" ? playbackMediaEpoch : "none";
      return [currentPlaybackTrackId, sourceIdentity, mediaEpoch].join("|");
    },
    [currentPlaybackTrackId, playbackMediaEpoch, playbackSourcePeerId, playbackSourceSessionId]
  );
  const playbackTimelineKey = useMemo(
    () => {
      if (!currentPlaybackTrackId) {
        return null;
      }

      const playbackTimelineRevision =
        typeof playbackRevision === "number" ? playbackRevision : playbackQueueVersion;
      const mediaEpoch = typeof playbackMediaEpoch === "number" ? playbackMediaEpoch : "none";
      return [currentPlaybackTrackId, playbackTimelineRevision, mediaEpoch].join("|");
    },
    [currentPlaybackTrackId, playbackMediaEpoch, playbackQueueVersion, playbackRevision]
  );
  const playbackTopologySnapshot = useMemo(
    () =>
      currentPlaybackTrackId
        ? {
            currentTrackId: currentPlaybackTrackId,
            mediaEpoch: playbackMediaEpoch,
            sourcePeerId: playbackSourcePeerId,
            sourceSessionId: playbackSourceSessionId
          }
        : null,
    [currentPlaybackTrackId, playbackMediaEpoch, playbackSourcePeerId, playbackSourceSessionId]
  );
  const currentTrackRef = useRef<RoomSnapshot["tracks"][number] | null>(null);
  const currentTrack = useMemo(
    () => resolveStableCurrentTrack(currentTrackRef.current, currentPlaybackTrackId, roomSnapshot?.tracks),
    [currentPlaybackTrackId, roomSnapshot?.tracks]
  );
  currentTrackRef.current = currentTrack;

  return {
    roomPlayback,
    currentPlaybackTrackId,
    playbackMediaEpoch,
    playbackQueueVersion,
    playbackRevision,
    playbackSourcePeerId,
    playbackSourceSessionId,
    playbackStatus,
    isCurrentSourceOwner,
    playbackSurfaceKey,
    playbackTimelineKey,
    playbackTopologySnapshot,
    currentTrack
  };
}

export function useCurrentProgressiveEngineTypeForSource(input: {
  currentTrack: RoomSnapshot["tracks"][number] | null;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  peerId: string;
}) {
  return useMemo(() => {
    const currentTrack = input.currentTrack;
    if (!currentTrack?.id) {
      return "none";
    }

    const trackAvailability = input.availabilityByTrack[currentTrack.id] ?? {};
    const localAvailability = trackAvailability[input.peerId] ?? null;
    const manifestHint = selectCanonicalTrackAvailabilityAnnouncement(
      Object.values(trackAvailability)
    );
    const manifest = buildProgressiveTrackManifest(
      currentTrack,
      localAvailability,
      manifestHint
    );

    return getProgressiveEngineType(manifest);
  }, [input.availabilityByTrack, input.currentTrack, input.peerId]);
}

export function selectFullLocalPlaybackTracks(input: {
  uploadedTracks: Record<string, FullLocalPlaybackTrack>;
  cachedPlaybackTrack: CachedFullLocalPlaybackTrack | null | undefined;
}) {
  const next: Record<string, FullLocalPlaybackTrack> = { ...input.uploadedTracks };
  const cachedPlaybackTrack = input.cachedPlaybackTrack;
  if (cachedPlaybackTrack && !next[cachedPlaybackTrack.trackId]) {
    next[cachedPlaybackTrack.trackId] = {
      file: cachedPlaybackTrack.file,
      objectUrl: cachedPlaybackTrack.objectUrl
    };
  }

  return next;
}

export function hasPlayableFullLocalPlaybackTrack(input: {
  currentPlaybackTrackId: string | null | undefined;
  fullLocalPlaybackTracks: Record<string, FullLocalPlaybackTrack>;
}) {
  return !!(
    input.currentPlaybackTrackId &&
    input.fullLocalPlaybackTracks[input.currentPlaybackTrackId]
  );
}

export function getPlaybackSourceInitializationKey(input: {
  playbackSurfaceKey: string | null | undefined;
  currentPlaybackTrackId: string | null | undefined;
  currentTrack:
    | {
        id: string;
        fileHash: string;
        mimeType?: string | null;
        codec?: string | null;
        title?: string | null;
      }
    | null
    | undefined;
  currentProgressiveEngineTypeForSource: ProgressiveEngineType | null | undefined;
  hasPlayableFullLocalTrack: boolean;
}) {
  if (!input.currentPlaybackTrackId) {
    return null;
  }

  const format = resolveSlidingWindowFormat({
    mimeType: input.currentTrack?.mimeType ?? null,
    codec: input.currentTrack?.codec ?? null,
    title: input.currentTrack?.title ?? null
  });

  return [
    input.playbackSurfaceKey ?? "no-surface",
    input.currentPlaybackTrackId,
    input.currentTrack?.id ?? "missing-track",
    input.currentTrack?.fileHash ?? "missing-hash",
    format,
    input.currentProgressiveEngineTypeForSource ?? "none",
    input.hasPlayableFullLocalTrack ? "full-local-ready" : "full-local-pending"
  ].join("|");
}

export function shouldInitializePlaybackSource(input: {
  previousInitializationKey: string | null;
  nextInitializationKey: string | null;
}) {
  return input.previousInitializationKey !== input.nextInitializationKey;
}

export function getCachedFullLocalPlaybackLoadKey(
  target: CachedFullLocalPlaybackLoadTarget | null | undefined
) {
  return target ? `${target.trackId}:${target.fileHash}` : null;
}

export function getCachedFullLocalPlaybackLoadMissKey(
  target: CachedFullLocalPlaybackLoadTarget | null | undefined
) {
  return target ? `${target.trackId}:${target.fileHash}:${target.cachedFileHash}` : null;
}

export function shouldNotifyCachedFullLocalPlaybackLoadMiss(input: {
  target: CachedFullLocalPlaybackLoadTarget | null | undefined;
  cachedTrackFileLoaded: boolean;
  notifiedMissKeys: ReadonlySet<string>;
}) {
  const missKey = getCachedFullLocalPlaybackLoadMissKey(input.target);
  return !!missKey && !input.cachedTrackFileLoaded && !input.notifiedMissKeys.has(missKey);
}

export function resolveCachedFullLocalPlaybackLoadTarget(input: {
  currentPlaybackTrackId: string | null | undefined;
  currentTrack:
    | {
        id: string;
        fileHash: string;
        durationMs?: number | null;
        sizeBytes?: number | null;
      }
    | null
    | undefined;
  uploadedTrack: FullLocalPlaybackTrack | null | undefined;
  cachedPlaybackTrack: CachedFullLocalPlaybackTrack | null | undefined;
  cacheLibraryTracks: Array<{
    fileHash: string;
    sourceTrackIds: string[];
    lastSourceTrackId: string | null;
    durationMs: number;
    sizeBytes: number;
  }>;
}): CachedFullLocalPlaybackLoadTarget | null {
  const { currentPlaybackTrackId, currentTrack } = input;
  if (!currentPlaybackTrackId || !currentTrack || input.uploadedTrack) {
    return null;
  }

  if (
    input.cachedPlaybackTrack?.trackId === currentPlaybackTrackId &&
    input.cachedPlaybackTrack.fileHash === currentTrack.fileHash
  ) {
    return null;
  }

  const roomTrack = {
    id: currentTrack.id,
    fileHash: currentTrack.fileHash,
    durationMs: currentTrack.durationMs ?? undefined,
    sizeBytes: currentTrack.sizeBytes ?? undefined
  };
  const cachedTrack = input.cacheLibraryTracks.find((entry) =>
    isCachedLibraryTrackUsableForRoomTrack({
      cachedTrack: entry,
      roomTrack
    })
  );
  if (!cachedTrack) {
    return null;
  }

  return {
    trackId: currentPlaybackTrackId,
    fileHash: currentTrack.fileHash,
    cachedFileHash: cachedTrack.fileHash,
    roomTrack
  };
}

export function shouldClearCachedFullLocalPlaybackTrack(input: {
  currentPlaybackTrackId: string | null | undefined;
  currentTrackFileHash: string | null | undefined;
  uploadedTrack: FullLocalPlaybackTrack | null | undefined;
  cachedPlaybackTrack: CachedFullLocalPlaybackTrack | null | undefined;
}) {
  const cachedPlaybackTrack = input.cachedPlaybackTrack;
  if (!cachedPlaybackTrack) {
    return false;
  }

  if (!input.currentPlaybackTrackId || input.uploadedTrack) {
    return true;
  }

  return (
    cachedPlaybackTrack.trackId !== input.currentPlaybackTrackId ||
    cachedPlaybackTrack.fileHash !== input.currentTrackFileHash
  );
}
