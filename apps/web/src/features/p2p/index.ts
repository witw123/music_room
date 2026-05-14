import {
  iceServerConfigSchema,
  type IceConfigResponse,
  type IceServerConfig,
  type TrackAvailabilityAnnouncement,
  type TrackMeta
} from "@music-room/shared";
import {
  cacheTrackPieces,
  getCachedPieceIndexes,
  getTrackPieceManifest,
  localCacheOwnerKey,
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

export type TurnConnectivityResult = {
  reachable: boolean;
  relayCandidates: number;
  srflxCandidates: number;
  hostCandidates: number;
  totalCandidates: number;
  gatherDurationMs: number;
  error?: string;
};

/**
 * Tests whether TURN servers are reachable by creating a temporary
 * RTCPeerConnection with iceTransportPolicy="relay" and checking if any
 * relay candidates can be gathered.
 *
 * This is the definitive browser-side check for TURN availability.
 */
export async function testTurnConnectivity(
  iceServers: IceServerConfig[],
  timeoutMs = 8_000
): Promise<TurnConnectivityResult> {
  const startedAt = performance.now();

  const turnServers: IceServerConfig[] = iceServers.filter((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => url.startsWith("turn:") || url.startsWith("turns:"));
  });

  if (turnServers.length === 0) {
    return {
      reachable: false,
      relayCandidates: 0,
      srflxCandidates: 0,
      hostCandidates: 0,
      totalCandidates: 0,
      gatherDurationMs: 0,
      error: "no-turn-servers-configured"
    };
  }

  const pc = new RTCPeerConnection({
    iceServers: turnServers,
    iceTransportPolicy: "relay"
  });

  const relayCandidates: RTCIceCandidate[] = [];
  const srflxCandidates: RTCIceCandidate[] = [];
  const hostCandidates: RTCIceCandidate[] = [];
  let gatherError: string | undefined;

  try {
    const gatherPromise = new Promise<void>((resolve) => {
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === "complete") {
          resolve();
        }
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }
        if (event.candidate.type === "relay") {
          relayCandidates.push(event.candidate);
        } else if (event.candidate.type === "srflx") {
          srflxCandidates.push(event.candidate);
        } else if (event.candidate.type === "host") {
          hostCandidates.push(event.candidate);
        }
      };
    });

    // Create a data channel to trigger ICE candidate gathering
    pc.createDataChannel("turn-test");

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    });

    await Promise.race([gatherPromise, timeoutPromise]);
  } catch (error) {
    gatherError = error instanceof Error ? error.message : String(error);
  }

  const gatherDurationMs = performance.now() - startedAt;
  pc.close();

  return {
    reachable: relayCandidates.length > 0,
    relayCandidates: relayCandidates.length,
    srflxCandidates: srflxCandidates.length,
    hostCandidates: hostCandidates.length,
    totalCandidates: relayCandidates.length + srflxCandidates.length + hostCandidates.length,
    gatherDurationMs: Math.round(gatherDurationMs),
    error: gatherError
  };
}

export * from "./mesh";
export * from "./chunk-scheduler";
export * from "./diagnostics";
export * from "./transport-health";
export * from "./connection-supervisor";
export * from "./availability-state";
export * from "./use-peer-diagnostics";
export * from "./use-availability-announcements";

export const defaultChunkSize = 128 * 1024;
export const currentTrackChunkRequestLimit = 24;
export const upcomingTrackChunkRequestLimit = 8;
const piecePersistenceBatchSize = 16;

