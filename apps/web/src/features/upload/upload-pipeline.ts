import type { TrackMeta } from "@music-room/shared";

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
