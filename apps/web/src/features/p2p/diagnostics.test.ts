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

  it("collapses consecutive duplicate diagnostics entries while keeping the latest snapshot", () => {
    let state = recordDiagnosticsEvent(createEmptyDiagnosticsState(), {
      peerId: "system",
      channelKind: "system",
      direction: "local",
      event: "progressive-status",
      summary: "播放源 full-local / 策略 background",
      now: "2026-04-01T00:00:00.000Z",
      update: (snapshot) => ({
        ...snapshot,
        progressivePlaybackStatus: {
          activeSource: "full-local",
          transportGovernorMode: "local-primary",
          engineType: "pcm",
          aheadBufferedMs: 80_000,
          startupReady: true,
          fallbackReason: null,
          schedulerPolicy: "background",
          contiguousBufferedMs: 120_000
        }
      })
    });

    state = recordDiagnosticsEvent(state, {
      peerId: "system",
      channelKind: "system",
      direction: "local",
      event: "progressive-status",
      summary: "播放源 full-local / 策略 background",
      now: "2026-04-01T00:00:05.000Z",
      update: (snapshot) => ({
        ...snapshot,
        progressivePlaybackStatus: {
          activeSource: "full-local",
          transportGovernorMode: "local-primary",
          engineType: "pcm",
          aheadBufferedMs: 96_000,
          startupReady: true,
          fallbackReason: null,
          schedulerPolicy: "background",
          contiguousBufferedMs: 180_000
        }
      })
    });

    expect(state.recentEvents).toHaveLength(1);
    expect(state.peers.system?.recentEvents).toHaveLength(1);
    expect(state.recentEvents[0]?.timestamp).toBe("2026-04-01T00:00:05.000Z");
    expect(state.peers.system?.progressivePlaybackStatus?.contiguousBufferedMs).toBe(180_000);
  });
});
