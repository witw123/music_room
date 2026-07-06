import { describe, expect, it } from "vitest";
import {
  PeerConnectionRegistry,
  clearPeerTimers,
  createPeerEntry,
  isPeerStalled,
  shouldRestartPeer
} from "./peer-connection-registry";

function buildConnection(
  input: Partial<Pick<RTCPeerConnection, "connectionState">> = {}
) {
  return {
    connectionState: input.connectionState ?? "new"
  } as RTCPeerConnection;
}

function buildDataChannel(readyState: RTCDataChannelState) {
  return {
    readyState
  } as RTCDataChannel;
}

describe("PeerConnectionRegistry", () => {
  it("tracks expected remote peers without the local peer", () => {
    const registry = new PeerConnectionRegistry("peer_a");

    const nextPeers = registry.setExpectedRemotePeerIds(["peer_a", "peer_b", "", "peer_c", "peer_b"]);

    expect([...nextPeers].sort()).toEqual(["peer_b", "peer_c"]);
    expect(registry.expects("peer_a")).toBe(false);
    expect(registry.expects("peer_b")).toBe(true);
  });

  it("only deletes an entry when it is still the current peer entry", () => {
    const registry = new PeerConnectionRegistry("peer_a");
    const firstEntry = createPeerEntry({
      connection: buildConnection(),
      initiatorPeerId: "peer_a",
      nowMs: 100
    });
    const replacementEntry = createPeerEntry({
      connection: buildConnection(),
      initiatorPeerId: "peer_a",
      nowMs: 200
    });

    registry.set("peer_b", firstEntry);
    registry.set("peer_b", replacementEntry);

    expect(registry.deleteIfCurrent("peer_b", firstEntry)).toBe(false);
    expect(registry.get("peer_b")).toBe(replacementEntry);
    expect(registry.deleteIfCurrent("peer_b", replacementEntry)).toBe(true);
    expect(registry.get("peer_b")).toBeNull();
  });

  it("builds peer entries with initialized lifecycle state", () => {
    const connection = buildConnection();
    const entry = createPeerEntry({
      connection,
      initiatorPeerId: "peer_a",
      nowMs: 1234
    });

    expect(entry).toMatchObject({
      connection,
      channel: null,
      initiatorPeerId: "peer_a",
      pendingCandidates: [],
      statsIntervalId: null,
      statsSnapshot: null,
      dataChannelState: null,
      createdAtMs: 1234,
      lastSignalProgressAtMs: 1234,
      reconnectAttempts: 0,
      reconnectTimerId: null,
      watchdogTimerId: null,
      sendQueue: [],
      releasing: false
    });
  });

  it("clears peer watchdog and reconnect timers", () => {
    const entry = createPeerEntry({
      connection: buildConnection(),
      initiatorPeerId: "peer_a",
      nowMs: 100
    });
    entry.watchdogTimerId = setTimeout(() => undefined, 1_000);
    entry.reconnectTimerId = setTimeout(() => undefined, 1_000);

    clearPeerTimers(entry);

    expect(entry.watchdogTimerId).toBeNull();
    expect(entry.reconnectTimerId).toBeNull();
  });

  it("classifies stalled and restartable peer entries", () => {
    const entry = createPeerEntry({
      connection: buildConnection({ connectionState: "connecting" }),
      initiatorPeerId: null,
      nowMs: 100
    });

    expect(
      isPeerStalled({
        entry,
        nowMs: 1_000,
        dataOpenTimeoutMs: 8_000,
        dataConnectingTimeoutMs: 12_000,
        connectionProgressTimeoutMs: 15_000
      })
    ).toBe(false);

    expect(
      isPeerStalled({
        entry,
        nowMs: 16_000,
        dataOpenTimeoutMs: 8_000,
        dataConnectingTimeoutMs: 12_000,
        connectionProgressTimeoutMs: 15_000
      })
    ).toBe(true);

    entry.channel = buildDataChannel("open");
    expect(
      shouldRestartPeer({
        entry,
        nowMs: 20_000,
        dataOpenTimeoutMs: 8_000,
        dataConnectingTimeoutMs: 12_000,
        connectionProgressTimeoutMs: 15_000
      })
    ).toBe(false);

    entry.channel = buildDataChannel("closed");
    expect(
      shouldRestartPeer({
        entry,
        nowMs: 20_000,
        dataOpenTimeoutMs: 8_000,
        dataConnectingTimeoutMs: 12_000,
        connectionProgressTimeoutMs: 15_000
      })
    ).toBe(true);
  });
});
