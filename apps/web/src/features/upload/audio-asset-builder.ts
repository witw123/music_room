"use client";

import {
  buildMerkleTree,
  computeAssetId,
  hashAssetUnit,
  originalAssetManifestSchema,
  playbackEncoderVersion,
  playbackAssetManifestSchema,
  playbackProfileId,
  type AssetUnitDescriptor,
  type OriginalAssetManifest,
  type PlaybackAssetManifest
} from "@music-room/shared";
import { createSHA256 } from "hash-wasm";
import {
  deleteAudioAsset,
  getCompleteAssetPairForSourceFileHash,
  getAssetManifest,
  putAssetManifest,
  putLocallyGeneratedAssetUnits,
  upsertTranscodeJob
} from "@/lib/indexeddb";
import { OpusSegmentEncoder } from "./opus-segment-encoder";
import { persistAudioAssetsToLocalRepository } from "./local-audio-storage";

const originalUnitSize = 1024 * 1024;
const segmentDurationMs = 2_000;
const seekPrerollMs = 80;
const opusSampleRate = 48_000;
const persistenceBatchSize = 8;
export { playbackEncoderVersion, playbackProfileId };
export const maxDecodedPcmBytes = 256 * 1024 * 1024;

export type PreparedAudioAssets = {
  fileHash: string;
  originalAsset: OriginalAssetManifest;
  playbackAsset: PlaybackAssetManifest;
};

export type AssetPreparationProgress = {
  stage:
    | "inspecting"
    | "hashing"
    | "persisting-original"
    | "decoding"
    | "encoding"
    | "persisting-playback";
  completed: number;
  total: number;
};

class AudioDecodeMemoryLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioDecodeMemoryLimitError";
  }
}

export function resolveSupportedUploadFormat(file: Pick<File, "name" | "type">) {
  const signature = `${file.type} ${file.name}`.trim().toLowerCase();
  if (signature.includes("flac") || signature.endsWith(".flac")) {
    return "flac" as const;
  }
  if (signature.includes("wav") || signature.includes("wave") || signature.endsWith(".wav")) {
    return "wav" as const;
  }
  if (
    signature.includes("audio/mpeg") ||
    signature.includes("audio/mp3") ||
    signature.endsWith(".mp3")
  ) {
    return "mp3" as const;
  }
  return null;
}

export async function prepareAudioAssets(input: {
  file: File;
  signal?: AbortSignal;
  onProgress?: (progress: AssetPreparationProgress) => void;
}): Promise<PreparedAudioAssets> {
  if (!resolveSupportedUploadFormat(input.file)) {
    throw new Error("仅支持 FLAC、WAV 和 MP3 音频文件。");
  }
  if (input.file.size <= 0) {
    throw new Error("音频文件为空。");
  }

  await assertFileFitsDecodeMemoryBudget(input.file, input.onProgress);
  const sourcePromise = prepareOriginalAsset(input);
  const playbackPromise = preparePlaybackAsset({
    ...input,
    fileHash: sourcePromise.then((source) => source.fileHash)
  });
  void playbackPromise.catch(() => undefined);
  const source = await sourcePromise;
  await upsertTranscodeJob({
    sourceFileHash: source.fileHash,
    kind: "playback-transcode",
    profileId: playbackProfileId,
    status: "running",
    progress: 0,
    errorMessage: null
  });

  try {
    const playback = await playbackPromise;
    const preexistingAssetIds = new Set(
      (
        await Promise.all([
          getAssetManifest(source.originalAsset.assetId),
          getAssetManifest(playback.playbackAsset.assetId)
        ])
      )
        .filter((record) => !!record)
        .map((record) => record.assetId)
    );
    const createdAssetIds = [source.originalAsset.assetId, playback.playbackAsset.assetId]
      .filter((assetId) => !preexistingAssetIds.has(assetId));
    try {
      const [existingOriginal, existingPlayback] = await Promise.all([
        getAssetManifest(source.originalAsset.assetId),
        getAssetManifest(playback.playbackAsset.assetId)
      ]);
      if (!existingOriginal?.complete) {
        await persistOriginalAsset(input, source);
      }
      if (!existingPlayback?.complete) {
        await persistPlaybackAsset(input, playback);
      }
      await persistAudioAssetsToLocalRepository({
        file: input.file,
        originalAsset: source.originalAsset,
        playbackAsset: playback.playbackAsset
      });
    } catch (error) {
      await Promise.allSettled(createdAssetIds.map((assetId) => deleteAudioAsset(assetId)));
      throw error;
    }
    await upsertTranscodeJob({
      sourceFileHash: source.fileHash,
      kind: "playback-transcode",
      profileId: playbackProfileId,
      status: "completed",
      progress: 1,
      errorMessage: null
    });
    return {
      fileHash: source.fileHash,
      originalAsset: source.originalAsset,
      playbackAsset: playback.playbackAsset
    };
  } catch (error) {
    await upsertTranscodeJob({
      sourceFileHash: source.fileHash,
      kind: "playback-transcode",
      profileId: playbackProfileId,
      status: "failed",
      progress: 0,
      errorMessage: error instanceof Error ? error.message : "音频转码失败。"
    });
    throw error;
  }
}

