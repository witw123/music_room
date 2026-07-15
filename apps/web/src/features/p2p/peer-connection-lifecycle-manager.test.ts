import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeerSignalMessage } from "@music-room/shared";
import { SignalingTransport } from "./signaling-transport";
import { PeerConnectionLifecycleManager } from "./peer-connection-lifecycle-manager";
import type { PeerEntry } from "./peer-connection-registry";

class FakeDataChannel {
  readyState: RTCDataChannelState = "connecting";
  onclose: (() => void) | null = null;
  close = vi.fn(() => {
    this.readyState = "closed";
    this.onclose?.();
  });
}

class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = [];
  connectionState: RTCPeerConnectionState = "connected";
  iceConnectionState: RTCIceConnectionState = "checking";
  signalingState: RTCSignalingState = "stable";
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCLocalSessionDescriptionInit | null = null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;
  channel = new FakeDataChannel();
  mediaSender: {
    track: MediaStreamTrack | null;
    replaceTrack: ReturnType<typeof vi.fn>;
  } | null = null;

  constructor() {
    FakeRTCPeerConnection.instances.push(this);
  }

  createDataChannel() {
    return this.channel as unknown as RTCDataChannel;
  }

  addTransceiver() {
    this.mediaSender = {
      track: null,
      replaceTrack: vi.fn(async (track: MediaStreamTrack | null) => {
        this.mediaSender!.track = track;
      })
    };
    return {
      sender: this.mediaSender,
      setCodecPreferences: vi.fn()
    } as unknown as RTCRtpTransceiver;
  }

  async createOffer(options?: RTCOfferOptions) {
    this.signalingState = "have-local-offer";
    return {
      type: "offer" as const,
      sdp: options?.iceRestart ? "fake-restart-offer" : "fake-offer"
    };
  }

  async setLocalDescription(description?: RTCLocalSessionDescriptionInit) {
    this.localDescription = description ?? null;
  }

  close() {
    this.connectionState = "closed";
  }
}

function createManager(input: {
  localPeerId?: string;
  sendSignal?: (payload: unknown) => void;
  bindChannel?: (peerId: string, entry: PeerEntry, channel: RTCDataChannel) => void;
  clearPendingRequestsForPeer?: (peerId: string) => void;
} = {}) {
  const sendSignal = input.sendSignal ?? vi.fn();
  const signaling = new SignalingTransport({
    roomId: "room_1",
    localPeerId: input.localPeerId ?? "peer_a",
    sendSignal: sendSignal as (payload: PeerSignalMessage) => void
  });
  return {
    manager: new PeerConnectionLifecycleManager({
      localPeerId: input.localPeerId ?? "peer_a",
      autoReconnect: true,
      iceServers: [],
      signaling,
      bindChannel: input.bindChannel ?? vi.fn(),
      clearPendingRequestsForPeer: input.clearPendingRequestsForPeer ?? vi.fn()
    }),
    sendSignal
  };
}

describe("PeerConnectionLifecycleManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("RTCPeerConnection", FakeRTCPeerConnection);
    FakeRTCPeerConnection.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("syncs expected peers, initiates only lexically earlier peers, and binds data channels", async () => {
    const bindChannel = vi.fn();
    const { manager, sendSignal } = createManager({ bindChannel });

    await manager.syncPeers(["peer_b", "peer_a", ""]);

    expect(FakeRTCPeerConnection.instances).toHaveLength(2);
    expect(bindChannel).toHaveBeenCalledWith(
      "peer_b",
      expect.any(Object),
      FakeRTCPeerConnection.instances[0]!.channel
    );
    expect(sendSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "offer",
        toPeerId: "peer_b",
        payload: {
          type: "offer",
          sdp: "fake-offer"
        }
      })
    );
    expect(manager.getConnectedPeerIds()).toEqual([]);
  });

  it("restarts ICE through the current peer entry without recreating it", async () => {
    const { manager, sendSignal } = createManager();

    await manager.syncPeers(["peer_b"]);
    const firstPeer = FakeRTCPeerConnection.instances[0]!;
    firstPeer.signalingState = "stable";

    await manager.restartIce("peer_b");

    expect(FakeRTCPeerConnection.instances).toHaveLength(2);
    expect(firstPeer.localDescription).toEqual({
      type: "offer",
      sdp: "fake-restart-offer"
    });
    expect(sendSignal).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "offer",
        payload: {
          type: "offer",
          sdp: "fake-restart-offer"
        }
      })
    );
  });

  it("clears pending request state and closes peers on destroy", async () => {
    const clearPendingRequestsForPeer = vi.fn();
    const { manager } = createManager({ clearPendingRequestsForPeer });

    await manager.syncPeers(["peer_b"]);
    const peer = FakeRTCPeerConnection.instances[0]!;

    manager.destroy();

    expect(clearPendingRequestsForPeer).toHaveBeenCalledWith("peer_b");
    expect(peer.connectionState).toBe("closed");
    expect(manager.getPeerEntry("peer_b")).toBeNull();
  });

  it("publishes an already-playing source track with one initial media offer", async () => {
    const { manager, sendSignal } = createManager();
    const track = { id: "source-track", readyState: "live" } as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [track]
    } as unknown as MediaStream;

    manager.setLocalAudioStream(stream, "peer_a");
    await manager.syncPeers(["peer_b"]);

    const mediaPeer = FakeRTCPeerConnection.instances.find((entry) => entry.mediaSender);
    expect(mediaPeer?.mediaSender?.track).toBe(track);
    expect(
      (sendSignal as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((calls) => {
        const payload = calls[0] as PeerSignalMessage;
        return payload.linkKind === "media" && payload.type === "offer";
      }
      )
    ).toHaveLength(1);
  });

  it("retries a transient local track binding failure without recreating the peer", async () => {
    const { manager } = createManager();
    await manager.syncPeers(["peer_b"]);

    const mediaPeer = FakeRTCPeerConnection.instances.find((entry) => entry.mediaSender)!;
    mediaPeer.signalingState = "stable";
    mediaPeer.mediaSender!.replaceTrack.mockRejectedValueOnce(new Error("transient"));
    const track = { id: "source-track", readyState: "live" } as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [track]
    } as unknown as MediaStream;

    manager.setLocalAudioStream(stream, "peer_a");
    await vi.advanceTimersByTimeAsync(100);

    expect(mediaPeer.mediaSender!.replaceTrack).toHaveBeenCalledTimes(2);
    expect(mediaPeer.mediaSender!.track).toBe(track);
  });
});
