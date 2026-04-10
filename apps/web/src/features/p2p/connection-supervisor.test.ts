import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canRunRecoveryAction,
  createPeerConnectionSupervisorState,
  markRecoveryAction,
  notePeerSignalState,
  observePeerTransport,
  recordPeerPlayoutProgress,
  resolvePreferredIceTransportPolicy,
  toSupervisorDiagnosticPatch
} from "./connection-supervisor";

describe("connection-supervisor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-06T10:00:00.000Z"));
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn()
      }
    });
  });

  it("promotes a healthy transport to degraded and unstable only after consecutive windows", () => {
    let state = createPeerConnectionSupervisorState({
      roomId: "room_1",
      peerId: "peer_b",
      now: Date.now()
    });
    const unstableSample = {
      candidateType: "host",
      protocol: "udp",
      currentRoundTripTimeMs: 240,
      availableOutgoingBitrateKbps: 320,
      mediaReceiveBitrateKbps: 32,
      mediaSendBitrateKbps: 32,
      packetsLost: 12,
      packetLossRate: 1.4,
      jitterMs: 8
    };

    state = observePeerTransport({
      state,
      sample: unstableSample,
      diagnostics: {
        dataChannelState: "open",
        dataConnectionState: "connected",
        mediaConnectionState: "connected",
        dataIceState: "connected",
        mediaIceState: "connected"
      }
    });
    expect(state.transportScore).toBe("healthy");

    vi.advanceTimersByTime(1_000);
    state = observePeerTransport({
      state,
      sample: unstableSample,
      diagnostics: {
        dataChannelState: "open",
        dataConnectionState: "connected",
        mediaConnectionState: "connected",
        dataIceState: "connected",
        mediaIceState: "connected"
      }
    });
    expect(state.transportScore).toBe("unstable");
  });

  it("switches to relay preference after repeated heavy recoveries and persists a stable relay path", () => {
    let state = createPeerConnectionSupervisorState({
      roomId: "room_1",
      peerId: "peer_b"
    });

    state = markRecoveryAction({
      state,
      action: "ice-restart",
      failureReason: "ice-failed"
    });
    vi.advanceTimersByTime(2_600);
    state = markRecoveryAction({
      state,
      action: "hard-recreate",
      failureReason: "media-failed"
    });
    expect(resolvePreferredIceTransportPolicy(state)).toBe("relay");

    const healthyRelaySample = {
      candidateType: "relay",
      protocol: "udp",
      currentRoundTripTimeMs: 42,
      availableOutgoingBitrateKbps: 256,
      mediaReceiveBitrateKbps: 96,
      mediaSendBitrateKbps: 96,
      packetsLost: 0,
      packetLossRate: 0,
      jitterMs: 3
    };
    const healthyDiagnostics = {
      dataChannelState: "open",
      dataConnectionState: "connected",
      mediaConnectionState: "connected",
      dataIceState: "connected",
      mediaIceState: "connected"
    } as const;

    state = observePeerTransport({
      state,
      sample: healthyRelaySample,
      diagnostics: healthyDiagnostics
    });
    vi.advanceTimersByTime(31_000);
    state = observePeerTransport({
      state,
      sample: healthyRelaySample,
      diagnostics: healthyDiagnostics
    });

    expect(state.stableTransportKind).toBe("relay");
    expect(toSupervisorDiagnosticPatch(state)).toMatchObject({
      stableTransportKind: "relay",
      lastRecoveryAction: "hard-recreate",
      recoveryActionLevel: "hard-reconnect"
    });
  });

  it("tracks budgets per recovery stage and generation", () => {
    let state = createPeerConnectionSupervisorState({
      roomId: "room_1",
      peerId: "peer_b"
    });

    expect(
      canRunRecoveryAction({
        state,
        action: "soft",
        generation: "g1"
      })
    ).toBe(true);
    state = markRecoveryAction({
      state,
      action: "soft",
      generation: "g1"
    });
    expect(
      canRunRecoveryAction({
        state,
        action: "soft",
        generation: "g1"
      })
    ).toBe(false);
    expect(
      canRunRecoveryAction({
        state,
        action: "soft",
        generation: "g2"
      })
    ).toBe(true);

    vi.advanceTimersByTime(900);
    expect(
      canRunRecoveryAction({
        state,
        action: "soft",
        generation: "g1"
      })
    ).toBe(true);
  });

  it("captures signaling failures and playout progress", () => {
    let state = createPeerConnectionSupervisorState({
      roomId: "room_1",
      peerId: "peer_b"
    });
    state = notePeerSignalState({
      state,
      mediaIceState: "failed"
    });
    expect(state.lastFailureReason).toBe("ice-failed");

    vi.advanceTimersByTime(500);
    state = recordPeerPlayoutProgress(state);
    expect(state.lastPlayoutProgressAtMs).toBe(Date.now());
  });

  it("treats send-only media progress as transport progress for the source peer", () => {
    let state = createPeerConnectionSupervisorState({
      roomId: "room_1",
      peerId: "peer_listener"
    });
    const sendOnlySample = {
      candidateType: "host",
      protocol: "udp",
      currentRoundTripTimeMs: 28,
      availableOutgoingBitrateKbps: 1_200,
      mediaReceiveBitrateKbps: 0,
      mediaSendBitrateKbps: 510,
      packetsLost: 0,
      packetLossRate: 0,
      jitterMs: 2
    };
    const diagnostics = {
      dataChannelState: "open",
      dataConnectionState: "connected",
      mediaConnectionState: "connected",
      dataIceState: "connected",
      mediaIceState: "connected"
    } as const;

    state = observePeerTransport({
      state,
      sample: sendOnlySample,
      diagnostics
    });
    vi.advanceTimersByTime(1_000);
    state = observePeerTransport({
      state,
      sample: sendOnlySample,
      diagnostics
    });

    expect(state.transportScore).toBe("healthy");
    expect(state.lastTransportProgressAtMs).toBe(Date.now());
  });
});
