import { resample } from "wave-resampler";

type ResampleRequest = {
  id: number;
  channelData: Float32Array[];
  sourceSampleRate: number;
  targetSampleRate: number;
};

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<ResampleRequest>) => void) | null;
  postMessage: (message: unknown, transfer: Transferable[]) => void;
};

workerScope.onmessage = (event) => {
  try {
    const channelData = event.data.channelData.map((channel) =>
      Float32Array.from(
        resample(channel, event.data.sourceSampleRate, event.data.targetSampleRate, {
          method: "sinc",
          LPF: true,
          LPFType: "FIR",
          LPFOrder: 71,
          sincFilterSize: 12
        })
      )
    );
    workerScope.postMessage(
      {
        id: event.data.id,
        channelData,
        samplesDecoded: channelData[0]?.length ?? 0,
        sampleRate: event.data.targetSampleRate
      },
      channelData.map((channel) => channel.buffer)
    );
  } catch (error) {
    workerScope.postMessage({
      id: event.data.id,
      channelData: [],
      samplesDecoded: 0,
      sampleRate: event.data.targetSampleRate,
      error: error instanceof Error ? error.message : "software-resampler-failed"
    }, []);
  }
};
