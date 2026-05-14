import { describe, expect, it } from "vitest";
import { resolveTransportHealth } from "./transport-health";

describe("transport-health", () => {
  it("treats buffering while still audible as degraded instead of reconnecting", () => {
    expect(
      resolveTransportHealth({
        dataConnectionState: "connected",
        dataChannelState: "open",
        mediaConnectionState: "buffering",
        mediaIceState: "checking",
        recoveryActionLevel: "observe",
        audibleSource: "progressive-local",
        bufferingWhileAudible: true
      })
    ).toMatchObject({
      transportHealth: "degraded",
      degradedReason: "ice-checking"
    });
  });

  it("treats background peer recovery as recovering before escalating to reconnecting", () => {
    expect(
      resolveTransportHealth({
        dataConnectionState: "connected",
        dataChannelState: "open",
        mediaConnectionState: "connecting",
        mediaIceState: "connected",
        recoveryActionLevel: "peer-restart",
        audibleSource: "progressive-local",
        bufferingWhileAudible: false
      })
    ).toMatchObject({
      transportHealth: "recovering",
      degradedReason: "peer-restart"
    });
  });

  it("only reports reconnecting once hard recovery is active and no audible source remains", () => {
    expect(
      resolveTransportHealth({
        dataConnectionState: "disconnected",
        dataChannelState: "closed",
        mediaConnectionState: "disconnected",
        mediaIceState: "connected",
        recoveryActionLevel: "hard-reconnect",
        audibleSource: null,
        bufferingWhileAudible: false
      })
    ).toMatchObject({
      transportHealth: "reconnecting",
      degradedReason: "hard-reconnect"
    });
  });

  it("keeps media-only when audio is flowing but data is not ready", () => {
    expect(
      resolveTransportHealth({
        dataConnectionState: "connecting",
        dataChannelState: "connecting",
        mediaConnectionState: "live",
        mediaIceState: "connected",
        recoveryActionLevel: "observe",
        audibleSource: "progressive-local",
        bufferingWhileAudible: false
      })
    ).toMatchObject({
      transportHealth: "media-only",
      degradedReason: "data-channel-not-ready"
    });
  });
});
