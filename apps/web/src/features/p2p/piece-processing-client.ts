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
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
};

let workerInstance: Worker | null = null;
let requestCounter = 0;
const pendingRequests = new Map<number, PendingRequest>();

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
      const pending = pendingRequests.get(message.id);
      if (!pending) {
        return;
      }

      pendingRequests.delete(message.id);
      if (!message.ok) {
        pending.reject(new Error(message.error));
        return;
      }

      pending.resolve(message.result);
    };
    workerInstance.onerror = (error) => {
      for (const pending of pendingRequests.values()) {
        pending.reject(error);
      }
      pendingRequests.clear();
      workerInstance?.terminate();
      workerInstance = null;
    };
  }

  return workerInstance;
}

async function runWorkerTask<T>(request: Omit<WorkerRequest, "id">) {
  const worker = getWorker();
  if (!worker) {
    return null;
  }

  const id = ++requestCounter;
  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    worker.postMessage({
      id,
      ...request
    } as WorkerRequest);
  });
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
