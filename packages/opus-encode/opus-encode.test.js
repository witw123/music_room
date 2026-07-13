import assert from "node:assert/strict";
import test from "node:test";
import createOpusEncoder from "./opus-encode.js";

test("encodes PCM without an external WASM asset", async () => {
  const encoder = await createOpusEncoder({
    sampleRate: 48_000,
    channels: 1,
    bitrate: 96,
    application: "audio"
  });

  try {
    const head = encoder.encode([new Float32Array(48_000 / 10)]);
    const tail = encoder.flush();
    const payload = new Uint8Array(head.byteLength + tail.byteLength);
    payload.set(head, 0);
    payload.set(tail, head.byteLength);
    assert.equal(new TextDecoder().decode(payload.subarray(0, 4)), "OggS");
  } finally {
    encoder.free();
  }
});