export type ResolvedTrackPieceManifest = {
  totalChunks: number;
  chunkSize: number;
  pieceMimeType: string;
  pieceHashes?: string[];
  source: "cache" | "availability" | "snapshot" | "computed";
};

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
  const canonicalAvailability = selectCanonicalTrackAvailabilityAnnouncement(announcements);
  const totalChunks = canonicalAvailability?.totalChunks ?? local?.totalChunks ?? 0;
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
  totalChunks?: number;
  chunkSize?: number;
  assetKind?: "relay" | "original";
  assetHash?: string;
}): Promise<TrackAvailabilityAnnouncement> {
  const manifest = resolveTrackPieceManifest({
    availability:
      typeof input.totalChunks === "number" && typeof input.chunkSize === "number"
        ? {
            totalChunks: input.totalChunks,
            chunkSize: input.chunkSize
          }
        : null,
    file: input.file,
    mimeType: input.mimeType,
    codec: input.codec,
    sizeBytes: input.sizeBytes ?? input.file.size
  }) ?? {
    totalChunks: Math.max(1, Math.ceil(input.file.size / defaultChunkSize)),
    chunkSize: defaultChunkSize,
    pieceMimeType: input.mimeType || input.file.type || "audio/mpeg",
    source: "computed" as const
  };
  const chunkSize = manifest.chunkSize;
  const totalChunks = manifest.totalChunks;
  const chunks = await splitBlobIntoChunks(input.file, chunkSize);
  const pieces = [];
  const pieceHashes: string[] = [];

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const hash = await hashArrayBuffer(chunk);
    pieceHashes.push(hash);
    pieces.push({
      pieceId: `${input.fileHash}:${chunkSize}:${localCacheOwnerKey}:${chunkIndex}`,
      trackId: input.trackId,
      fileHash: input.fileHash,
      peerId: input.peerId,
      ownerKey: localCacheOwnerKey,
      chunkIndex,
      chunkSize: chunk.byteLength,
      hash,
      payload: chunk
    });

    if (pieces.length >= piecePersistenceBatchSize || chunkIndex === chunks.length - 1) {
      await cacheTrackPieces(pieces.splice(0, pieces.length));
      await yieldToMainThread();
    }
  }

  const availableChunks = chunks.map((_, chunkIndex) => chunkIndex);
  const mimeType = manifest.pieceMimeType;

  await upsertTrackPieceManifest({
    trackId: input.trackId,
    fileHash: input.fileHash,
    mimeType,
    codec: input.codec ?? null,
    sizeBytes: input.sizeBytes ?? input.file.size,
    durationMs: input.durationMs ?? 0,
    totalChunks,
    chunkSize,
    pieceHashes
  });

  return {
    roomId: input.roomId,
    trackId: input.trackId,
    ownerPeerId: input.peerId,
    nickname: input.nickname,
    assetKind: input.assetKind ?? "relay",
    assetHash: input.assetHash ?? input.fileHash,
    totalChunks,
    chunkSize,
    availableChunks,
    pieceHashes,
    source: input.source,
    announcedAt: new Date().toISOString()
  };
}

export function buildTrackAvailabilityFromManifest(input: {
  roomId: string;
  trackId: string;
  fileHash: string;
  peerId: string;
  nickname: string;
  source: "live_upload" | "local_cache";
  track?: TrackMeta | null;
  file?: Blob | null;
  cacheManifest?: {
    totalChunks: number;
    chunkSize: number;
    mimeType?: string | null;
    pieceMimeType?: string | null;
    pieceHashes?: string[] | null;
  } | null;
  mimeType?: string | null;
  codec?: string | null;
  sizeBytes?: number | null;
  durationMs?: number;
  totalChunks?: number;
  chunkSize?: number;
  assetKind?: "relay" | "original";
  assetHash?: string;
}): TrackAvailabilityAnnouncement | null {
  const manifest = resolveTrackPieceManifest({
    track: input.track,
    cacheManifest: input.cacheManifest,
    availability:
      typeof input.totalChunks === "number" && typeof input.chunkSize === "number"
        ? {
            totalChunks: input.totalChunks,
            chunkSize: input.chunkSize
          }
        : null,
    file: input.file,
    mimeType: input.mimeType,
    codec: input.codec,
    sizeBytes: input.sizeBytes ?? input.file?.size ?? null
  });
  if (!manifest) {
    return null;
  }

  return {
    roomId: input.roomId,
    trackId: input.trackId,
    ownerPeerId: input.peerId,
    nickname: input.nickname,
    assetKind: input.assetKind ?? "relay",
    assetHash: input.assetHash ?? input.fileHash,
    totalChunks: manifest.totalChunks,
    chunkSize: manifest.chunkSize,
    availableChunks: Array.from(
      { length: manifest.totalChunks },
      (_, chunkIndex) => chunkIndex
    ),
    pieceHashes: manifest.pieceHashes,
    source: input.source,
    announcedAt: new Date().toISOString()
  };
}

export function resolveCanonicalChunkSize(input: {
  file?: Blob | null;
  codec?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
}) {
  const sizeBytes = input.sizeBytes ?? input.file?.size ?? 0;
  const codec = `${input.codec ?? ""} ${input.mimeType ?? input.file?.type ?? ""}`.toLowerCase();
  const isLargeLossless =
    (codec.includes("flac") || codec.includes("alac") || codec.includes("wav")) &&
    sizeBytes >= 25 * 1024 * 1024;

  if (isLargeLossless) {
    return 256 * 1024;
  }

  return defaultChunkSize;
}

export function buildCanonicalTrackPieceManifest(input: {
  file?: Blob | null;
  codec?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
}): Omit<ResolvedTrackPieceManifest, "source"> {
  const sizeBytes = Math.max(0, input.sizeBytes ?? input.file?.size ?? 0);
  const chunkSize = resolveCanonicalChunkSize(input);
  return {
    totalChunks: Math.max(1, Math.ceil(Math.max(1, sizeBytes) / chunkSize)),
    chunkSize,
    pieceMimeType: input.mimeType || input.file?.type || "audio/mpeg"
  };
}

