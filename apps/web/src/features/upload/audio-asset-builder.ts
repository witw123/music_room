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
import {
  extractFlacPackets,
  parseFlacStreamInfo,
  type FlacFramePacket,
  type FlacStreamInfo
} from "@/features/audio-codecs/flac-parser";
import {
  parseWavHeader,
  resolveWavByteRangeForSamples,
  type WavHeader
} from "@/features/playback/codecs/wav-parser";
import {
  parseMp3FrameHeader,
  skipMp3Id3v2
} from "@/features/playback/codecs/mp3-frame-index";
import { OpusSegmentEncoder } from "./opus-segment-encoder";

const originalUnitSize = 1024 * 1024;
const segmentDurationMs = 2_000;
const seekPrerollMs = 80;
const opusSampleRate = 48_000;
const wavHeaderProbeBytes = 1024 * 1024;
const compressedDecodeWindowBytes = 4 * 1024 * 1024;
const compressedDecodeBatchFrames = 192;
export { playbackEncoderVersion, playbackProfileId };

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
          getAssetManifest(source.originalAsset.assetId, { includeLocalRepository: false }),
          getAssetManifest(playback.playbackAsset.assetId, { includeLocalRepository: false })
        ])
      )
        .filter((record) => !!record)
        .map((record) => record.assetId)
    );
    const createdAssetIds = [source.originalAsset.assetId, playback.playbackAsset.assetId]
      .filter((assetId) => !preexistingAssetIds.has(assetId));
    try {
      await putAssetManifest(source.originalAsset, { complete: true });
      input.onProgress?.({
        stage: "persisting-original",
        completed: source.originalAsset.unitCount,
        total: source.originalAsset.unitCount
      });
      await putAssetManifest(playback.playbackAsset);
      await putLocallyGeneratedAssetUnits({
        assetId: playback.playbackAsset.assetId,
        units: playback.encodedUnits.map((unit, unitIndex) => ({
          descriptor: {
            ...unit.descriptor,
            assetId: playback.playbackAsset.assetId,
            contentHash: playback.leafHashes[unitIndex]!,
            proof: playback.proofs[unitIndex]!
          },
          payload: unit.payload
        })),
        complete: true
      });
      for (let unitIndex = 0; unitIndex < playback.encodedUnits.length; unitIndex += 1) {
        input.onProgress?.({
          stage: "persisting-playback",
          completed: unitIndex + 1,
          total: playback.encodedUnits.length
        });
      }
    } catch (error) {
      await Promise.allSettled([
        ...createdAssetIds.map((assetId) => deleteAudioAsset(assetId)),
      ]);
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
}): Promise<PreparedAudioAssets | null> {
  let pair = await getCompleteAssetPairForSourceFileHash(input.fileHash);
  if (!pair) return null;

  const originalAsset = pair.original.manifest;
  const playbackAsset = pair.playback.manifest;
  if (
    originalAsset.kind !== "original" ||
    playbackAsset.kind !== "playback" ||
    originalAsset.fileHash !== input.fileHash ||
    playbackAsset.sourceFileHash !== input.fileHash ||
    (input.sizeBytes !== undefined && input.sizeBytes > 0 && originalAsset.sizeBytes !== input.sizeBytes)
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
  const wavSource = resolveSupportedUploadFormat(input.file) === "wav"
    ? await resolveWavPlaybackSource(input.file)
    : null;
  const compressedSource = wavSource
    ? null
    : await resolveCompressedPlaybackSource(input.file);
  const audioBuffer = wavSource || compressedSource ? null : await decodeAudioFile(input.file);
  input.onProgress?.({ stage: "decoding", completed: 1, total: 1 });
  if (!wavSource && !compressedSource && audioBuffer && (audioBuffer.numberOfChannels < 1 || audioBuffer.numberOfChannels > 2)) {
    throw new Error("仅支持单声道或双声道音频。");
  }
  if (!wavSource && !compressedSource && !audioBuffer) {
    throw new Error("音频解码失败。");
  }

  const channels = (wavSource?.channels ?? compressedSource?.channels ?? audioBuffer!.numberOfChannels) as 1 | 2;
  const bitrate = channels === 1 ? 96_000 as const : 192_000 as const;
  const durationMs = wavSource?.durationMs ?? compressedSource?.durationMs ?? Math.max(1, Math.round(audioBuffer!.duration * 1000));
  const sourceSampleRate = wavSource?.sampleRate ?? compressedSource?.sampleRate ?? audioBuffer!.sampleRate;
  const unitCount = Math.ceil(durationMs / segmentDurationMs);
  const encodedUnits: Array<{
    payload: ArrayBuffer;
    descriptor: Omit<AssetUnitDescriptor, "assetId" | "contentHash" | "proof">;
  } | undefined> = new Array(unitCount);
  const leafHashes: Array<string | undefined> = new Array(unitCount);
  const concurrency = compressedSource ? 1 : resolveEncodingConcurrency(unitCount);
  const encoders = Array.from({ length: concurrency }, () => new OpusSegmentEncoder());
  let nextUnitIndex = 0;
  let completedUnits = 0;

  try {
    await Promise.all(encoders.map(async (encoder) => {
      while (true) {
        const unitIndex = nextUnitIndex++;
        if (unitIndex >= unitCount) return;
        throwIfAborted(input.signal);
        const segment = wavSource
          ? await wavSource.getSegment(unitIndex)
          : compressedSource
            ? await compressedSource.getSegment(unitIndex)
            : slicePcmSegment(audioBuffer!, unitIndex);
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
    await compressedSource?.dispose();
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

export function resolveEncodingConcurrency(unitCount: number, hardwareConcurrency =
  typeof navigator === "undefined" ? 2 : navigator.hardwareConcurrency) {
  if (!Number.isFinite(unitCount) || unitCount <= 0) return 1;
  const availableWorkers = Number.isFinite(hardwareConcurrency)
    ? Math.max(1, Math.floor(hardwareConcurrency) - 1)
    : 2;
  return Math.min(unitCount, 4, availableWorkers);
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

type EncodablePlaybackSegment = {
  channels: Float32Array[];
  trimStartSamples: number;
};

type CompressedPlaybackSource = {
  channels: 1 | 2;
  sampleRate: 48_000;
  durationMs: number;
  getSegment: (unitIndex: number) => Promise<EncodablePlaybackSegment>;
  dispose: () => Promise<void>;
};

type EncodedAudioChunkLike = {
  new (init: {
    type: "key" | "delta";
    timestamp: number;
    duration?: number;
    data: Uint8Array;
  }): unknown;
};

type StreamingAudioDecoder = {
  configure: (config: unknown) => void;
  decode: (chunk: unknown) => void;
  flush: () => Promise<void>;
  close: () => void;
};

type StreamingAudioDecoderConstructor = {
  new (init: {
    output: (audioData: unknown) => void;
    error: (error: unknown) => void;
  }): StreamingAudioDecoder;
  isConfigSupported?: (config: unknown) => Promise<{ supported?: boolean }>;
};

type CompressedFrame = FlacFramePacket;

class StreamingCompressedPlaybackSource implements CompressedPlaybackSource {
  private readonly targetSegmentSamples = Math.round((segmentDurationMs / 1000) * opusSampleRate);
  private readonly prerollSamples = Math.round((seekPrerollMs / 1000) * opusSampleRate);
  private readonly pcm: PcmAccumulator;
  private readonly decoder: StreamingAudioDecoder;
  private readonly encodedChunkConstructor: EncodedAudioChunkLike;
  private readonly frameReader: CompressedFrameReader;
  private decodeError: Error | null = null;
  private pcmAppendPromise: Promise<void> = Promise.resolve();
  private eof = false;
  private lastUnitIndex = -1;
  private disposed = false;
  private operation: Promise<unknown> = Promise.resolve();

  constructor(
    public readonly channels: 1 | 2,
    private readonly sourceSampleRate: number,
    public readonly durationMs: number,
    frameReader: CompressedFrameReader,
    decoder: StreamingAudioDecoder,
    encodedChunkConstructor: EncodedAudioChunkLike
  ) {
    this.frameReader = frameReader;
    this.decoder = decoder;
    this.encodedChunkConstructor = encodedChunkConstructor;
    this.pcm = new PcmAccumulator(channels);
  }

  get sampleRate(): 48_000 {
    return opusSampleRate;
  }

  getSegment(unitIndex: number) {
    const run = this.operation.then(() => this.readSegment(unitIndex));
    this.operation = run.catch(() => undefined);
    return run;
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.decoder.close();
    } catch {
      // Decoder may already be closed after a fatal codec error.
    }
    await this.frameReader.dispose?.();
  }

  private async readSegment(unitIndex: number): Promise<EncodablePlaybackSegment> {
    if (this.disposed) throw new Error("音频转码已取消。");
    if (unitIndex !== this.lastUnitIndex + 1) {
      throw new Error("压缩音频转码必须按顺序读取播放片段。");
    }

    const contentStart = unitIndex * this.targetSegmentSamples;
    const contentEnd = Math.min(
      Math.ceil((this.durationMs / 1000) * opusSampleRate),
      contentStart + this.targetSegmentSamples
    );
    const desiredStart = Math.max(0, contentStart - this.prerollSamples);
    await this.decodeUntil(contentEnd);
    if (this.pcm.endSample < contentEnd) {
      throw this.decodeError ?? new Error("压缩音频解码提前结束。");
    }

    const channels = this.pcm.slice(desiredStart, contentEnd);
    const leadingPaddingSamples = unitIndex === 0 ? this.prerollSamples : 0;
    const output = leadingPaddingSamples > 0
      ? channels.map((channel) => {
          const padded = new Float32Array(leadingPaddingSamples + channel.length);
          padded.set(channel, leadingPaddingSamples);
          return padded;
        })
      : channels;

    this.lastUnitIndex = unitIndex;
    this.pcm.trimBefore(Math.max(0, contentEnd - this.prerollSamples));
    return { channels: output, trimStartSamples: 0 };
  }

  private async decodeUntil(targetSample: number) {
    while (this.pcm.endSample < targetSample && !this.eof) {
      const frames = await this.frameReader.readFrames(compressedDecodeBatchFrames);
      if (frames.length === 0) {
        this.eof = true;
        await this.decoder.flush();
        await this.pcmAppendPromise;
        break;
      }

      for (const frame of frames) {
        try {
          this.decoder.decode(new this.encodedChunkConstructor({
            type: "key",
            timestamp: frame.timestampUs,
            duration: frame.durationUs,
            data: frame.data
          }));
        } catch (error) {
          this.decodeError = error instanceof Error ? error : new Error("压缩音频解码失败。");
          throw this.decodeError;
        }
      }
      await this.decoder.flush();
      await this.pcmAppendPromise;
      if (this.decodeError) throw this.decodeError;
    }
  }

  appendDecoded(audioData: unknown) {
    const data = audioData as {
      numberOfChannels?: number;
      numberOfFrames?: number;
      sampleRate?: number;
      copyTo?: (destination: Float32Array, options: { planeIndex: number; format?: string }) => void;
      close?: () => void;
    };
    const numberOfChannels = Math.min(this.channels, Math.max(1, Math.floor(data.numberOfChannels ?? this.channels)));
    const numberOfFrames = Math.max(0, Math.floor(data.numberOfFrames ?? 0));
    const sampleRate = Number.isFinite(data.sampleRate) ? Number(data.sampleRate) : this.sourceSampleRate;
    if (!data.copyTo || numberOfFrames <= 0) {
      data.close?.();
      return;
    }

    const channels = Array.from({ length: numberOfChannels }, (_, planeIndex) => {
      const channel = new Float32Array(numberOfFrames);
      try {
        data.copyTo!(channel, { planeIndex, format: "f32-planar" });
      } catch {
        data.copyTo!(channel, { planeIndex });
      }
      return channel;
    });
    data.close?.();
    this.pcmAppendPromise = this.pcmAppendPromise.then(() =>
      this.appendNormalizedChannels(channels, sampleRate)
    );
  }

  setDecoderError(error: unknown) {
    this.decodeError = error instanceof Error ? error : new Error("压缩音频解码失败。");
  }

  private async appendNormalizedChannels(channels: Float32Array[], sampleRate: number) {
    if (sampleRate === opusSampleRate) {
      this.pcm.append(channels);
      return;
    }
    const { resample } = await import("wave-resampler");
    this.pcm.append(channels.map((channel) => Float32Array.from(resample(
      channel,
      sampleRate,
      opusSampleRate,
      { method: "sinc", LPF: true, LPFType: "FIR", LPFOrder: 71, sincFilterSize: 12 }
    ))));
  }
}

class PcmAccumulator {
  private readonly chunks: Array<{ start: number; length: number; channels: Float32Array[] }> = [];
  private _startSample = 0;
  private _endSample = 0;

  constructor(private readonly channels: number) {}

  get endSample() {
    return this._endSample;
  }

  append(channels: Float32Array[]) {
    const frameCount = channels[0]?.length ?? 0;
    if (!frameCount) return;
    const normalizedChannels = Array.from({ length: this.channels }, (_, channelIndex) =>
      channels[channelIndex] ?? channels[0]!
    );
    this.chunks.push({ start: this._endSample, length: frameCount, channels: normalizedChannels });
    this._endSample += frameCount;
  }

  slice(startSample: number, endSample: number) {
    const start = Math.max(this._startSample, startSample);
    const end = Math.max(start, Math.min(this._endSample, endSample));
    const output = Array.from({ length: this.channels }, () => new Float32Array(end - start));
    for (const chunk of this.chunks) {
      const overlapStart = Math.max(start, chunk.start);
      const overlapEnd = Math.min(end, chunk.start + chunk.length);
      if (overlapEnd <= overlapStart) continue;
      const sourceStart = overlapStart - chunk.start;
      const targetStart = overlapStart - start;
      for (let channelIndex = 0; channelIndex < this.channels; channelIndex += 1) {
        output[channelIndex]!.set(
          chunk.channels[channelIndex]!.subarray(sourceStart, sourceStart + overlapEnd - overlapStart),
          targetStart
        );
      }
    }
    return output;
  }

  trimBefore(sample: number) {
    const target = Math.max(this._startSample, Math.min(sample, this._endSample));
    while (this.chunks.length > 0) {
      const first = this.chunks[0]!;
      const firstEnd = first.start + first.length;
      if (firstEnd <= target) {
        this.chunks.shift();
        continue;
      }
      if (first.start < target) {
        const offset = target - first.start;
        first.channels = first.channels.map((channel) => channel.slice(offset));
        first.start = target;
        first.length -= offset;
      }
      break;
    }
    this._startSample = target;
  }
}

type CompressedFrameReader = {
  readFrames: (limit: number) => Promise<CompressedFrame[]>;
  dispose?: () => Promise<void>;
};

async function resolveCompressedPlaybackSource(file: File): Promise<CompressedPlaybackSource | null> {
  const format = resolveSupportedUploadFormat(file);
  if (format !== "flac" && format !== "mp3") return null;

  const globals = globalThis as unknown as {
    AudioDecoder?: StreamingAudioDecoderConstructor;
    EncodedAudioChunk?: EncodedAudioChunkLike;
  };
  if (!globals.AudioDecoder || !globals.EncodedAudioChunk) return null;

  if (format === "flac") {
    const streamInfo = await readFlacStreamInfo(file);
    if (!streamInfo || streamInfo.numberOfChannels < 1 || streamInfo.numberOfChannels > 2) {
      return null;
    }
    const durationMs = await resolveFlacDurationMs(file, streamInfo);
    const reader = new FlacFrameReader(file, streamInfo);
    const decoderConfig: Record<string, unknown> = {
      codec: "flac",
      sampleRate: streamInfo.sampleRate,
      numberOfChannels: streamInfo.numberOfChannels,
      description: streamInfo.description
    };
    if (!(await isAudioDecoderConfigSupported(globals.AudioDecoder, decoderConfig))) {
      await reader.dispose();
      return null;
    }
    let source: StreamingCompressedPlaybackSource | null = null;
    const decoder = new globals.AudioDecoder({
      output: (audioData) => source?.appendDecoded(audioData),
      error: (error) => source?.setDecoderError(error)
    });
    decoder.configure(decoderConfig);
    source = new StreamingCompressedPlaybackSource(
      streamInfo.numberOfChannels as 1 | 2,
      streamInfo.sampleRate,
      durationMs,
      reader,
      decoder,
      globals.EncodedAudioChunk
    );
    return source;
  }

  const metadata = await scanMp3Metadata(file);
  if (!metadata) return null;
  const reader = new Mp3FrameReader(file, metadata.audioOffset);
  const decoderConfig: Record<string, unknown> = {
    codec: "mp3",
    sampleRate: metadata.sampleRate,
    numberOfChannels: metadata.channels
  };
  if (!(await isAudioDecoderConfigSupported(globals.AudioDecoder, decoderConfig))) {
    await reader.dispose();
    return null;
  }
  let source: StreamingCompressedPlaybackSource | null = null;
  const decoder = new globals.AudioDecoder({
    output: (audioData) => source?.appendDecoded(audioData),
    error: (error) => source?.setDecoderError(error)
  });
  decoder.configure(decoderConfig);
  source = new StreamingCompressedPlaybackSource(
    metadata.channels,
    metadata.sampleRate,
    Math.max(1, Math.round((metadata.totalSamples / metadata.sampleRate) * 1000)),
    reader,
    decoder,
    globals.EncodedAudioChunk
  );
  return source;
}

async function isAudioDecoderConfigSupported(
  constructor: StreamingAudioDecoderConstructor,
  config: unknown
) {
  if (!constructor.isConfigSupported) return true;
  try {
    const result = await constructor.isConfigSupported(config);
    return result.supported !== false;
  } catch {
    return false;
  }
}

async function readFlacStreamInfo(file: File): Promise<FlacStreamInfo | null> {
  let probeBytes = 1024 * 1024;
  const maxProbeBytes = Math.min(file.size, 32 * 1024 * 1024);
  while (probeBytes <= maxProbeBytes) {
    const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, probeBytes)).arrayBuffer());
    const streamInfo = parseFlacStreamInfo(bytes);
    if (streamInfo) return streamInfo;
    if (probeBytes >= file.size) break;
    probeBytes = Math.min(maxProbeBytes, probeBytes * 2);
  }
  return null;
}

async function resolveFlacDurationMs(file: File, streamInfo: FlacStreamInfo) {
  if (streamInfo.totalSamples && streamInfo.totalSamples > 0) {
    return Math.max(1, Math.round((streamInfo.totalSamples / streamInfo.sampleRate) * 1000));
  }
  const reader = new FlacFrameReader(file, streamInfo);
  let lastSample = 0;
  try {
    while (true) {
      const frames = await reader.readFrames(compressedDecodeBatchFrames);
      if (frames.length === 0) break;
      for (const frame of frames) {
        lastSample = Math.max(
          lastSample,
          Math.round((frame.timestampUs / 1_000_000) * streamInfo.sampleRate) + frame.sampleCount
        );
      }
    }
  } finally {
    await reader.dispose();
  }
  return Math.max(1, Math.round((lastSample / streamInfo.sampleRate) * 1000));
}

class FlacFrameReader implements CompressedFrameReader {
  private offset: number;
  private carry = new Uint8Array(0);
  private nextSampleIndex = 0;
  private eof = false;
  private pending: CompressedFrame[] = [];

  constructor(private readonly file: File, private readonly streamInfo: FlacStreamInfo) {
    this.offset = streamInfo.audioOffset;
  }

  async readFrames(limit: number) {
    while (this.pending.length < limit && !this.eof) {
      const nextBytes = new Uint8Array(await this.file.slice(
        this.offset,
        Math.min(this.file.size, this.offset + compressedDecodeWindowBytes)
      ).arrayBuffer());
      if (nextBytes.byteLength === 0) {
        this.eof = true;
        break;
      }
      this.offset += nextBytes.byteLength;
      const bytes = concatBytes(this.carry, nextBytes);
      const extraction = extractFlacPackets({
        bytes,
        startOffset: 0,
        sampleRate: this.streamInfo.sampleRate,
        streamInfo: { ...this.streamInfo, audioOffset: 0 },
        nextSampleIndex: this.nextSampleIndex,
        finalChunk: this.offset >= this.file.size
      });
      this.pending.push(...extraction.packets);
      this.nextSampleIndex = extraction.nextSampleIndex;
      this.carry = bytes.slice(extraction.nextOffset);
      if (this.offset >= this.file.size) this.eof = true;
      if (this.carry.byteLength > compressedDecodeWindowBytes * 2) {
        throw new Error("FLAC 帧边界无法解析。");
      }
    }
    return this.pending.splice(0, limit);
  }

  async dispose() {
    this.carry = new Uint8Array(0);
    this.pending = [];
  }
}

class Mp3FrameReader implements CompressedFrameReader {
  private offset: number;
  private carry = new Uint8Array(0);
  private sampleIndex = 0;
  private eof = false;
  private pending: CompressedFrame[] = [];

  constructor(private readonly file: File, audioOffset: number) {
    this.offset = audioOffset;
  }

  async readFrames(limit: number) {
    while (this.pending.length < limit && !this.eof) {
      const nextBytes = new Uint8Array(await this.file.slice(
        this.offset,
        Math.min(this.file.size, this.offset + compressedDecodeWindowBytes)
      ).arrayBuffer());
      if (!nextBytes.byteLength) {
        this.eof = true;
        break;
      }
      this.offset += nextBytes.byteLength;
      const bytes = concatBytes(this.carry, nextBytes);
      let cursor = 0;
      while (cursor + 4 <= bytes.byteLength) {
        const header = parseMp3FrameHeader(bytes, cursor);
        if (!header) {
          cursor += 1;
          continue;
        }
        if (cursor + header.frameLength > bytes.byteLength) break;
        const durationUs = Math.round((header.samplesPerFrame / header.sampleRate) * 1_000_000);
        this.pending.push({
          data: bytes.slice(cursor, cursor + header.frameLength),
          sampleCount: header.samplesPerFrame,
          timestampUs: Math.round((this.sampleIndex / header.sampleRate) * 1_000_000),
          durationUs
        });
        this.sampleIndex += header.samplesPerFrame;
        cursor += header.frameLength;
      }
      this.carry = bytes.slice(cursor);
      if (this.offset >= this.file.size) {
        this.eof = true;
        this.carry = new Uint8Array(0);
      }
      if (this.carry.byteLength > compressedDecodeWindowBytes * 2) {
        throw new Error("MP3 帧边界无法解析。");
      }
    }
    return this.pending.splice(0, limit);
  }

  async dispose() {
    this.carry = new Uint8Array(0);
    this.pending = [];
  }
}

async function scanMp3Metadata(file: File) {
  const firstBytes = new Uint8Array(await file.slice(0, Math.min(file.size, 10)).arrayBuffer());
  const audioOffset = skipMp3Id3v2(firstBytes);
  let offset = audioOffset;
  let carry = new Uint8Array(0);
  let totalSamples = 0;
  let sampleRate = 0;
  let channels: 1 | 2 = 2;
  let foundFrame = false;

  while (offset < file.size) {
    const nextBytes = new Uint8Array(await file.slice(
      offset,
      Math.min(file.size, offset + compressedDecodeWindowBytes)
    ).arrayBuffer());
    if (!nextBytes.byteLength) break;
    offset += nextBytes.byteLength;
    const bytes = concatBytes(carry, nextBytes);
    let cursor = 0;
    while (cursor + 4 <= bytes.byteLength) {
      const header = parseMp3FrameHeader(bytes, cursor);
      if (!header) {
        cursor += 1;
        continue;
      }
      if (cursor + header.frameLength > bytes.byteLength) break;
      if (!foundFrame) {
        sampleRate = header.sampleRate;
        channels = header.channels as 1 | 2;
        foundFrame = true;
      }
      totalSamples += header.samplesPerFrame;
      cursor += header.frameLength;
    }
    carry = bytes.slice(cursor);
  }

  if (!foundFrame || sampleRate <= 0 || totalSamples <= 0) return null;
  return { audioOffset, sampleRate, channels, totalSamples };
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength === 0) return right;
  if (right.byteLength === 0) return left;
  const merged = new Uint8Array(left.byteLength + right.byteLength);
  merged.set(left);
  merged.set(right, left.byteLength);
  return merged;
}

type WavPlaybackSource = {
  channels: 1 | 2;
  sampleRate: 48_000;
  durationMs: number;
  getSegment: (unitIndex: number) => Promise<EncodablePlaybackSegment>;
};

async function resolveWavPlaybackSource(file: File): Promise<WavPlaybackSource | null> {
  const probe = await file.slice(0, Math.min(file.size, wavHeaderProbeBytes)).arrayBuffer();
  const header = parseWavHeader(probe);
  const supportedBitDepth = header?.format === "float"
    ? header.bitsPerSample === 32 || header.bitsPerSample === 64
    : header?.bitsPerSample === 8 ||
      header?.bitsPerSample === 16 ||
      header?.bitsPerSample === 24 ||
      header?.bitsPerSample === 32;
  if (!header || header.dataBytes <= 0 || header.channels < 1 || header.channels > 2 || !supportedBitDepth) {
    return null;
  }

  return {
    channels: header.channels as 1 | 2,
    sampleRate: opusSampleRate,
    durationMs: Math.max(1, Math.round((header.totalSamples / header.sampleRate) * 1000)),
    getSegment: (unitIndex) => readWavPlaybackSegment(file, header, unitIndex)
  };
}

async function readWavPlaybackSegment(
  file: File,
  header: WavHeader,
  unitIndex: number
): Promise<EncodablePlaybackSegment> {
  const sourceSegmentSamples = Math.round((segmentDurationMs / 1000) * header.sampleRate);
  const sourcePrerollSamples = Math.round((seekPrerollMs / 1000) * header.sampleRate);
  const contentStart = unitIndex * sourceSegmentSamples;
  const sampleStart = Math.max(0, contentStart - sourcePrerollSamples);
  const sampleEnd = Math.min(header.totalSamples, contentStart + sourceSegmentSamples);
  const range = resolveWavByteRangeForSamples(header, sampleStart, sampleEnd);
  const bytes = new Uint8Array(await file.slice(range.startByte, range.endByte).arrayBuffer());
  const channels = decodeWavPcmChannels(bytes, header);
  const normalizedChannels = await resampleWavChannels(channels, header.sampleRate);
  const targetPrerollSamples = Math.round((seekPrerollMs / 1000) * opusSampleRate);
  const leadingPaddingSamples = unitIndex === 0 ? targetPrerollSamples : 0;

  return {
    channels: leadingPaddingSamples > 0
      ? normalizedChannels.map((channel) => {
          const padded = new Float32Array(leadingPaddingSamples + channel.length);
          padded.set(channel, leadingPaddingSamples);
          return padded;
        })
      : normalizedChannels,
    trimStartSamples: 0
  };
}

function decodeWavPcmChannels(bytes: Uint8Array, header: WavHeader) {
  const bytesPerSample = Math.max(1, Math.floor(header.bitsPerSample / 8));
  const frameCount = Math.floor(bytes.byteLength / header.blockAlign);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = Array.from({ length: header.channels }, () => new Float32Array(frameCount));

  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameOffset = frame * header.blockAlign;
    for (let channel = 0; channel < header.channels; channel += 1) {
      const offset = frameOffset + channel * bytesPerSample;
      channels[channel]![frame] = decodeWavSample(view, offset, header.format, header.bitsPerSample);
    }
  }
  return channels;
}

function decodeWavSample(
  view: DataView,
  offset: number,
  format: WavHeader["format"],
  bitsPerSample: number
) {
  if (format === "float") {
    return bitsPerSample === 64 ? view.getFloat64(offset, true) : view.getFloat32(offset, true);
  }
  if (bitsPerSample === 8) return (view.getUint8(offset) - 128) / 128;
  if (bitsPerSample === 16) return view.getInt16(offset, true) / 32_768;
  if (bitsPerSample === 24) {
    const value = view.getUint8(offset) |
      (view.getUint8(offset + 1) << 8) |
      (view.getUint8(offset + 2) << 16);
    const signed = (value & 0x800000) !== 0 ? value | 0xff000000 : value;
    return signed / 8_388_608;
  }
  if (bitsPerSample === 32) return view.getInt32(offset, true) / 2_147_483_648;
  throw new Error(`不支持的 WAV PCM 位深：${bitsPerSample}`);
}

async function resampleWavChannels(channels: Float32Array[], sampleRate: number) {
  if (sampleRate === opusSampleRate) return channels;
  const { resample } = await import("wave-resampler");
  return channels.map((channel) => Float32Array.from(resample(
    channel,
    sampleRate,
    opusSampleRate,
    { method: "sinc", LPF: true, LPFType: "FIR", LPFOrder: 71, sincFilterSize: 12 }
  )));
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
