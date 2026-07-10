type WorkerRequest =
  | {
      id: number;
      type: "hash";
      payload: { buffer: ArrayBuffer };
    }
  | {
      id: number;
      type: "validate";
      payload: { buffer: ArrayBuffer; expectedHash: string };
    }
  | {
      id: number;
      type: "validate-batch";
      payload: {
        pieces: Array<{
          buffer: ArrayBuffer;
          expectedHash: string;
        }>;
      };
    }
  | {
      id: number;
      type: "assemble";
      payload: {
        pieces: Array<{ chunkIndex: number; payload: ArrayBuffer }>;
        totalChunks: number;
        mimeType: string;
        expectedFileHash: string;
      };
    };

type WorkerResponse =
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
    }
  | { id: number; ok: false; error: string };

type PendingRequest = {
  resolve: (value: unknown | null) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

let workerInstance: Worker | null = null;
let requestCounter = 0;
const pendingRequests = new Map<number, PendingRequest>();
const workerTaskTimeoutMs = 45_000;

function canUseWorker() {
  return typeof window !== "undefined" && typeof Worker !== "undefined";
}

function getWorker() {
  if (!canUseWorker()) {
    return null;
  }

  if (!workerInstance) {
    workerInstance = new Worker(
      new URL("./piece-processing.worker.ts", import.meta.url),
      { type: "module" }
    );
    workerInstance.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (!pendingRequests.has(message.id)) {
        return;
      }

      if (!message.ok) {
        settleWorkerRequest(message.id, null);
        return;
      }

      settleWorkerRequest(message.id, message.result);
    };
    workerInstance.onerror = () => {
      resetWorkerWithFallback();
    };
    workerInstance.onmessageerror = () => {
      resetWorkerWithFallback();
    };
  }

  return workerInstance;
}

function settleWorkerRequest(id: number, value: unknown | null) {
  const pending = pendingRequests.get(id);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeoutId);
  pendingRequests.delete(id);
  pending.resolve(value);
}

function resetWorkerWithFallback() {
  for (const [id] of pendingRequests.entries()) {
    settleWorkerRequest(id, null);
  }
  workerInstance?.terminate();
  workerInstance = null;
}

async function runWorkerTask<T>(request: Omit<WorkerRequest, "id">): Promise<T | null> {
  const worker = getWorker();
  if (!worker) {
    return null;
  }

  const id = ++requestCounter;
  const result = await new Promise<T | null>((resolve) => {
    const timeoutId = setTimeout(() => {
      resetWorkerWithFallback();
    }, workerTaskTimeoutMs);
    pendingRequests.set(id, {
      resolve: (value: unknown) => resolve(value as T),
      timeoutId
    });
    try {
      worker.postMessage({
        id,
        ...request
      } as WorkerRequest);
    } catch {
      resetWorkerWithFallback();
    }
  });

  // If the result is null and the worker was reset (crashed), try once more
  // with a fresh worker. Null results from normal operation (validation failure,
  // assembly mismatch) are not retried — only the worker crash null does.
  if (result !== null || workerInstance !== null) {
    return result;
  }

  return runWorkerTask<T>(request);
}

export function hashArrayBufferInWorker(buffer: ArrayBuffer) {
  return runWorkerTask<string>({
    type: "hash",
    payload: { buffer }
  });
}

export function validateTrackPiecePayloadInWorker(
  buffer: ArrayBuffer,
  expectedHash: string
) {
  return runWorkerTask<boolean>({
    type: "validate",
    payload: {
      buffer,
      expectedHash
    }
  });
}

export function validateTrackPiecePayloadBatchInWorker(
  pieces: Array<{
    buffer: ArrayBuffer;
    expectedHash: string;
  }>
) {
  return runWorkerTask<boolean[]>({
    type: "validate-batch",
    payload: {
      pieces
    }
  });
}

export function assembleTrackFileFromPiecesInWorker(input: {
  pieces: Array<{ chunkIndex: number; payload: ArrayBuffer }>;
  totalChunks: number;
  mimeType: string;
  expectedFileHash: string;
}) {
  return runWorkerTask<{
    blob: Blob;
    fileHash: string;
  } | null>({
    type: "assemble",
    payload: input
  });
}
