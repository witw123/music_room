import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeerSignalMessage } from "@music-room/shared";
import { SignalingTransport } from "./signaling-transport";
import { PeerConnectionLifecycleManager } from "./peer-connection-lifecycle-manager";
import type { PeerEntry } from "./peer-connection-registry";
import type { PeerConnectionStatsSample } from "./connection-stats";

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
    setStreams: ReturnType<typeof vi.fn>;
  } | null = null;
  mediaTransceiver: {
    sender: NonNullable<FakeRTCPeerConnection["mediaSender"]>;
    direction: RTCRtpTransceiverDirection;
    setCodecPreferences: ReturnType<typeof vi.fn>;
  } | null = null;

  constructor() {
    FakeRTCPeerConnection.instances.push(this);
  }

  createDataChannel() {
    return this.channel as unknown as RTCDataChannel;
  }

  addTransceiver(
    _kind: string,
    options?: { direction?: RTCRtpTransceiverDirection }
  ) {
    this.mediaSender = {
      track: null,
      replaceTrack: vi.fn(async (track: MediaStreamTrack | null) => {
        this.mediaSender!.track = track;
      }),
      setStreams: vi.fn()
    };
    this.mediaTransceiver = {
      sender: this.mediaSender,
      direction: options?.direction ?? "sendrecv",
      setCodecPreferences: vi.fn()
    };
    return this.mediaTransceiver as unknown as RTCRtpTransceiver;
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

  it("publishes a member source track even when the remote peer initiates first", async () => {
    const { manager, sendSignal } = createManager({ localPeerId: "peer_b" });
    await manager.syncPeers(["peer_a"]);

    const track = { id: "member-source-track", readyState: "live" } as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [track]
    } as unknown as MediaStream;
    manager.setLocalAudioStream(stream, "peer_b", 192);
    await vi.advanceTimersByTimeAsync(0);

    const mediaPeer = FakeRTCPeerConnection.instances.find((entry) => entry.mediaSender);
    expect(mediaPeer?.mediaSender?.track).toBe(track);
    expect(
      (sendSignal as unknown as { mock: { calls: unknown[][] } }).mock.calls.some(([value]) => {
        const payload = value as PeerSignalMessage;
        return payload.linkKind === "media" && payload.type === "offer";
      })
    ).toBe(true);
  });

  it("starts media negotiation from the source track instead of an empty listener offer", async () => {
    const { manager, sendSignal } = createManager();
    await manager.syncPeers(["peer_b"]);

    const mediaPeer = FakeRTCPeerConnection.instances.find((entry) => entry.mediaSender)!;
    expect(mediaPeer.mediaTransceiver?.direction).toBe("sendrecv");
    mediaPeer.signalingState = "stable";

    const track = { id: "source-track", readyState: "live" } as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [track]
    } as unknown as MediaStream;
    manager.setLocalAudioStream(stream, "peer_a");
    await vi.advanceTimersByTimeAsync(0);

    expect(mediaPeer.mediaTransceiver?.direction).toBe("sendrecv");
    expect(mediaPeer.mediaSender?.track).toBe(track);
    expect(mediaPeer.mediaSender?.setStreams).toHaveBeenCalledWith(stream);
    const mediaOffers = (sendSignal as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map(([payload]) => payload as PeerSignalMessage)
      .filter((payload) => payload.linkKind === "media" && payload.type === "offer");
    expect(mediaOffers).toHaveLength(1);
  });

  it("does not create an empty media offer during topology sync", async () => {
    const { manager, sendSignal } = createManager();

    await manager.syncPeers(["peer_b"]);

    const mediaOffers = (sendSignal as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map(([payload]) => payload as PeerSignalMessage)
      .filter((payload) => payload.linkKind === "media" && payload.type === "offer");
    expect(mediaOffers).toHaveLength(0);
  });

  it("binds the source track before answering an incoming media offer", async () => {
    const { manager } = createManager();
    const track = { id: "source-track", readyState: "live" } as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [track]
    } as unknown as MediaStream;
    manager.setLocalAudioStream(stream, "peer_a");

    const entry = await manager.getOrCreatePeerEntry("peer_b", "media");
    await manager.notifyRemoteDescriptionApplied("peer_b", entry, "offer");

    expect(entry.audioTransceiver?.direction).toBe("sendrecv");
    expect(entry.audioSender?.track).toBe(track);
    expect(entry.mediaNegotiationPending).toBe(false);
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

  it("does not renegotiate when an already-bound source media connection becomes connected", async () => {
    const { manager, sendSignal } = createManager();
    const track = { id: "source-track", readyState: "live" } as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [track]
    } as unknown as MediaStream;

    manager.setLocalAudioStream(stream, "peer_a");
    await manager.syncPeers(["peer_b"]);

    const mediaPeer = FakeRTCPeerConnection.instances.find((entry) => entry.mediaSender)!;
    mediaPeer.signalingState = "stable";
    mediaPeer.onconnectionstatechange?.();
    await vi.advanceTimersByTimeAsync(0);

    const mediaOffers = (sendSignal as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map(([payload]) => payload as PeerSignalMessage)
      .filter((payload) => payload.linkKind === "media" && payload.type === "offer");
    expect(mediaOffers).toHaveLength(1);
  });

  it("does not restart a local source for unknown or zero outbound bitrate samples", async () => {
    const { manager, sendSignal } = createManager();
    const track = { id: "source-track", readyState: "live" } as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [track]
    } as unknown as MediaStream;

    manager.setLocalAudioStream(stream, "peer_a");
    await manager.syncPeers(["peer_b"]);

    const mediaPeer = FakeRTCPeerConnection.instances.find((entry) => entry.mediaSender)!;
    const mediaEntry = manager.getPeerEntry("peer_b", "media")!;
    const observeMediaHealth = (manager as unknown as {
      observeMediaHealth: (peerId: string, sample: PeerConnectionStatsSample) => void;
    }).observeMediaHealth.bind(manager);
    const sample = {
      mediaReceiveBitrateKbps: null,
      mediaSendBitrateKbps: null,
      packetLossRate: null,
      jitterMs: null
    } as PeerConnectionStatsSample;

    observeMediaHealth("peer_b", sample);
    observeMediaHealth("peer_b", { ...sample, mediaSendBitrateKbps: 0 });
    observeMediaHealth("peer_b", { ...sample, mediaSendBitrateKbps: 0 });
    await vi.advanceTimersByTimeAsync(0);

    const mediaOffers = (sendSignal as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map(([payload]) => payload as PeerSignalMessage)
      .filter((payload) => payload.linkKind === "media" && payload.type === "offer");
    expect(mediaPeer.mediaSender?.track).toBe(track);
    expect(mediaEntry.senderTrackState).toBe("live");
    expect(mediaOffers).toHaveLength(1);
  });

  it("recreates a wedged source media peer after consecutive zero outbound samples", async () => {
    const { manager } = createManager();
    const track = { id: "source-track", readyState: "live" } as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [track]
    } as unknown as MediaStream;

    manager.setLocalAudioStream(stream, "peer_a");
    await manager.syncPeers(["peer_b"]);

    const initialMediaPeer = FakeRTCPeerConnection.instances.find((entry) => entry.mediaSender)!;
    initialMediaPeer.signalingState = "stable";
    await vi.advanceTimersByTimeAsync(0);
    const mediaEntry = manager.getPeerEntry("peer_b", "media")!;
    const observeMediaHealth = (manager as unknown as {
      observeMediaHealth: (peerId: string, sample: PeerConnectionStatsSample) => void;
    }).observeMediaHealth.bind(manager);
    const sample = {
      mediaReceiveBitrateKbps: null,
      mediaSendBitrateKbps: 0,
      packetLossRate: null,
      jitterMs: null
    } as PeerConnectionStatsSample;

    observeMediaHealth("peer_b", sample);
    observeMediaHealth("peer_b", sample);
    observeMediaHealth("peer_b", sample);
    await vi.advanceTimersByTimeAsync(0);

    expect(initialMediaPeer.connectionState).toBe("closed");
    expect(manager.getPeerEntry("peer_b", "media")).not.toBe(mediaEntry);
    expect(FakeRTCPeerConnection.instances.filter((entry) => entry.mediaSender)).toHaveLength(2);
  });

  it("restarts a connected listener media peer when its remote track never arrives", async () => {
    const { manager, sendSignal } = createManager();

    await manager.syncPeers(["peer_b"]);
    const mediaPeer = FakeRTCPeerConnection.instances.find((entry) => entry.mediaSender)!;
    mediaPeer.signalingState = "stable";
    manager.setLocalAudioStream(null, "peer_b");
    await vi.advanceTimersByTimeAsync(3_000);

    const mediaOffers = (sendSignal as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map(([payload]) => payload as PeerSignalMessage)
      .filter((payload) => payload.linkKind === "media" && payload.type === "offer");
    expect(mediaOffers).toHaveLength(0);
  });

  it("allows a forced media recovery to announce a replacement receiver peer", async () => {
    const { manager, sendSignal } = createManager();

    await manager.syncPeers(["peer_b"]);
    const mediaPeer = FakeRTCPeerConnection.instances.find((entry) => entry.mediaSender)!;
    mediaPeer.signalingState = "stable";
    await manager.restartMediaPeer("peer_b", { forceRecreate: true });

    const mediaOffers = (sendSignal as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map(([payload]) => payload as PeerSignalMessage)
      .filter((payload) => payload.linkKind === "media" && payload.type === "offer");
    expect(mediaOffers).toHaveLength(1);
  });
});
