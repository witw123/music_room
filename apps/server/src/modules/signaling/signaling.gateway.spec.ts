import { SignalingGateway } from "./signaling.gateway";

type TestClient = {
  id: string;
  data: Record<string, unknown>;
  leave: jest.Mock;
};

type GatewayWithCleanup = {
  cleanupFailedRoomSubscribe: (
    client: TestClient,
    roomId: string,
    sessionId: string,
    peerId: string
  ) => Promise<void>;
};

describe("SignalingGateway subscription cleanup", () => {
  it("cleans every local and persisted presence artifact after a failed subscribe", async () => {
    const registry = {
      isActiveSessionSocket: jest.fn().mockReturnValue(true),
      cancelPendingDisconnectCleanup: jest.fn(),
      unregisterSessionSocket: jest.fn(),
      updatePeerPresence: jest.fn().mockResolvedValue(true)
    };
    const sessionLease = {
      belongsTo: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(undefined),
      invalidateSocket: jest.fn()
    };
    const peerSignals = {
      unregisterPeerSocket: jest.fn(),
      clearPendingPeerSignals: jest.fn(),
      clearRecoveryGeneration: jest.fn()
    };
    const readiness = { clearForSession: jest.fn() };
    const metrics = { unbindRealtimeSocket: jest.fn() };
    const client: TestClient = {
      id: "socket-1",
      data: {
        roomId: "room-1",
        sessionId: "session-1",
        peerId: "peer-1",
        sessionFenceToken: "fence-1",
        isRealtimeAuthenticated: true
      },
      leave: jest.fn()
    };
    const gateway = Object.assign(Object.create(SignalingGateway.prototype), {
      registry,
      sessionLease,
      peerSignals,
      readiness,
      metrics
    }) as GatewayWithCleanup;

    await gateway.cleanupFailedRoomSubscribe(client, "room-1", "session-1", "peer-1");

    expect(registry.updatePeerPresence).toHaveBeenCalledWith(
      "room-1",
      "session-1",
      null,
      "offline"
    );
    expect(sessionLease.release).toHaveBeenCalledWith(client);
    expect(readiness.clearForSession).toHaveBeenCalledWith(
      "room-1",
      "session-1",
      "peer-1"
    );
    expect(client.leave).toHaveBeenCalledWith("room-1");
    expect(client.data.isRealtimeAuthenticated).toBe(false);
    expect(client.data.roomId).toBeUndefined();
  });

  it("does not mark a replaced socket offline during failed subscribe cleanup", async () => {
    const registry = {
      isActiveSessionSocket: jest.fn().mockReturnValue(false),
      cancelPendingDisconnectCleanup: jest.fn(),
      unregisterSessionSocket: jest.fn(),
      updatePeerPresence: jest.fn().mockResolvedValue(true)
    };
    const client: TestClient = {
      id: "socket-old",
      data: {
        roomId: "room-1",
        sessionId: "session-1",
        peerId: "peer-1",
        sessionFenceToken: "old-fence"
      },
      leave: jest.fn()
    };
    const gateway = Object.assign(Object.create(SignalingGateway.prototype), {
      registry,
      sessionLease: {
        belongsTo: jest.fn().mockResolvedValue(false),
        release: jest.fn().mockResolvedValue(undefined),
        invalidateSocket: jest.fn()
      },
      peerSignals: {
        unregisterPeerSocket: jest.fn(),
        clearPendingPeerSignals: jest.fn(),
        clearRecoveryGeneration: jest.fn()
      },
      readiness: { clearForSession: jest.fn() },
      metrics: { unbindRealtimeSocket: jest.fn() }
    }) as GatewayWithCleanup;

    await gateway.cleanupFailedRoomSubscribe(client, "room-1", "session-1", "peer-1");

    expect(registry.updatePeerPresence).not.toHaveBeenCalled();
  });
});
