/// <reference lib="webworker" />

import createOpusEncoder from "@audio/opus-encode";

type EncodeRequest = {
  id: number;
  sampleRate: number;
  channels: Float32Array[];
  bitrateKbps: 96 | 192;
};

type EncodeResponse =
  | { id: number; ok: true; payload: ArrayBuffer }
  | { id: number; ok: false; error: string };

self.onmessage = async (event: MessageEvent<EncodeRequest>) => {
  const request = event.data;
  try {
    const encoder = await createOpusEncoder({
      sampleRate: request.sampleRate,
      channels: request.channels.length,
      bitrate: request.bitrateKbps,
      application: "audio"
    });
    try {
      const head = encoder.encode(request.channels);
      const tail = encoder.flush();
      const encoded = new Uint8Array(head.byteLength + tail.byteLength);
      encoded.set(head, 0);
      encoded.set(tail, head.byteLength);
      const payload = encoded.buffer;
      const response: EncodeResponse = { id: request.id, ok: true, payload };
      self.postMessage(response, { transfer: [payload] });
    } finally {
      encoder.free();
    }
  } catch (error) {
    const response: EncodeResponse = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : "Opus encoding failed."
    };
    self.postMessage(response);
  }
};

export {};