export async function getReusableAudioAssets(input: {
  fileHash: string;
  sizeBytes?: number;
  durationMs?: number;
}): Promise<PreparedAudioAssets | null> {
  const pair = await getCompleteAssetPairForSourceFileHash(input.fileHash);
  if (!pair) return null;

  const originalAsset = pair.original.manifest;
  const playbackAsset = pair.playback.manifest;
  if (
    originalAsset.kind !== "original" ||
    playbackAsset.kind !== "playback" ||
    originalAsset.fileHash !== input.fileHash ||
    playbackAsset.sourceFileHash !== input.fileHash ||
    (input.sizeBytes !== undefined && input.sizeBytes > 0 && originalAsset.sizeBytes !== input.sizeBytes) ||
    (input.durationMs !== undefined && input.durationMs > 0 && playbackAsset.durationMs !== input.durationMs)
  ) {
    return null;
  }

  return {
    fileHash: input.fileHash,
    originalAsset,
    playbackAsset
  };
}

async function prepareOriginalAsset(input: {
  file: File;
  signal?: AbortSignal;
  onProgress?: (progress: AssetPreparationProgress) => void;
}) {
  const unitCount = Math.ceil(input.file.size / originalUnitSize);
  const fileHasher = await createSHA256();
  fileHasher.init();
  const leafHashes: string[] = [];

  for (let unitIndex = 0; unitIndex < unitCount; unitIndex += 1) {
    throwIfAborted(input.signal);
    const payload = await readFileUnit(input.file, unitIndex);
    const bytes = new Uint8Array(payload);
    fileHasher.update(bytes);
    leafHashes.push(await hashAssetUnit(unitIndex, bytes));
    input.onProgress?.({ stage: "hashing", completed: unitIndex + 1, total: unitCount });
  }

  const fileHash = fileHasher.digest("hex");
  const tree = await buildMerkleTree(leafHashes);
  const manifestWithoutId = {
    kind: "original" as const,
    fileHash,
    mimeType: input.file.type || mimeTypeFromFileName(input.file.name),
    sizeBytes: input.file.size,
    unitSize: originalUnitSize as 1048576,
    unitCount,
    merkleRoot: tree.root
  };
  const originalAsset = originalAssetManifestSchema.parse({
    ...manifestWithoutId,
    assetId: await computeAssetId(manifestWithoutId)
  });
  return { fileHash, originalAsset, leafHashes, proofs: tree.proofs };
}

async function preparePlaybackAsset(input: {
  file: File;
  fileHash: string | Promise<string>;
  signal?: AbortSignal;
  onProgress?: (progress: AssetPreparationProgress) => void;
}) {
  throwIfAborted(input.signal);
  input.onProgress?.({ stage: "decoding", completed: 0, total: 1 });
  const audioBuffer = await decodeAudioFile(input.file);
  input.onProgress?.({ stage: "decoding", completed: 1, total: 1 });
  return await encodePlaybackAsset(input, audioBuffer);
}

