export type SendPieceFrameHeader = {
  kind: "send-piece";
  streamId: string;
  generation: number;
  trackId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkSize: number;
  mimeType: string;
  pieceHash: string;
};

export type SendPieceFragmentFrameHeader = {
  kind: "send-piece-fragment";
  streamId: string;
  generation: number;
  trackId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkSize: number;
  mimeType: string;
  pieceHash: string;
  fragmentIndex: number;
  fragmentCount: number;
};

export type PieceFrameHeader = SendPieceFrameHeader | SendPieceFragmentFrameHeader;

export type BinaryPieceMessage = SendPieceFrameHeader & {
  header: SendPieceFrameHeader;
  payload: ArrayBuffer;
};

export type BinaryPieceFragmentMessage = SendPieceFragmentFrameHeader & {
  header: SendPieceFragmentFrameHeader;
  payload: ArrayBuffer;
};

export type PendingIncomingPieceFragments = {
  peerId: string;
  streamId: string;
  generation: number;
  trackId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkSize: number;
  mimeType: string;
  pieceHash: string;
  fragmentCount: number;
  receivedAtMs: number;
  fragments: Map<number, ArrayBuffer>;
};

function buildPieceFrame(header: PieceFrameHeader, payload: ArrayBuffer) {
  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(JSON.stringify(header));
  const payloadBytes = new Uint8Array(payload);
  const frame = new Uint8Array(4 + headerBytes.byteLength + payloadBytes.byteLength);

  new DataView(frame.buffer).setUint32(0, headerBytes.byteLength, false);
  frame.set(headerBytes, 4);
  frame.set(payloadBytes, 4 + headerBytes.byteLength);

  return frame.buffer;
}

export function buildPieceFrames(
  header: Omit<SendPieceFrameHeader, "kind">,
  payload: ArrayBuffer,
  maxPayloadBytes: number
) {
  const singleFrame = buildPieceFrame(
    {
      kind: "send-piece",
      ...header
    },
    payload
  );
  if (singleFrame.byteLength <= maxPayloadBytes) {
    return [{ data: singleFrame, payloadBytes: payload.byteLength }];
  }

  const fragmentPayloadSize = Math.max(8 * 1024, maxPayloadBytes - 1024);
  const payloadBytes = new Uint8Array(payload);
  const fragmentCount = Math.ceil(payloadBytes.byteLength / fragmentPayloadSize);
  const frames: Array<{ data: ArrayBuffer; payloadBytes: number }> = [];

  for (let fragmentIndex = 0; fragmentIndex < fragmentCount; fragmentIndex += 1) {
    const fragmentStart = fragmentIndex * fragmentPayloadSize;
    const fragmentEnd = Math.min(payloadBytes.byteLength, fragmentStart + fragmentPayloadSize);
    const fragmentPayload = payloadBytes.slice(fragmentStart, fragmentEnd).buffer;
    frames.push({
      data: buildPieceFrame(
        {
          kind: "send-piece-fragment",
          ...header,
          fragmentIndex,
          fragmentCount
        },
        fragmentPayload
      ),
      payloadBytes: fragmentEnd - fragmentStart
    });
  }

  return frames;
}

export function decodePieceFrame(buffer: ArrayBuffer) {
  if (buffer.byteLength < 5) {
    return null;
  }

  const view = new DataView(buffer);
  const headerLength = view.getUint32(0, false);
  const payloadOffset = 4 + headerLength;

  if (headerLength <= 0 || payloadOffset > buffer.byteLength) {
    return null;
  }

  const headerBytes = new Uint8Array(buffer, 4, headerLength);
  const payload = buffer.slice(payloadOffset);

  let parsedHeader: unknown;
  try {
    parsedHeader = JSON.parse(new TextDecoder().decode(headerBytes));
  } catch {
    return null;
  }

  if (!isPieceFrameHeader(parsedHeader)) {
    return null;
  }

  return {
    header: parsedHeader,
    payload
  };
}

export function assembleIncomingPieceFragments(fragmentState: PendingIncomingPieceFragments) {
  const orderedFragments: Uint8Array[] = [];
  for (let fragmentIndex = 0; fragmentIndex < fragmentState.fragmentCount; fragmentIndex += 1) {
    const fragment = fragmentState.fragments.get(fragmentIndex);
    if (!fragment) {
      return null;
    }
    orderedFragments.push(new Uint8Array(fragment));
  }

  const totalLength = orderedFragments.reduce((sum, fragment) => sum + fragment.byteLength, 0);
  const payload = new Uint8Array(totalLength);
  let offset = 0;
  for (const fragment of orderedFragments) {
    payload.set(fragment, offset);
    offset += fragment.byteLength;
  }

  return payload.buffer;
}

function isPieceFrameHeader(value: unknown): value is PieceFrameHeader {
  if (!value || typeof value !== "object") {
    return false;
  }

  const header = value as Record<string, unknown>;
  const hasBaseShape =
    typeof header.streamId === "string" &&
    header.streamId.length > 0 &&
    typeof header.generation === "number" &&
    Number.isInteger(header.generation) &&
    header.generation >= 0 &&
    typeof header.trackId === "string" &&
    typeof header.chunkIndex === "number" &&
    typeof header.totalChunks === "number" &&
    typeof header.chunkSize === "number" &&
    typeof header.mimeType === "string" &&
    typeof header.pieceHash === "string";

  if (!hasBaseShape) {
    return false;
  }

  if (header.kind === "send-piece") {
    return true;
  }

  return (
    header.kind === "send-piece-fragment" &&
    typeof header.fragmentIndex === "number" &&
    typeof header.fragmentCount === "number"
  );
}
