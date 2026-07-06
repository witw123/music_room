import {
  p2pDataMessageSchema,
  type P2PDataMessage
} from "@music-room/shared";
import {
  decodePieceFrame,
  type BinaryPieceFragmentMessage,
  type BinaryPieceMessage
} from "./piece-frame-codec";

export async function parseIncomingMeshMessage(data: unknown): Promise<
  P2PDataMessage | BinaryPieceMessage | BinaryPieceFragmentMessage | null
> {
  if (typeof data === "string") {
    let parsedMessage: unknown;

    try {
      parsedMessage = JSON.parse(data);
    } catch {
      return null;
    }

    const result = p2pDataMessageSchema.safeParse(parsedMessage);
    if (result.success) {
      return result.data;
    }

    if (isRequestPiecesDataMessage(parsedMessage)) {
      return parsedMessage;
    }

    return null;
  }

  const buffer = await toArrayBuffer(data);
  if (!buffer) {
    return null;
  }

  const frame = decodePieceFrame(buffer);
  if (!frame) {
    return null;
  }

  return {
    ...frame.header,
    header: frame.header,
    payload: frame.payload
  } as BinaryPieceMessage | BinaryPieceFragmentMessage;
}

function isRequestPiecesDataMessage(
  value: unknown
): value is Extract<P2PDataMessage, { kind: "request-pieces" }> {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as {
    kind?: unknown;
    requestId?: unknown;
    trackId?: unknown;
    chunkIndexes?: unknown;
  };

  return (
    candidate.kind === "request-pieces" &&
    typeof candidate.requestId === "string" &&
    candidate.requestId.length > 0 &&
    typeof candidate.trackId === "string" &&
    candidate.trackId.length > 0 &&
    Array.isArray(candidate.chunkIndexes) &&
    candidate.chunkIndexes.length > 0 &&
    candidate.chunkIndexes.every(
      (chunkIndex) =>
        typeof chunkIndex === "number" &&
        Number.isInteger(chunkIndex) &&
        chunkIndex >= 0
    )
  );
}

async function toArrayBuffer(data: unknown) {
  if (data instanceof ArrayBuffer) {
    return data;
  }

  if (ArrayBuffer.isView(data)) {
    const view = data;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice().buffer;
  }

  if (data instanceof Blob) {
    return data.arrayBuffer();
  }

  return null;
}

export function isBinaryPieceMessage(
  value: P2PDataMessage | BinaryPieceMessage | BinaryPieceFragmentMessage
): value is BinaryPieceMessage {
  return "header" in value && "payload" in value && value.header.kind === "send-piece";
}

export function isBinaryPieceFragmentMessage(
  value: P2PDataMessage | BinaryPieceMessage | BinaryPieceFragmentMessage
): value is BinaryPieceFragmentMessage {
  return (
    "header" in value &&
    "payload" in value &&
    value.header.kind === "send-piece-fragment"
  );
}
