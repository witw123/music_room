type HashMessage = {
  id: number;
  type: "hash";
  payload: {
    buffer: ArrayBuffer;
  };
};

type ValidateMessage = {
  id: number;
  type: "validate";
  payload: {
    buffer: ArrayBuffer;
    expectedHash: string;
  };
};

type ValidateBatchMessage = {
  id: number;
  type: "validate-batch";
  payload: {
    pieces: Array<{
      buffer: ArrayBuffer;
      expectedHash: string;
    }>;
  };
};

type AssembleMessage = {
  id: number;
  type: "assemble";
  payload: {
    pieces: Array<{ chunkIndex: number; payload: ArrayBuffer }>;
    totalChunks: number;
    mimeType: string;
    expectedFileHash: string;
  };
};

type WorkerRequest = HashMessage | ValidateMessage | ValidateBatchMessage | AssembleMessage;

type WorkerSuccessResponse =
  | { id: number; ok: true; type: "hash"; result: string }
  | { id: number; ok: true; type: "validate"; result: boolean }
  | { id: number; ok: true; type: "validate-batch"; result: boolean[] }
  | {
      id: number;
      ok: true;
      type: "assemble";
      result: {
        blob: Blob;
        fileHash: string;
      } | null;
    };

type WorkerErrorResponse = {
  id: number;
  ok: false;
  error: string;
};

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  try {
    if (message.type === "hash") {
      const result = await hashArrayBufferLocal(message.payload.buffer);
      postMessage({
        id: message.id,
        ok: true,
        type: "hash",
        result
      } satisfies WorkerSuccessResponse);
      return;
    }

    if (message.type === "validate") {
      const actualHash = await hashArrayBufferLocal(message.payload.buffer);
      postMessage({
        id: message.id,
        ok: true,
        type: "validate",
        result: actualHash === message.payload.expectedHash
      } satisfies WorkerSuccessResponse);
      return;
    }

    if (message.type === "validate-batch") {
      const result: boolean[] = [];
      for (const piece of message.payload.pieces) {
        const actualHash = await hashArrayBufferLocal(piece.buffer);
        result.push(actualHash === piece.expectedHash);
      }

      postMessage({
        id: message.id,
        ok: true,
        type: "validate-batch",
        result
      } satisfies WorkerSuccessResponse);
      return;
    }

    const assembled = await assembleTrackFileFromPiecesLocal(message.payload);
    postMessage({
      id: message.id,
      ok: true,
      type: "assemble",
      result: assembled
    } satisfies WorkerSuccessResponse);
  } catch (error) {
    postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : "Worker request failed."
    } satisfies WorkerErrorResponse);
  }
};

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
  const fileHash = await hashArrayBufferLocal(fileBuffer);

  if (fileHash !== input.expectedFileHash) {
    return null;
  }

  return {
    blob,
    fileHash
  };
}
