import { describe, expect, it } from "vitest";
import { resolvePcmRuntimeFailureReason } from "./pcm-runtime-failure";

describe("PCM runtime failure policy", () => {
  it("does not turn a previous decode error into a current runtime failure after sync recovers", () => {
    expect(
      resolvePcmRuntimeFailureReason({
        blockedReason: null,
        lastDecodeError: "decoder-flush-failed"
      })
    ).toBeNull();
  });

  it("uses the decoder detail when the current blocked reason is a generic engine failure", () => {
    expect(
      resolvePcmRuntimeFailureReason({
        blockedReason: "engine-failed",
        lastDecodeError: "decoder-flush-failed"
      })
    ).toBe("decoder-flush-failed");
  });
});
