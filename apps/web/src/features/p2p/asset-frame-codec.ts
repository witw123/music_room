import {
  assetUnitDescriptorSchema,
  type AssetKind,
  type AssetUnitDescriptor
} from "@music-room/shared";

const magic = new Uint8Array([0x4d, 0x52, 0x55, 0x34]); // MRU4
const fixedHeaderBytes = 8;
const maxFrameBytes = 64 * 1024;
const fragmentPayloadBytes = 60 * 1024;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type AssetFrameHeader = {
  protocolVersion: 4;
  streamId: string;
  generation: number;
  assetId: string;
  assetKind: AssetKind;
  unitIndex: number;
  fragmentIndex: number;
  fragmentCount: number;
  descriptor?: AssetUnitDescriptor;
};

export type DecodedAssetFrame = {
  header: AssetFrameHeader;
  payload: ArrayBuffer;
};

export function encodeAssetUnitFrames(input: {
  streamId: string;
  generation: number;
  descriptor: AssetUnitDescriptor;
  payload: ArrayBuffer;
}) {
  const fragmentCount = Math.max(1, Math.ceil(input.payload.byteLength / fragmentPayloadBytes));
  const frames: ArrayBuffer[] = [];
  for (let fragmentIndex = 0; fragmentIndex < fragmentCount; fragmentIndex += 1) {
    const start = fragmentIndex * fragmentPayloadBytes;
    const end = Math.min(input.payload.byteLength, start + fragmentPayloadBytes);
    const header: AssetFrameHeader = {
      protocolVersion: 4,
      streamId: input.streamId,
      generation: input.generation,
      assetId: input.descriptor.assetId,
      assetKind: input.descriptor.kind,
      unitIndex: input.descriptor.unitIndex,
      fragmentIndex,
      fragmentCount,
      ...(fragmentIndex === 0 ? { descriptor: input.descriptor } : {})
    };
    const headerBytes = textEncoder.encode(JSON.stringify(header));
    const payload = new Uint8Array(input.payload, start, end - start);
    const frame = new Uint8Array(fixedHeaderBytes + headerBytes.byteLength + payload.byteLength);
    frame.set(magic, 0);
    new DataView(frame.buffer).setUint32(4, headerBytes.byteLength, false);
    frame.set(headerBytes, fixedHeaderBytes);
    frame.set(payload, fixedHeaderBytes + headerBytes.byteLength);
    if (frame.byteLength > maxFrameBytes) {
      throw new RangeError("Asset frame exceeds the 64 KiB transport limit.");
    }
    frames.push(frame.buffer);
  }
  return frames;
}

export function isAssetUnitFrame(data: ArrayBuffer) {
  if (data.byteLength < fixedHeaderBytes) {
    return false;
  }
  const bytes = new Uint8Array(data, 0, magic.byteLength);
  return magic.every((byte, index) => bytes[index] === byte);
}

export function decodeAssetUnitFrame(data: ArrayBuffer): DecodedAssetFrame {
  if (!isAssetUnitFrame(data)) {
    throw new Error("Not a P2P v4 asset frame.");
  }
  if (data.byteLength > maxFrameBytes) {
    throw new Error("Asset frame exceeds the 64 KiB transport limit.");
  }
  const headerLength = new DataView(data).getUint32(4, false);
  if (
    headerLength <= 0 ||
    headerLength > 16 * 1024 ||
    fixedHeaderBytes + headerLength > data.byteLength
  ) {
    throw new Error("Invalid asset frame header length.");
  }
  const rawHeader = JSON.parse(
    textDecoder.decode(new Uint8Array(data, fixedHeaderBytes, headerLength))
  ) as Partial<AssetFrameHeader>;
  if (
    rawHeader.protocolVersion !== 4 ||
    typeof rawHeader.streamId !== "string" ||
    typeof rawHeader.generation !== "number" ||
    typeof rawHeader.assetId !== "string" ||
    (rawHeader.assetKind !== "original" && rawHeader.assetKind !== "playback") ||
    typeof rawHeader.unitIndex !== "number" ||
    typeof rawHeader.fragmentIndex !== "number" ||
    typeof rawHeader.fragmentCount !== "number" ||
    !Number.isInteger(rawHeader.generation) ||
    rawHeader.generation < 0 ||
    !Number.isInteger(rawHeader.unitIndex) ||
    rawHeader.unitIndex < 0 ||
    !Number.isInteger(rawHeader.fragmentIndex) ||
    !Number.isInteger(rawHeader.fragmentCount) ||
    rawHeader.fragmentCount < 1 ||
    rawHeader.fragmentCount > 32 ||
    rawHeader.fragmentIndex < 0 ||
    rawHeader.fragmentIndex >= rawHeader.fragmentCount
  ) {
    throw new Error("Invalid asset frame header.");
  }
  const header: AssetFrameHeader = {
    protocolVersion: 4,
    streamId: rawHeader.streamId,
    generation: rawHeader.generation,
    assetId: rawHeader.assetId,
    assetKind: rawHeader.assetKind,
    unitIndex: rawHeader.unitIndex,
    fragmentIndex: rawHeader.fragmentIndex,
    fragmentCount: rawHeader.fragmentCount,
    ...(rawHeader.descriptor
      ? { descriptor: assetUnitDescriptorSchema.parse(rawHeader.descriptor) }
      : {})
  };
  if (
    header.descriptor &&
    (header.descriptor.assetId !== header.assetId ||
      header.descriptor.kind !== header.assetKind ||
      header.descriptor.unitIndex !== header.unitIndex)
  ) {
    throw new Error("Asset frame descriptor does not match its transport header.");
  }
  return {
    header,
    payload: data.slice(fixedHeaderBytes + headerLength)
  };
}
