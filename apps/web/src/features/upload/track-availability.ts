import type {
  TrackAvailabilityAnnouncement,
  TrackMeta
} from "@music-room/shared";
import type { UploadedTrack } from "@/features/upload/audio-utils";

type RehydratableRoomTrack = Pick<TrackMeta, "id" | "fileHash" | "ownerSessionId">;

export type TrackPieceManifestGeometry = {
  totalChunks: number;
  chunkSize: number;
};

export function shouldAnnounceTrackAvailability(input: {
  peerId: string | null | undefined;
}) {
  return Boolean(input.peerId);
}

export function resolveReusableCachedPieceManifest<T extends TrackPieceManifestGeometry>(input: {
  cachedManifest: T | null | undefined;
  expectedManifest: TrackPieceManifestGeometry | null | undefined;
}) {
  if (!input.cachedManifest) {
    return null;
  }

  if (
    input.expectedManifest &&
    (input.cachedManifest.totalChunks !== input.expectedManifest.totalChunks ||
      input.cachedManifest.chunkSize !== input.expectedManifest.chunkSize)
  ) {
    return null;
  }

  return input.cachedManifest;
}

export function isManualCachePieceCompatible(input: {
  piece: TrackPieceManifestGeometry;
  expectedManifest: TrackPieceManifestGeometry | null | undefined;
}) {
  if (!input.expectedManifest) {
    return true;
  }

  return (
    input.piece.totalChunks === input.expectedManifest.totalChunks &&
    input.piece.chunkSize === input.expectedManifest.chunkSize
  );
}

export function buildManualCachePieceAvailabilityAnnouncement(input: {
  existing?: TrackAvailabilityAnnouncement | null;
  roomId: string;
  trackId: string;
  fileHash: string;
  peerId: string;
  nickname: string;
  chunkIndex: number;
  totalChunks: number;
  chunkSize: number;
  availableChunks?: number[];
}) {
  const existing = input.existing ?? null;
  const availableChunks = new Set(
    [...(existing?.availableChunks ?? []), ...(input.availableChunks ?? [])].filter(
      (chunkIndex) => chunkIndex >= 0 && chunkIndex < input.totalChunks
    )
  );
  availableChunks.add(input.chunkIndex);

  return {
    roomId: input.roomId,
    trackId: input.trackId,
    ownerPeerId: input.peerId,
    nickname: input.nickname,
    assetKind: "relay",
    assetHash: input.fileHash,
    totalChunks: input.totalChunks,
    chunkSize: input.chunkSize,
    availableChunks: [...availableChunks].sort((left, right) => left - right),
    source: "local_cache",
    announcedAt: new Date().toISOString()
  } satisfies TrackAvailabilityAnnouncement;
}

export function resolveMissingOwnedUploadedTracks(input: {
  roomTracks: RehydratableRoomTrack[];
  activeSessionId: string | null | undefined;
  uploadedTracks: Record<string, UploadedTrack>;
}) {
  if (!input.activeSessionId) {
    return [];
  }

  return input.roomTracks.filter(
    (track) =>
      track.ownerSessionId === input.activeSessionId &&
      !input.uploadedTracks[track.id] &&
      !!track.fileHash
  );
}
