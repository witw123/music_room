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
    const opusHeadOffset = payload.findIndex((value, index) =>
      index + 8 <= payload.byteLength &&
      new TextDecoder().decode(payload.subarray(index, index + 8)) === "OpusHead"
    );
    assert.ok(opusHeadOffset >= 0);
    assert.equal(new DataView(payload.buffer).getUint16(opusHeadOffset + 10, true), 3840);
  } finally {
    encoder.free();
  }
});

test("reuses the codec for independent Ogg units", async () => {
  const encoder = await createOpusEncoder({
    sampleRate: 48_000,
    channels: 1,
    bitrate: 96,
    application: "audio"
  });

  try {
    const first = encoder.encodeIndependent([new Float32Array(9_600)]);
    const second = encoder.encodeIndependent([new Float32Array(9_600)]);
    for (const payload of [first, second]) {
      assert.equal(new TextDecoder().decode(payload.subarray(0, 4)), "OggS");
      const opusHeadOffset = payload.findIndex((value, index) =>
        index + 8 <= payload.byteLength &&
        new TextDecoder().decode(payload.subarray(index, index + 8)) === "OpusHead"
      );
      assert.ok(opusHeadOffset >= 0);
    }
  } finally {
    encoder.free();
  }
});
