"use client";

import {
  buildMerkleTree,
  computeAssetId,
  hashAssetUnit,
  originalAssetManifestSchema,
  playbackAssetManifestSchema,
  type AssetUnitDescriptor,
  type OriginalAssetManifest,
  type PlaybackAssetManifest
} from "@music-room/shared";
import { createSHA256 } from "hash-wasm";
import {
  putAssetManifest,
  putVerifiedAssetUnit,
  upsertTranscodeJob
} from "@/lib/indexeddb";
import { OpusSegmentEncoder } from "./opus-segment-encoder";

const originalUnitSize = 1024 * 1024;
const segmentDurationMs = 2_000;
const seekPrerollMs = 80;
const opusSampleRate = 48_000;

export type PreparedAudioAssets = {
  fileHash: string;
  originalAsset: OriginalAssetManifest;
  playbackAsset: PlaybackAssetManifest;
};

export type AssetPreparationProgress = {
  stage: "hashing" | "persisting-original" | "decoding" | "encoding" | "persisting-playback";
  completed: number;
  total: number;
};

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

  const source = await prepareOriginalAsset(input);
  await upsertTranscodeJob({
    sourceFileHash: source.fileHash,
    kind: "playback-transcode",
    profileId: "opus-music-v1",
    status: "running",
    progress: 0,
    errorMessage: null
  });

  try {
    const playbackAsset = await preparePlaybackAsset({
      ...input,
      fileHash: source.fileHash
    });
    await upsertTranscodeJob({
      sourceFileHash: source.fileHash,
      kind: "playback-transcode",
      profileId: "opus-music-v1",
      status: "completed",
      progress: 1,
      errorMessage: null
    });
    return { ...source, playbackAsset };
  } catch (error) {
    await upsertTranscodeJob({
      sourceFileHash: source.fileHash,
      kind: "playback-transcode",
      profileId: "opus-music-v1",
      status: "failed",
      progress: 0,
      errorMessage: error instanceof Error ? error.message : "音频转码失败。"
    });
    throw error;
  }
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
  await putAssetManifest(originalAsset);

  for (let unitIndex = 0; unitIndex < unitCount; unitIndex += 1) {
    throwIfAborted(input.signal);
    const payload = await readFileUnit(input.file, unitIndex);
    await putVerifiedAssetUnit({
      descriptor: {
        assetId: originalAsset.assetId,
        kind: "original",
        unitIndex,
        payloadBytes: payload.byteLength,
        contentHash: leafHashes[unitIndex]!,
        proof: tree.proofs[unitIndex]!
      },
      payload
    });
    input.onProgress?.({ stage: "persisting-original", completed: unitIndex + 1, total: unitCount });
  }

  return { fileHash, originalAsset };
}

async function preparePlaybackAsset(input: {
  file: File;
  fileHash: string;
  signal?: AbortSignal;
  onProgress?: (progress: AssetPreparationProgress) => void;
}) {
  throwIfAborted(input.signal);
  input.onProgress?.({ stage: "decoding", completed: 0, total: 1 });
  const audioBuffer = await decodeAudioFile(input.file);
  input.onProgress?.({ stage: "decoding", completed: 1, total: 1 });
  if (audioBuffer.numberOfChannels < 1 || audioBuffer.numberOfChannels > 2) {
    throw new Error("仅支持单声道或双声道音频。");
  }

  const channels = audioBuffer.numberOfChannels as 1 | 2;
  const bitrate = channels === 1 ? 96_000 as const : 192_000 as const;
  const durationMs = Math.max(1, Math.round(audioBuffer.duration * 1000));
  const unitCount = Math.ceil(durationMs / segmentDurationMs);
  const encoder = new OpusSegmentEncoder();
  const encodedUnits: Array<{
    payload: ArrayBuffer;
    descriptor: Omit<AssetUnitDescriptor, "assetId" | "contentHash" | "proof">;
  }> = [];
  const leafHashes: string[] = [];

  try {
    for (let unitIndex = 0; unitIndex < unitCount; unitIndex += 1) {
      throwIfAborted(input.signal);
      const segment = slicePcmSegment(audioBuffer, unitIndex);
      const payload = await encoder.encode({
        sampleRate: audioBuffer.sampleRate,
        channels: segment.channels,
        bitrateKbps: channels === 1 ? 96 : 192
      });
      const contentHash = await hashAssetUnit(unitIndex, payload);
      leafHashes.push(contentHash);
      encodedUnits.push({
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
      });
      input.onProgress?.({ stage: "encoding", completed: unitIndex + 1, total: unitCount });
    }
  } finally {
    encoder.dispose();
  }

  const tree = await buildMerkleTree(leafHashes);
  const manifestWithoutId = {
    kind: "playback" as const,
    sourceFileHash: input.fileHash,
    profileId: "opus-music-v1" as const,
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
    encoder: { name: "@audio/opus-encode" as const, version: "1.0.0" as const }
  };
  const playbackAsset = playbackAssetManifestSchema.parse({
    ...manifestWithoutId,
    assetId: await computeAssetId(manifestWithoutId)
  });
  await putAssetManifest(playbackAsset);

  for (let unitIndex = 0; unitIndex < encodedUnits.length; unitIndex += 1) {
    throwIfAborted(input.signal);
    const unit = encodedUnits[unitIndex]!;
    await putVerifiedAssetUnit({
      descriptor: {
        ...unit.descriptor,
        assetId: playbackAsset.assetId,
        contentHash: leafHashes[unitIndex]!,
        proof: tree.proofs[unitIndex]!
      },
      payload: unit.payload
    });
    input.onProgress?.({ stage: "persisting-playback", completed: unitIndex + 1, total: encodedUnits.length });
  }
  return playbackAsset;
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
  return {
    channels: Array.from({ length: audioBuffer.numberOfChannels }, (_, channelIndex) =>
      audioBuffer.getChannelData(channelIndex).slice(start, end)
    ),
    trimStartSamples: unitIndex === 0
      ? 0
      : Math.round(((contentStart - start) / audioBuffer.sampleRate) * opusSampleRate)
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
