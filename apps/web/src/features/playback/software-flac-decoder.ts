export type SoftwareFlacDecodedAudio = {
  channelData: Float32Array[];
  samplesDecoded: number;
  sampleRate: number;
  bitDepth: number;
  errors: Array<{ message?: string }>;
};

export type SoftwareFlacDecoder = {
  decodeFrames: (frames: Uint8Array[]) => Promise<SoftwareFlacDecodedAudio>;
  free: () => void | Promise<void>;
};

export function resolveFlacDecoderStrategy(input: {
  nativeConfigSupported: boolean;
  sourceSampleRate: number;
  maxNativeSampleRate: number;
}) {
  return input.nativeConfigSupported && input.sourceSampleRate <= input.maxNativeSampleRate
    ? "webcodecs" as const
    : "software" as const;
}

type NormalizedSoftwareFlacOutput = {
  channelData: Float32Array[];
  samplesDecoded: number;
  sampleRate: number;
};

type ResampleWorkerResponse = NormalizedSoftwareFlacOutput & {
  id: number;
  error?: string;
};

let resampleWorker: Worker | null = null;
let resampleRequestId = 0;
const pendingResamples = new Map<
  number,
  { resolve: (output: NormalizedSoftwareFlacOutput) => void; reject: (error: Error) => void }
>();

export async function normalizeSoftwareFlacOutput(input: {
  channelData: Float32Array[];
  samplesDecoded: number;
  sampleRate: number;
  targetSampleRate: number;
}) {
  const validChannels = input.channelData.filter(
    (channel) => channel instanceof Float32Array && channel.length > 0
  );
  if (
    validChannels.length === 0 ||
    input.samplesDecoded <= 0 ||
    input.sampleRate <= 0 ||
    input.targetSampleRate <= 0
  ) {
    return {
      channelData: [] as Float32Array[],
      samplesDecoded: 0,
      sampleRate: input.targetSampleRate
    };
  }

  if (input.sampleRate === input.targetSampleRate) {
    return {
      channelData: validChannels,
      samplesDecoded: Math.min(input.samplesDecoded, validChannels[0]?.length ?? 0),
      sampleRate: input.sampleRate
    };
  }

  if (typeof Worker === "undefined") {
    const { resample } = await import("wave-resampler");
    const channelData = validChannels.map((channel) =>
      Float32Array.from(
        resample(channel.slice(), input.sampleRate, input.targetSampleRate, {
          method: "sinc",
          LPF: true,
          LPFType: "FIR",
          LPFOrder: 71,
          sincFilterSize: 12
        })
      )
    );
    return {
      channelData,
      samplesDecoded: channelData[0]?.length ?? 0,
      sampleRate: input.targetSampleRate
    };
  }

  const worker = getResampleWorker();
  const id = ++resampleRequestId;
  return new Promise<NormalizedSoftwareFlacOutput>((resolve, reject) => {
    pendingResamples.set(id, { resolve, reject });
    const channelData = validChannels;
    worker.postMessage(
      {
        id,
        channelData,
        sourceSampleRate: input.sampleRate,
        targetSampleRate: input.targetSampleRate
      },
      channelData.map((channel) => channel.buffer)
    );
  });
}

function getResampleWorker() {
  if (resampleWorker) {
    return resampleWorker;
  }

  const worker = new Worker(new URL("./software-flac-resampler.worker.ts", import.meta.url));
  worker.onmessage = (event: MessageEvent<ResampleWorkerResponse>) => {
    const pending = pendingResamples.get(event.data.id);
    if (!pending) {
      return;
    }
    pendingResamples.delete(event.data.id);
    if (event.data.error) {
      pending.reject(new Error(event.data.error));
      return;
    }
    pending.resolve({
      channelData: event.data.channelData,
      samplesDecoded: event.data.samplesDecoded,
      sampleRate: event.data.sampleRate
    });
  };
  worker.onerror = () => {
    for (const pending of pendingResamples.values()) {
      pending.reject(new Error("software-resampler-worker-failed"));
    }
    pendingResamples.clear();
    worker.terminate();
    resampleWorker = null;
  };
  resampleWorker = worker;
  return worker;
}

export async function createSoftwareFlacDecoder(): Promise<SoftwareFlacDecoder> {
  const { FLACDecoderWebWorker } = await import("@wasm-audio-decoders/flac");
  const decoder = new FLACDecoderWebWorker();
  await decoder.ready;
  return decoder;
}
