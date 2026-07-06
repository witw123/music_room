import type { TrackAvailabilityAnnouncement, TrackMeta } from "@music-room/shared";
import type { UploadedTrack } from "@/features/upload/audio-utils";

type TrackRegistrationDraft = Omit<TrackMeta, "id"> & { id?: string };

export function buildRegisterTrackPayload(track: Omit<TrackMeta, "id"> & { id?: string }) {
  return {
    ...(track.id ? { id: track.id } : {}),
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.durationMs,
    bitrate: track.bitrate,
    sizeBytes: track.sizeBytes,
    codec: track.codec,
    mimeType: track.mimeType,
    fileHash: track.fileHash,
    artworkUrl: track.artworkUrl,
    ownerSessionId: track.ownerSessionId,
    ownerNickname: track.ownerNickname,
    sourceType: track.sourceType,
    pieceManifest: track.pieceManifest,
    relayManifest: track.relayManifest
  };
}

export function buildCachedLibraryTrackRegisterPayload(
  track: Omit<TrackMeta, "id"> & { id?: string }
) {
  return buildRegisterTrackPayload(track);
}

export async function processSelectedTrackFiles(input: {
  files: File[];
  activeSession: { userId: string; nickname: string } | null;
  roomId: string | null | undefined;
  roomTracks: TrackMeta[];
  peerId: string | null | undefined;
  manualTrackCachingEnabled: boolean;
  inFlightUploadHashes: Set<string>;
  createObjectUrl: (file: File) => string;
  revokeObjectUrl: (objectUrl: string) => void;
  buildTrackMeta: (file: File, objectUrl: string) => Promise<TrackRegistrationDraft>;
  buildRegisterTrackPayload: (track: TrackRegistrationDraft) => unknown;
  registerTrack: (roomId: string, payload: unknown) => Promise<TrackMeta>;
  persistTrackIntoLibrary: (input: {
    track: TrackMeta;
    roomId: string;
    file: File;
  }) => Promise<void>;
  buildTrackAvailabilityFromFile: (input: {
    roomId: string;
    trackId: string;
    fileHash: string;
    file: File;
    peerId: string;
    nickname: string;
    source: "live_upload";
    mimeType: string | null;
    codec: string | null;
    sizeBytes: number;
    durationMs: number;
    totalChunks?: number;
    chunkSize?: number;
  }) => Promise<TrackAvailabilityAnnouncement>;
  publishAvailability: (availability: TrackAvailabilityAnnouncement) => void;
}) {
  const uploads: Record<string, UploadedTrack> = {};
  const registeredTracks: TrackMeta[] = [];
  if (!input.activeSession || !input.roomId) {
    return {
      uploads,
      registeredTracks,
      importedCount: 0
    };
  }

  const currentTracksByHash = new Map(
    input.roomTracks
      .filter((track) => track.ownerSessionId === input.activeSession?.userId)
      .map((track) => [track.fileHash, track] as const)
  );

  for (const file of input.files) {
    const objectUrl = input.createObjectUrl(file);
    const track = await input.buildTrackMeta(file, objectUrl);
    const uploadHashKey = `${input.activeSession.userId}:${track.fileHash}`;

    if (input.inFlightUploadHashes.has(uploadHashKey)) {
      input.revokeObjectUrl(objectUrl);
      continue;
    }

    const existingTrack = currentTracksByHash.get(track.fileHash);
    if (existingTrack) {
      input.revokeObjectUrl(objectUrl);
      continue;
    }

    input.inFlightUploadHashes.add(uploadHashKey);
    let registered: TrackMeta;
    try {
      registered = await input.registerTrack(
        input.roomId,
        input.buildRegisterTrackPayload(track)
      );
    } finally {
      input.inFlightUploadHashes.delete(uploadHashKey);
    }

    uploads[registered.id] = {
      file,
      objectUrl,
      origin: "live-upload"
    };
    registeredTracks.push(registered);
    currentTracksByHash.set(registered.fileHash, registered);

    if (input.manualTrackCachingEnabled) {
      await input.persistTrackIntoLibrary({
        track: registered,
        roomId: input.roomId,
        file
      });
    }

    if (input.peerId) {
      input.publishAvailability(
        await input.buildTrackAvailabilityFromFile({
          roomId: input.roomId,
          trackId: registered.id,
          fileHash: registered.fileHash,
          file,
          peerId: input.peerId,
          nickname: input.activeSession.nickname,
          source: "live_upload",
          mimeType: registered.mimeType ?? null,
          codec: registered.codec ?? null,
          sizeBytes: registered.sizeBytes ?? file.size,
          durationMs: registered.durationMs,
          totalChunks: registered.pieceManifest?.totalChunks,
          chunkSize: registered.pieceManifest?.chunkSize
        })
      );
    }
  }

  return {
    uploads,
    registeredTracks,
    importedCount: Object.keys(uploads).length
  };
}
