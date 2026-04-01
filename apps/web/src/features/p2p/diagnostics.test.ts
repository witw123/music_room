import { describe, expect, it } from "vitest";
import {
  createEmptyDiagnosticsState,
  recordDiagnosticsEvent
} from "./diagnostics";

describe("p2p diagnostics", () => {
  it("records global and peer-local events", () => {
    const state = recordDiagnosticsEvent(createEmptyDiagnosticsState(), {
      peerId: "peer_a",
      channelKind: "data",
      direction: "sent",
      event: "offer",
      summary: "sent offer",
      now: "2026-04-01T00:00:00.000Z"
    });

    expect(state.recentEvents).toHaveLength(1);
    expect(state.peers.peer_a?.recentEvents).toHaveLength(1);
    expect(state.peers.peer_a?.recentEvents[0]).toMatchObject({
      event: "offer",
      direction: "sent"
    });
  });

  it("applies snapshot updates while recording an event", () => {
    const state = recordDiagnosticsEvent(createEmptyDiagnosticsState(), {
      peerId: "peer_a",
      channelKind: "media",
      direction: "local",
      event: "remote-track",
      summary: "received remote track",
      now: "2026-04-01T00:00:00.000Z",
      update: (snapshot) => ({
        ...snapshot,
        mediaConnectionState: "connected",
        remoteTrackStatus: {
          ...snapshot.remoteTrackStatus,
          received: true,
          lastTrackAt: "2026-04-01T00:00:00.000Z"
        }
      })
    });

    expect(state.peers.peer_a?.mediaConnectionState).toBe("connected");
    expect(state.peers.peer_a?.remoteTrackStatus.received).toBe(true);
  });
});
