import { describe, expect, it } from "vitest";
import {
  isSocketDisconnectGraceActive,
  shouldSuppressPlaybackWatchdogEscalation
} from "./use-room-realtime-connection";

describe("isSocketDisconnectGraceActive", () => {
  it("stays active before the grace window expires", () => {
    expect(isSocketDisconnectGraceActive(12_000, 10_000)).toBe(true);
  });

  it("stops being active after the grace window expires", () => {
    expect(isSocketDisconnectGraceActive(12_000, 12_001)).toBe(false);
    expect(isSocketDisconnectGraceActive(null, 12_001)).toBe(false);
  });
});

describe("shouldSuppressPlaybackWatchdogEscalation", () => {
  it("suppresses watchdog escalation while the page is backgrounded", () => {
    expect(
      shouldSuppressPlaybackWatchdogEscalation({
        recoverySuppressedReason: "page-hidden",
        socketDisconnectGraceActive: false
      })
    ).toBe(true);
  });

  it("suppresses watchdog escalation during socket disconnect grace", () => {
    expect(
      shouldSuppressPlaybackWatchdogEscalation({
        recoverySuppressedReason: null,
        socketDisconnectGraceActive: true
      })
    ).toBe(true);
  });

  it("allows escalation once no suppression signal remains", () => {
    expect(
      shouldSuppressPlaybackWatchdogEscalation({
        recoverySuppressedReason: null,
        socketDisconnectGraceActive: false
      })
    ).toBe(false);
  });
});
