import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportBandwidthGovernor } from "./import-bandwidth-governor";

describe("ImportBandwidthGovernor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("throttles provider response bytes in small bursts", async () => {
    vi.useFakeTimers();
    const governor = new ImportBandwidthGovernor({ reserveBytesPerSecond: 16_000, burstBytes: 4_096 });
    const response = new Response(new Uint8Array(20_000), { headers: { "content-type": "audio/mpeg" } });
    const reading = governor.readResponse(response);
    await vi.advanceTimersByTimeAsync(1_100);
    await expect(reading).resolves.toBeInstanceOf(Blob);
  });

  it("stops a throttled import when aborted", async () => {
    vi.useFakeTimers();
    const governor = new ImportBandwidthGovernor({ reserveBytesPerSecond: 16_000, burstBytes: 4_096 });
    const controller = new AbortController();
    const reading = governor.readResponse(new Response(new Uint8Array(20_000)), controller.signal);
    controller.abort();
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
  });
});
