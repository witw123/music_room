import type {
  TrackAvailabilityAnnouncement,
  TrackMeta
} from "@music-room/shared";
import type { UploadedTrack } from "@/features/upload/audio-utils";
import type {
  CachedLibraryTrackRecord,
  CachedLibraryTrackSummaryRecord,
  TrackPieceManifestRecord
} from "@/lib/indexeddb";
import { isCachedLibraryTrackUsableForRoomTrack } from "@/features/upload/cached-library-track-policy";

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

export async function announceRoomTrackAvailability(input: {
  roomId: string | null | undefined;
  roomTracks: TrackMeta[];
  activeSession: { nickname: string } | null;
  peerId: string | null | undefined;
  trackId: string;
  uploadedTrack: UploadedTrack | null | undefined;
  force?: boolean;
  inFlightAnnouncements: Set<string>;
  announcementTtl: Map<string, number>;
  nowMs?: number;
  getCachedLibraryTrackSummary: (
    fileHash: string
  ) => Promise<CachedLibraryTrackSummaryRecord | null | undefined>;
  getCachedLibraryTrack: (
    fileHash: string
  ) => Promise<CachedLibraryTrackRecord | null | undefined>;
  getTrackPieceManifestByFileHash: (
    fileHash: string
  ) => Promise<TrackPieceManifestRecord | null | undefined>;
  getTrackPieceManifest: (
    trackId: string
  ) => Promise<TrackPieceManifestRecord | null | undefined>;
  buildTrackAvailabilityFromCache: (input: {
    roomId: string;
    trackId: string;
    fileHash: string;
    peerId: string;
    nickname: string;
    totalChunks?: number;
    chunkSize?: number;
    assetHash: string;
  }) => Promise<TrackAvailabilityAnnouncement | null>;
  buildTrackAvailabilityFromManifest: (input: {
    roomId: string;
    trackId: string;
    fileHash: string;
    track: TrackMeta;
    file: Blob;
    cacheManifest: TrackPieceManifestRecord | null;
    peerId: string;
    nickname: string;
    source: "live_upload" | "local_cache";
    mimeType: string | null;
    codec: string | null;
    sizeBytes: number;
    durationMs: number;
    totalChunks?: number;
    chunkSize?: number;
  }) => TrackAvailabilityAnnouncement | null;
  publishAvailability: (availability: TrackAvailabilityAnnouncement) => void;
}) {
  if (!input.roomId || !input.activeSession || !shouldAnnounceTrackAvailability(input)) {
    return false;
  }
  const peerId = input.peerId;
  if (!peerId) {
    return false;
  }

  const track = input.roomTracks.find((entry) => entry.id === input.trackId);
  if (!track) {
    return false;
  }

  let fallbackFile: Blob | File | null = input.uploadedTrack?.file ?? null;
  if (!fallbackFile) {
    const cachedLibraryTrack = await input.getCachedLibraryTrackSummary(track.fileHash);
    if (
      isCachedLibraryTrackUsableForRoomTrack({
        cachedTrack: cachedLibraryTrack,
        roomTrack: track
      })
    ) {
      fallbackFile = (await input.getCachedLibraryTrack(track.fileHash))?.file ?? null;
    }
  }

  const announcementKey = [input.roomId, input.trackId, track.fileHash, input.peerId].join("|");
  const now = input.nowMs ?? Date.now();
  const lastAnnouncedAt = input.announcementTtl.get(announcementKey) ?? 0;
  if (
    input.inFlightAnnouncements.has(announcementKey) ||
    (!input.force && now - lastAnnouncedAt < 5_000)
  ) {
    return false;
  }
  input.inFlightAnnouncements.add(announcementKey);

  try {
    const expectedManifest = track.relayManifest ?? track.pieceManifest ?? null;
    const rawCachedManifest =
      (await input.getTrackPieceManifestByFileHash(track.fileHash)) ??
      (await input.getTrackPieceManifest(input.trackId));
    const cachedManifest = resolveReusableCachedPieceManifest({
      cachedManifest: rawCachedManifest,
      expectedManifest
    });

    if (!fallbackFile) {
      const availabilityFromPieces = await input.buildTrackAvailabilityFromCache({
        roomId: input.roomId,
        trackId: input.trackId,
        fileHash: track.fileHash,
        peerId,
        nickname: input.activeSession.nickname,
        totalChunks: cachedManifest?.totalChunks ?? expectedManifest?.totalChunks,
        chunkSize: cachedManifest?.chunkSize ?? expectedManifest?.chunkSize,
        assetHash: track.fileHash
      });
      if (
        availabilityFromPieces &&
        availabilityFromPieces.availableChunks.length > 0
      ) {
        input.announcementTtl.set(announcementKey, now);
        input.publishAvailability(availabilityFromPieces);
        return true;
      }
      return false;
    }

    const availability = input.buildTrackAvailabilityFromManifest({
      roomId: input.roomId,
      trackId: input.trackId,
      fileHash: track.fileHash,
      track,
      file: fallbackFile,
      cacheManifest: cachedManifest,
      peerId,
      nickname: input.activeSession.nickname,
      source: input.uploadedTrack ? "live_upload" : "local_cache",
      mimeType: track.mimeType ?? null,
      codec: track.codec ?? null,
      sizeBytes: track.sizeBytes ?? fallbackFile.size,
      durationMs: track.durationMs,
      totalChunks: track.relayManifest?.totalChunks ?? track.pieceManifest?.totalChunks,
      chunkSize: track.relayManifest?.chunkSize ?? track.pieceManifest?.chunkSize
    });
    if (availability) {
      input.announcementTtl.set(announcementKey, now);
      input.publishAvailability(availability);
      return true;
    }
    return false;
  } finally {
    input.inFlightAnnouncements.delete(announcementKey);
  }
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
