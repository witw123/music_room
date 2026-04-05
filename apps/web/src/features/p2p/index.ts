import {
  iceServerConfigSchema,
  type IceConfigResponse,
  type IceServerConfig,
  type TrackAvailabilityAnnouncement
} from "@music-room/shared";
import {
  cacheTrackPieces,
  getCachedPieceIndexes,
  getTrackPieceManifest,
  upsertTrackPieceManifest
} from "@/lib/indexeddb";
import {
  assembleTrackFileFromPiecesInWorker,
  hashArrayBufferInWorker,
  validateTrackPiecePayloadBatchInWorker,
  validateTrackPiecePayloadInWorker
} from "./piece-processing-client";

export const p2pFeatureBoundary =
  "P2P feature owns peer connectivity, chunk transfer, cache indexing, and source selection.";

export * from "./mesh";
export * from "./media-mesh";
export * from "./chunk-scheduler";
export * from "./diagnostics";
export * from "./transport-health";
export * from "./availability-state";
export * from "./use-peer-diagnostics";
export * from "./use-availability-announcements";

export const defaultChunkSize = 64 * 1024;
export const currentTrackChunkRequestLimit = 24;
export const upcomingTrackChunkRequestLimit = 8;
const piecePersistenceBatchSize = 8;

export function getWebRTCIceServers(config?: IceConfigResponse | null): IceServerConfig[] {
  if (config?.iceServers?.length) {
    return config.iceServers;
  }

  return getStaticWebRTCIceServers();
}

export function getStaticWebRTCIceServers(): IceServerConfig[] {
  const rawJson = process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS;

  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      const result = iceServerConfigSchema.array().safeParse(parsed);
      if (result.success && result.data.length > 0) {
        return result.data;
      }
    } catch {
      // Fallback to simple envs below.
    }
  }

  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL?.trim();
  const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME?.trim();
  const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL?.trim();
  const stunUrl = process.env.NEXT_PUBLIC_STUN_URL?.trim() || "stun:stun.l.google.com:19302";

  const servers: IceServerConfig[] = [{ urls: stunUrl }];
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: turnUsername || undefined,
      credential: turnCredential || undefined
    });
  }

  return servers;
}

export function parseIceConfigResponse(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as Record<string, unknown>;
  const iceServersResult = iceServerConfigSchema.array().safeParse(candidate.iceServers);
  const ttlSeconds = candidate.ttlSeconds;
  const source = candidate.source;

  if (
    !iceServersResult.success ||
    typeof ttlSeconds !== "number" ||
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds <= 0 ||
    (source !== "ephemeral" && source !== "static" && source !== "stun-only")
  ) {
    return null;
  }

  return {
    iceServers: iceServersResult.data,
    ttlSeconds,
    source
  } satisfies IceConfigResponse;
}

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
  mimeType?: string | null;
  codec?: string | null;
  sizeBytes?: number | null;
  durationMs?: number;
  chunkSize?: number;
}): Promise<TrackAvailabilityAnnouncement> {
  const chunkSize = input.chunkSize ?? defaultChunkSize;
  const totalChunks = Math.max(1, Math.ceil(input.file.size / chunkSize));
  const chunks = await splitBlobIntoChunks(input.file, chunkSize);
  const pieces = [];

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    pieces.push({
      pieceId: `${input.trackId}:${input.peerId}:${chunkIndex}`,
      trackId: input.trackId,
      peerId: input.peerId,
      chunkIndex,
      chunkSize: chunk.byteLength,
      hash: await hashArrayBuffer(chunk),
      payload: chunk
    });

    if (pieces.length >= piecePersistenceBatchSize || chunkIndex === chunks.length - 1) {
      await cacheTrackPieces(pieces.splice(0, pieces.length));
      await yieldToMainThread();
    }
  }

  const availableChunks = chunks.map((_, chunkIndex) => chunkIndex);
  const mimeType = input.mimeType || input.file.type || "audio/mpeg";

  await upsertTrackPieceManifest({
    trackId: input.trackId,
    fileHash: input.fileHash,
    mimeType,
    codec: input.codec ?? null,
    sizeBytes: input.sizeBytes ?? input.file.size,
    durationMs: input.durationMs ?? 0,
    totalChunks,
    chunkSize
  });

  return {
    roomId: input.roomId,
    trackId: input.trackId,
    ownerPeerId: input.peerId,
    nickname: input.nickname,
    totalChunks,
    chunkSize,
    availableChunks,
    source: input.source,
    announcedAt: new Date().toISOString()
  };
}

export async function hashArrayBuffer(buffer: ArrayBuffer) {
  const workerResult = await hashArrayBufferInWorker(buffer);
  if (workerResult) {
    return workerResult;
  }

  return hashArrayBufferLocal(buffer);
}

export async function validateTrackPiecePayload(payload: ArrayBuffer, expectedHash: string) {
  const workerResult = await validateTrackPiecePayloadInWorker(payload, expectedHash);
  if (typeof workerResult === "boolean") {
    return workerResult;
  }

  return (await hashArrayBufferLocal(payload)) === expectedHash;
}

export async function validateTrackPiecePayloadBatch(
  pieces: Array<{
    payload: ArrayBuffer;
    expectedHash: string;
  }>
) {
  const workerResult = await validateTrackPiecePayloadBatchInWorker(
    pieces.map((piece) => ({
      buffer: piece.payload,
      expectedHash: piece.expectedHash
    }))
  );

  if (workerResult) {
    return workerResult;
  }

  return Promise.all(
    pieces.map(async (piece) => (await hashArrayBufferLocal(piece.payload)) === piece.expectedHash)
  );
}

export async function assembleTrackFileFromPieces(input: {
  pieces: Array<{ chunkIndex: number; payload: ArrayBuffer }>;
  totalChunks: number;
  mimeType: string;
  title: string;
  expectedFileHash: string;
}) {
  const workerResult = await assembleTrackFileFromPiecesInWorker({
    pieces: input.pieces,
    totalChunks: input.totalChunks,
    mimeType: input.mimeType,
    expectedFileHash: input.expectedFileHash
  });

  if (workerResult) {
    return {
      blob: workerResult.blob,
      file: new File([workerResult.blob], `${input.title}.bin`, {
        type: input.mimeType || "audio/mpeg"
      }),
      fileHash: workerResult.fileHash
    };
  }

  return assembleTrackFileFromPiecesLocal(input);
}

async function hashArrayBufferLocal(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function assembleTrackFileFromPiecesLocal(input: {
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
  await yieldToMainThread();
  const fileBuffer = await blob.arrayBuffer();
  const fileHash = await hashArrayBufferLocal(fileBuffer);

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
  chunkSize?: number;
}) {
  const availableChunks = await getCachedPieceIndexes(input.trackId, input.peerId);

  if (availableChunks.length === 0) {
    return null;
  }

  const manifest = await getTrackPieceManifest(input.trackId);
  const totalChunks = input.totalChunks ?? manifest?.totalChunks ?? availableChunks.length;
  const chunkSize = input.chunkSize ?? manifest?.chunkSize ?? defaultChunkSize;

  return {
    roomId: input.roomId,
    trackId: input.trackId,
    ownerPeerId: input.peerId,
    nickname: input.nickname,
    totalChunks,
    chunkSize,
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
    if (chunks.length % piecePersistenceBatchSize === 0) {
      await yieldToMainThread();
    }
  }

  return chunks;
}

async function yieldToMainThread() {
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}