async function encodePlaybackAsset(
  input: {
    fileHash: string | Promise<string>;
    signal?: AbortSignal;
    onProgress?: (progress: AssetPreparationProgress) => void;
  },
  audioBuffer: Pick<
    AudioBuffer,
    "duration" | "sampleRate" | "numberOfChannels" | "length" | "getChannelData"
  >
) {
  if (audioBuffer.numberOfChannels < 1 || audioBuffer.numberOfChannels > 2) {
    throw new Error("仅支持单声道或双声道音频。");
  }
  assertDecodedPcmWithinMemoryBudget({
    durationSeconds: audioBuffer.duration,
    channels: audioBuffer.numberOfChannels
  });

  const channels = audioBuffer.numberOfChannels as 1 | 2;
  const bitrate = channels === 1 ? 96_000 as const : 192_000 as const;
  const durationMs = Math.max(1, Math.round(audioBuffer.duration * 1000));
  const sourceSampleRate = audioBuffer.sampleRate;
  const unitCount = Math.ceil(durationMs / segmentDurationMs);
  const encodedUnits: Array<{
    payload: ArrayBuffer;
    descriptor: Omit<AssetUnitDescriptor, "assetId" | "contentHash" | "proof">;
  } | undefined> = new Array(unitCount);
  const leafHashes: Array<string | undefined> = new Array(unitCount);
  const concurrency = resolveEncodingConcurrency(unitCount);
  const encoders = Array.from({ length: concurrency }, () => new OpusSegmentEncoder());
  let nextUnitIndex = 0;
  let completedUnits = 0;

  try {
    await Promise.all(encoders.map(async (encoder) => {
      while (true) {
        const unitIndex = nextUnitIndex++;
        if (unitIndex >= unitCount) return;
        throwIfAborted(input.signal);
        const segment = slicePcmSegment(audioBuffer, unitIndex);
        const payload = await encoder.encode({
          sampleRate: sourceSampleRate,
          channels: segment.channels,
          bitrateKbps: channels === 1 ? 96 : 192
        });
        const contentHash = await hashAssetUnit(unitIndex, payload);
        leafHashes[unitIndex] = contentHash;
        encodedUnits[unitIndex] = {
          payload,
          descriptor: {
            kind: "playback",
            unitIndex,
            payloadBytes: payload.byteLength,
            startMs: unitIndex * segmentDurationMs,
            durationMs: Math.min(segmentDurationMs, durationMs - unitIndex * segmentDurationMs),
            trimStartSamples: segment.trimStartSamples,
            trimEndSamples: 0
          }
        };
        completedUnits += 1;
        input.onProgress?.({ stage: "encoding", completed: completedUnits, total: unitCount });
      }
    }));
  } finally {
    encoders.forEach((encoder) => encoder.dispose());
  }

  const completeLeafHashes = leafHashes.map((hash) => {
    if (!hash) throw new Error("Playback encoding did not produce every segment hash.");
    return hash;
  });
  const completeEncodedUnits = encodedUnits.map((unit) => {
    if (!unit) throw new Error("Playback encoding did not produce every segment.");
    return unit;
  });
  const tree = await buildMerkleTree(completeLeafHashes);
  const fileHash = await input.fileHash;
  const manifestWithoutId = {
    kind: "playback" as const,
    sourceFileHash: fileHash,
    profileId: playbackProfileId,
    codec: "opus" as const,
    container: "audio/ogg" as const,
    sampleRate: opusSampleRate as 48000,
    channels,
    bitrate,
    durationMs,
    segmentDurationMs: segmentDurationMs as 2000,
    seekPrerollMs: seekPrerollMs as 80,
    unitCount,
    merkleRoot: tree.root,
    encoder: { name: "@audio/opus-encode" as const, version: playbackEncoderVersion }
  };
  const playbackAsset = playbackAssetManifestSchema.parse({
    ...manifestWithoutId,
    assetId: await computeAssetId(manifestWithoutId)
  });
  return {
    playbackAsset,
    encodedUnits: completeEncodedUnits,
    leafHashes: completeLeafHashes,
    proofs: tree.proofs
  };
}

async function persistOriginalAsset(
  input: {
    file: File;
    signal?: AbortSignal;
    onProgress?: (progress: AssetPreparationProgress) => void;
  },
  source: Awaited<ReturnType<typeof prepareOriginalAsset>>
) {
  await putAssetManifest(source.originalAsset);
  for (let batchStart = 0; batchStart < source.originalAsset.unitCount; batchStart += persistenceBatchSize) {
    const batchEnd = Math.min(source.originalAsset.unitCount, batchStart + persistenceBatchSize);
    const units = await Promise.all(
      Array.from({ length: batchEnd - batchStart }, async (_, offset) => {
        const unitIndex = batchStart + offset;
        throwIfAborted(input.signal);
        const payload = await readFileUnit(input.file, unitIndex);
        return {
          descriptor: {
            assetId: source.originalAsset.assetId,
            kind: "original" as const,
            unitIndex,
            payloadBytes: payload.byteLength,
            contentHash: source.leafHashes[unitIndex]!,
            proof: source.proofs[unitIndex]!
          },
          payload
        };
      })
    );
    await putLocallyGeneratedAssetUnits({
      assetId: source.originalAsset.assetId,
      units,
      complete: batchEnd === source.originalAsset.unitCount
    });
    input.onProgress?.({
      stage: "persisting-original",
      completed: batchEnd,
      total: source.originalAsset.unitCount
    });
  }
}

async function persistPlaybackAsset(
  input: {
    signal?: AbortSignal;
    onProgress?: (progress: AssetPreparationProgress) => void;
  },
  playback: Awaited<ReturnType<typeof preparePlaybackAsset>>
) {
  await putAssetManifest(playback.playbackAsset);
  const units = playback.encodedUnits.map((unit, unitIndex) => {
    throwIfAborted(input.signal);
    return {
      descriptor: {
        ...unit.descriptor,
        assetId: playback.playbackAsset.assetId,
        contentHash: playback.leafHashes[unitIndex]!,
        proof: playback.proofs[unitIndex]!
      },
      payload: unit.payload
    };
  });
  await putLocallyGeneratedAssetUnits({
    assetId: playback.playbackAsset.assetId,
    units,
    complete: true
  });
  for (let unitIndex = 0; unitIndex < playback.encodedUnits.length; unitIndex += 1) {
    input.onProgress?.({
      stage: "persisting-playback",
      completed: unitIndex + 1,
      total: playback.encodedUnits.length
    });
  }
}