export function selectCanonicalTrackAvailabilityAnnouncement(
  announcements: TrackAvailabilityAnnouncement[]
) {
  const candidates = announcements.filter(
    (announcement) => announcement.totalChunks > 0 && announcement.chunkSize > 0
  );

  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort((left, right) => {
    const chunkSizeDifference = right.chunkSize - left.chunkSize;
    if (chunkSizeDifference !== 0) {
      return chunkSizeDifference;
    }

    const totalChunkDifference = left.totalChunks - right.totalChunks;
    if (totalChunkDifference !== 0) {
      return totalChunkDifference;
    }

    return new Date(right.announcedAt).getTime() - new Date(left.announcedAt).getTime();
  })[0];
}

export function resolveTrackPieceManifest(input: {
  track?: TrackMeta | null;
  availability?: Pick<TrackAvailabilityAnnouncement, "totalChunks" | "chunkSize"> &
    Partial<Pick<TrackAvailabilityAnnouncement, "pieceHashes">> | null;
  cacheManifest?: {
    totalChunks: number;
    chunkSize: number;
    mimeType?: string | null;
    pieceMimeType?: string | null;
    pieceHashes?: string[] | null;
  } | null;
  file?: Blob | null;
  codec?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
}): ResolvedTrackPieceManifest | null {
  const cacheManifest = input.cacheManifest;
  if (
    cacheManifest &&
    cacheManifest.totalChunks > 0 &&
    cacheManifest.chunkSize > 0
  ) {
    return {
      totalChunks: cacheManifest.totalChunks,
      chunkSize: cacheManifest.chunkSize,
      pieceMimeType:
        cacheManifest.pieceMimeType ??
        cacheManifest.mimeType ??
        input.track?.pieceManifest?.pieceMimeType ??
        input.track?.relayManifest?.pieceMimeType ??
        input.track?.mimeType ??
        input.mimeType ??
        input.file?.type ??
        "audio/mpeg",
      pieceHashes: cacheManifest.pieceHashes ?? undefined,
      source: "cache"
    };
  }

  if (
    input.availability &&
    input.availability.totalChunks > 0 &&
    input.availability.chunkSize > 0
  ) {
    return {
      totalChunks: input.availability.totalChunks,
      chunkSize: input.availability.chunkSize,
      pieceMimeType:
        input.track?.relayManifest?.pieceMimeType ??
        input.track?.pieceManifest?.pieceMimeType ??
        input.track?.mimeType ??
        input.mimeType ??
        input.file?.type ??
        "audio/mpeg",
      pieceHashes: input.availability.pieceHashes,
      source: "availability"
    };
  }

  const snapshotManifest = input.track?.relayManifest ?? input.track?.pieceManifest ?? null;
  if (
    snapshotManifest &&
    snapshotManifest.totalChunks > 0 &&
    snapshotManifest.chunkSize > 0
  ) {
    return {
      totalChunks: snapshotManifest.totalChunks,
      chunkSize: snapshotManifest.chunkSize,
      pieceMimeType:
        snapshotManifest.pieceMimeType ??
        input.track?.mimeType ??
        input.mimeType ??
        input.file?.type ??
        "audio/mpeg",
      source: "snapshot"
    };
  }

  const computed = buildCanonicalTrackPieceManifest({
    file: input.file,
    codec: input.codec ?? input.track?.codec ?? null,
    mimeType: input.mimeType ?? input.track?.mimeType ?? null,
    sizeBytes: input.sizeBytes ?? input.track?.sizeBytes ?? null
  });
  if (computed.totalChunks <= 0 || computed.chunkSize <= 0) {
    return null;
  }

  return {
    ...computed,
    source: "computed"
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
  fileHash?: string;
  peerId: string;
  nickname: string;
  totalChunks?: number;
  chunkSize?: number;
  assetKind?: "relay" | "original";
  assetHash?: string;
}) {
  const availableChunks = await getCachedPieceIndexes(input.trackId, input.peerId, {
    fileHash: input.fileHash,
    ownerKey: localCacheOwnerKey
  });

  if (availableChunks.length === 0) {
    return null;
  }

  const manifest = await getTrackPieceManifest(input.trackId);
  const resolvedManifest = resolveTrackPieceManifest({
    cacheManifest: manifest,
    availability:
      typeof input.totalChunks === "number" && typeof input.chunkSize === "number"
        ? {
            totalChunks: input.totalChunks,
            chunkSize: input.chunkSize
          }
        : null
  });
  const totalChunks = resolvedManifest?.totalChunks ?? availableChunks.length;
  const chunkSize = resolvedManifest?.chunkSize ?? defaultChunkSize;

  return {
    roomId: input.roomId,
    trackId: input.trackId,
    ownerPeerId: input.peerId,
    nickname: input.nickname,
    assetKind: input.assetKind ?? "relay",
    assetHash: input.assetHash ?? manifest?.fileHash ?? input.trackId,
    totalChunks,
    chunkSize,
    availableChunks,
    pieceHashes: resolvedManifest?.pieceHashes,
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
