import type { TrackAvailabilityAnnouncement } from "@music-room/shared";
import { cacheTrackPieces, getCachedPieceIndexes } from "@/lib/indexeddb";

export const p2pFeatureBoundary =
  "P2P feature owns peer connectivity, chunk transfer, cache indexing, and source selection.";

export * from "./mesh";

export const defaultChunkSize = 512 * 1024;

export function getMissingChunkIndexes(
  totalChunks: number,
  availableChunks: number[],
  limit = totalChunks
) {
  const owned = new Set(availableChunks);
  const missing: number[] = [];

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    if (!owned.has(chunkIndex)) {
      missing.push(chunkIndex);
    }

    if (missing.length >= limit) {
      break;
    }
  }

  return missing;
}

export function summarizeTrackAvailability(
  trackId: string,
  announcements: TrackAvailabilityAnnouncement[],
  localPeerId: string
) {
  const local = announcements.find((announcement) => announcement.ownerPeerId === localPeerId);
  const totalChunks = local?.totalChunks ?? announcements[0]?.totalChunks ?? 0;
  const localChunkCount = local?.availableChunks.length ?? 0;

  return {
    trackId,
    peerCount: announcements.length,
    localChunkCount,
    totalChunks,
    completionRatio: totalChunks > 0 ? localChunkCount / totalChunks : 0,
    sources: announcements.map(
      (announcement) => `${announcement.nickname} (${announcement.source})`
    )
  };
}

export function selectChunkSource(
  announcements: TrackAvailabilityAnnouncement[],
  connectedPeerIds: string[],
  localPeerId: string,
  excludedPeerIds: string[] = []
) {
  const excluded = new Set(excludedPeerIds);

  return announcements
    .filter(
      (announcement) =>
        announcement.ownerPeerId !== localPeerId &&
        connectedPeerIds.includes(announcement.ownerPeerId) &&
        !excluded.has(announcement.ownerPeerId)
    )
    .sort((left, right) => {
      const chunkDifference = right.availableChunks.length - left.availableChunks.length;
      if (chunkDifference !== 0) {
        return chunkDifference;
      }

      return (
        new Date(right.announcedAt).getTime() - new Date(left.announcedAt).getTime()
      );
    })[0];
}

export async function buildTrackAvailabilityFromFile(input: {
  roomId: string;
  trackId: string;
  fileHash: string;
  file: Blob;
  peerId: string;
  nickname: string;
  source: "live_upload" | "local_cache";
  chunkSize?: number;
}): Promise<TrackAvailabilityAnnouncement> {
  const chunkSize = input.chunkSize ?? defaultChunkSize;
  const totalChunks = Math.max(1, Math.ceil(input.file.size / chunkSize));
  const chunks = await splitBlobIntoChunks(input.file, chunkSize);

  await cacheTrackPieces(
    await Promise.all(
      chunks.map(async (chunk, chunkIndex) => ({
        pieceId: `${input.trackId}:${input.peerId}:${chunkIndex}`,
        trackId: input.trackId,
        peerId: input.peerId,
        chunkIndex,
        chunkSize: chunk.byteLength,
        hash: await hashArrayBuffer(chunk),
        payload: chunk
      }))
    )
  );

  const availableChunks = chunks.map((_, chunkIndex) => chunkIndex);

  return {
    roomId: input.roomId,
    trackId: input.trackId,
    ownerPeerId: input.peerId,
    nickname: input.nickname,
    totalChunks,
    availableChunks,
    source: input.source,
    announcedAt: new Date().toISOString()
  };
}

export async function hashArrayBuffer(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function validateTrackPiecePayload(payload: ArrayBuffer, expectedHash: string) {
  return (await hashArrayBuffer(payload)) === expectedHash;
}

export async function assembleTrackFileFromPieces(input: {
  pieces: Array<{ chunkIndex: number; payload: ArrayBuffer }>;
  totalChunks: number;
  mimeType: string;
  title: string;
  expectedFileHash: string;
}) {
  const sortedPieces = [...input.pieces].sort((left, right) => left.chunkIndex - right.chunkIndex);

  if (sortedPieces.length < input.totalChunks) {
    return null;
  }

  for (let chunkIndex = 0; chunkIndex < input.totalChunks; chunkIndex += 1) {
    if (sortedPieces[chunkIndex]?.chunkIndex !== chunkIndex) {
      return null;
    }
  }

  const blob = new Blob(sortedPieces.map((piece) => piece.payload), {
    type: input.mimeType || "audio/mpeg"
  });
  const fileBuffer = await blob.arrayBuffer();
  const fileHash = await hashArrayBuffer(fileBuffer);

  if (fileHash !== input.expectedFileHash) {
    return null;
  }

  return {
    blob,
    file: new File([blob], `${input.title}.bin`, {
      type: input.mimeType || "audio/mpeg"
    }),
    fileHash
  };
}

export async function buildTrackAvailabilityFromCache(input: {
  roomId: string;
  trackId: string;
  peerId: string;
  nickname: string;
  totalChunks?: number;
}) {
  const availableChunks = await getCachedPieceIndexes(input.trackId, input.peerId);

  if (availableChunks.length === 0) {
    return null;
  }

  return {
    roomId: input.roomId,
    trackId: input.trackId,
    ownerPeerId: input.peerId,
    nickname: input.nickname,
    totalChunks: input.totalChunks ?? availableChunks.length,
    availableChunks,
    source: "local_cache" as const,
    announcedAt: new Date().toISOString()
  };
}

async function splitBlobIntoChunks(blob: Blob, chunkSize: number) {
  const chunks: ArrayBuffer[] = [];

  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    const nextChunk = blob.slice(offset, offset + chunkSize);
    chunks.push(await nextChunk.arrayBuffer());
  }

  return chunks;
}