export function resolveEncodingConcurrency(unitCount: number, hardwareConcurrency =
  typeof navigator === "undefined" ? 2 : navigator.hardwareConcurrency) {
  if (!Number.isFinite(unitCount) || unitCount <= 0) return 1;
  const availableWorkers = Number.isFinite(hardwareConcurrency)
    ? Math.max(1, Math.floor(hardwareConcurrency) - 1)
    : 2;
  return Math.min(unitCount, 4, availableWorkers);
}

async function assertFileFitsDecodeMemoryBudget(
  file: File,
  onProgress?: (progress: AssetPreparationProgress) => void
) {
  onProgress?.({ stage: "inspecting", completed: 0, total: 1 });
  try {
    const { parseBlob } = await import("music-metadata");
    const metadata = await parseBlob(file, { duration: true, skipCovers: true });
    const durationSeconds = metadata.format.duration;
    const channels = metadata.format.numberOfChannels;
    if (
      typeof durationSeconds === "number" &&
      Number.isFinite(durationSeconds) &&
      typeof channels === "number" &&
      Number.isFinite(channels)
    ) {
      assertDecodedPcmWithinMemoryBudget({ durationSeconds, channels });
    }
  } catch (error) {
    if (error instanceof AudioDecodeMemoryLimitError) {
      throw error;
    }
    // The browser decoder remains authoritative when container metadata is incomplete.
  } finally {
    onProgress?.({ stage: "inspecting", completed: 1, total: 1 });
  }
}

export function estimateDecodedPcmBytes(input: {
  durationSeconds: number;
  channels: number;
}) {
  if (
    !Number.isFinite(input.durationSeconds) ||
    input.durationSeconds <= 0 ||
    !Number.isFinite(input.channels) ||
    input.channels <= 0
  ) {
    return 0;
  }
  return Math.ceil(input.durationSeconds * opusSampleRate * Math.ceil(input.channels) * 4);
}

export function assertDecodedPcmWithinMemoryBudget(input: {
  durationSeconds: number;
  channels: number;
}) {
  const estimatedBytes = estimateDecodedPcmBytes(input);
  if (estimatedBytes > maxDecodedPcmBytes) {
    throw new AudioDecodeMemoryLimitError(
      "音频过长，预计解码内存超过 256 MB，请先切分音频再上传。"
    );
  }
}

export function slicePcmSegment(
  audioBuffer: Pick<AudioBuffer, "duration" | "sampleRate" | "numberOfChannels" | "length" | "getChannelData">,
  unitIndex: number
) {
  const segmentSamples = Math.round((segmentDurationMs / 1000) * audioBuffer.sampleRate);
  const prerollSamples = Math.round((seekPrerollMs / 1000) * audioBuffer.sampleRate);
  const contentStart = unitIndex * segmentSamples;
  const start = Math.max(0, contentStart - prerollSamples);
  const end = Math.min(audioBuffer.length, contentStart + segmentSamples);
  const sourceChannels = Array.from({ length: audioBuffer.numberOfChannels }, (_, channelIndex) =>
    audioBuffer.getChannelData(channelIndex).slice(start, end)
  );
  const leadingPaddingSamples = unitIndex === 0 ? prerollSamples : 0;
  return {
    channels: sourceChannels.map((channel) => {
      if (leadingPaddingSamples === 0) {
        return channel;
      }
      const padded = new Float32Array(leadingPaddingSamples + channel.length);
      padded.set(channel, leadingPaddingSamples);
      return padded;
    }),
    // The encoder writes the same 80ms as OpusHead pre-skip. Keep the source
    // overlap in the encoded input so the decoder can discard it, while the
    // published timeline remains exactly one 2s segment per unit.
    trimStartSamples: 0
  };
}

async function readFileUnit(file: File, unitIndex: number) {
  return file.slice(
    unitIndex * originalUnitSize,
    Math.min(file.size, (unitIndex + 1) * originalUnitSize)
  ).arrayBuffer();
}

async function decodeAudioFile(file: File) {
  const context = new AudioContext({ sampleRate: opusSampleRate });
  try {
    return await context.decodeAudioData(await file.arrayBuffer());
  } finally {
    await context.close().catch(() => undefined);
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Audio asset preparation was cancelled.", "AbortError");
  }
}

function mimeTypeFromFileName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".wav")) return "audio/wav";
  return "audio/mpeg";
}
