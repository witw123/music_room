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

    expect(FakeRTCPeerConnection.instances).toHaveLength(1);
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

  it("keeps idle rooms on the data topology only", async () => {
    const { manager } = createManager();

    await manager.syncPeers(["peer_b", "peer_c"]);

    expect(manager.getPeerEntry("peer_b", "data")).not.toBeNull();
    expect(manager.getPeerEntry("peer_c", "data")).not.toBeNull();
    expect(manager.getPeerEntry("peer_b", "media")).toBeNull();
    expect(manager.getPeerEntry("peer_c", "media")).toBeNull();
    expect(FakeRTCPeerConnection.instances).toHaveLength(2);
  });

  it("connects a listener only to the current remote source", async () => {
    const { manager } = createManager();

    await manager.syncPeers(["peer_b", "peer_c"]);
    manager.setLocalAudioStream(null, "peer_c");
    await vi.advanceTimersByTimeAsync(0);

    expect(manager.getPeerEntry("peer_b", "media")).toBeNull();
    expect(manager.getPeerEntry("peer_c", "media")).not.toBeNull();
    expect(FakeRTCPeerConnection.instances.filter((entry) => entry.mediaSender)).toHaveLength(1);
  });

  it("fans out media from a local source while keeping one data link per member", async () => {
    const { manager } = createManager();
    const track = { id: "source-track", readyState: "live" } as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [track]
    } as unknown as MediaStream;

    manager.setLocalAudioStream(stream, "peer_a", 192);
    await manager.syncPeers(["peer_b", "peer_c", "peer_d"]);

    expect(FakeRTCPeerConnection.instances).toHaveLength(6);
    for (const peerId of ["peer_b", "peer_c", "peer_d"]) {
      expect(manager.getPeerEntry(peerId, "data")).not.toBeNull();
      expect(manager.getPeerEntry(peerId, "media")?.audioSender?.track).toBe(track);
    }
  });

  it("releases the old media fanout when the source changes", async () => {
    const { manager } = createManager();
    const track = { id: "source-track", readyState: "live" } as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [track]
    } as unknown as MediaStream;

    manager.setLocalAudioStream(stream, "peer_a", 192);
    await manager.syncPeers(["peer_b", "peer_c"]);
    const oldPeer = manager.getPeerEntry("peer_c", "media")!;

    manager.setLocalAudioStream(null, "peer_b");
    await vi.advanceTimersByTimeAsync(0);

    expect(manager.getPeerEntry("peer_b", "media")).not.toBeNull();
    expect(manager.getPeerEntry("peer_c", "media")).toBeNull();
    expect(oldPeer.connection.connectionState).toBe("closed");
  });

  it("restarts ICE through the current peer entry without recreating it", async () => {
    const { manager, sendSignal } = createManager();

    await manager.syncPeers(["peer_b"]);
    const firstPeer = FakeRTCPeerConnection.instances[0]!;
    firstPeer.signalingState = "stable";

    await manager.restartIce("peer_b");

    expect(FakeRTCPeerConnection.instances).toHaveLength(1);
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

  it("does not recreate a data peer after a queued topology removal", async () => {
    const { manager } = createManager();
    await manager.syncPeers(["peer_b"]);

    const removal = manager.syncPeers([]);
    const restart = manager.restartPeer("peer_b");
    await Promise.all([removal, restart]);

    expect(manager.getPeerEntry("peer_b", "data")).toBeNull();
    expect(FakeRTCPeerConnection.instances).toHaveLength(1);
  });

  it("does not recreate a removed peer when delayed signaling arrives", async () => {
    const { manager } = createManager();
    await manager.syncPeers(["peer_b"]);

    await manager.syncPeers([]);
    const delayedDataEntry = await manager.getOrCreateIncomingPeerEntry("peer_b", "data");
    const delayedMediaEntry = await manager.getOrCreateIncomingPeerEntry("peer_b", "media");

    expect(delayedDataEntry).toBeNull();
    expect(delayedMediaEntry).toBeNull();
    expect(manager.getPeerEntry("peer_b", "data")).toBeNull();
    expect(manager.getPeerEntry("peer_b", "media")).toBeNull();
    expect(FakeRTCPeerConnection.instances).toHaveLength(1);
  });

  it("does not admit a delayed media signal from a previous source", async () => {
    const { manager } = createManager();
    await manager.syncPeers(["peer_b", "peer_c"]);
    manager.setLocalAudioStream(null, "peer_b");
    await vi.advanceTimersByTimeAsync(0);
    expect(manager.getPeerEntry("peer_b", "media")).not.toBeNull();

    manager.setLocalAudioStream(null, "peer_c");
    const delayedMediaEntry = await manager.getOrCreateIncomingPeerEntry("peer_b", "media");

    expect(delayedMediaEntry).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(manager.getPeerEntry("peer_b", "media")).toBeNull();
    expect(manager.getPeerEntry("peer_c", "media")).not.toBeNull();
  });

  it("admits a source media offer before a late joiner knows the active source", async () => {
    const { manager } = createManager();
    const earlyMediaEntry = await manager.getOrCreateIncomingPeerEntry("peer_b", "media");

    expect(earlyMediaEntry).not.toBeNull();

    await manager.syncPeers(["peer_b"]);
    expect(manager.getPeerEntry("peer_b", "media")).toBe(earlyMediaEntry);

    manager.setLocalAudioStream(null, "peer_b");
    await vi.advanceTimersByTimeAsync(0);

    expect(manager.getPeerEntry("peer_b", "media")).toBe(earlyMediaEntry);
  });

  it("releases an unconfirmed early media admission after the source grace period", async () => {
    const { manager } = createManager();
    await manager.getOrCreateIncomingPeerEntry("peer_b", "media");
    await manager.syncPeers(["peer_b"]);

    await vi.advanceTimersByTimeAsync(8_000);

    expect(manager.getPeerEntry("peer_b", "media")).toBeNull();
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

    expect(FakeRTCPeerConnection.instances.find((entry) => entry.mediaSender)).toBeUndefined();

    const track = { id: "source-track", readyState: "live" } as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [track]
    } as unknown as MediaStream;
    manager.setLocalAudioStream(stream, "peer_a");
    await vi.advanceTimersByTimeAsync(0);

    const mediaPeer = FakeRTCPeerConnection.instances.find((entry) => entry.mediaSender)!;
    expect(mediaPeer.mediaTransceiver?.direction).toBe("sendrecv");
    mediaPeer.signalingState = "stable";

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
    await manager.syncPeers(["peer_b"]);
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

    const initialTrack = { id: "initial-source-track", readyState: "live" } as MediaStreamTrack;
    const initialStream = {
      getAudioTracks: () => [initialTrack]
    } as unknown as MediaStream;
    manager.setLocalAudioStream(initialStream, "peer_a");
    await vi.advanceTimersByTimeAsync(0);

    const mediaPeer = FakeRTCPeerConnection.instances.find((entry) => entry.mediaSender)!;
    mediaPeer.signalingState = "stable";
    mediaPeer.mediaSender!.replaceTrack.mockClear();
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
    observeMediaHealth("peer_b", sample);
    await vi.advanceTimersByTimeAsync(0);

    expect(initialMediaPeer.connectionState).toBe("closed");
    expect(manager.getPeerEntry("peer_b", "media")).not.toBe(mediaEntry);
    expect(FakeRTCPeerConnection.instances.filter((entry) => entry.mediaSender)).toHaveLength(2);
  });

  it("actively reoffers a connected listener media peer when its remote track never arrives", async () => {
    const { manager, sendSignal } = createManager();

    await manager.syncPeers(["peer_b"]);
    manager.setLocalAudioStream(null, "peer_b");
    await vi.advanceTimersByTimeAsync(0);
    const mediaPeer = FakeRTCPeerConnection.instances.find((entry) => entry.mediaSender)!;
    mediaPeer.signalingState = "stable";
    await vi.advanceTimersByTimeAsync(3_000);

    const mediaOffers = (sendSignal as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map(([payload]) => payload as PeerSignalMessage)
      .filter((payload) => payload.linkKind === "media" && payload.type === "offer");
    expect(mediaOffers).toHaveLength(1);
  });

  it("actively reoffers after a connected listener loses receiver packets", async () => {
    const { manager, sendSignal } = createManager();

    await manager.syncPeers(["peer_b"]);
    manager.setLocalAudioStream(null, "peer_b");
    await vi.advanceTimersByTimeAsync(0);
    const mediaPeer = FakeRTCPeerConnection.instances.find((entry) => entry.mediaSender)!;
    const mediaEntry = manager.getPeerEntry("peer_b", "media")!;
    mediaPeer.signalingState = "stable";
    mediaEntry.receiverTrackState = "live";
    mediaEntry.receiverRtpActive = false;

    await vi.advanceTimersByTimeAsync(3_000);
    await manager.restartMediaPeer("peer_b");

    expect(mediaPeer.connectionState).toBe("closed");
    const mediaOffers = (sendSignal as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map(([payload]) => payload as PeerSignalMessage)
      .filter((payload) => payload.linkKind === "media" && payload.type === "offer");
    expect(mediaOffers).toHaveLength(1);
  });

  it("allows a forced media recovery to announce a replacement receiver peer", async () => {
    const { manager, sendSignal } = createManager();

    await manager.syncPeers(["peer_b"]);
    manager.setLocalAudioStream(null, "peer_b");
    await vi.advanceTimersByTimeAsync(0);
    const mediaPeer = FakeRTCPeerConnection.instances.find((entry) => entry.mediaSender)!;
    mediaPeer.signalingState = "stable";
    await manager.restartMediaPeer("peer_b", { forceRecreate: true });

    const mediaOffers = (sendSignal as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map(([payload]) => payload as PeerSignalMessage)
      .filter((payload) => payload.linkKind === "media" && payload.type === "offer");
    expect(mediaOffers).toHaveLength(1);
  });

  it("serializes concurrent media recovery requests for one peer", async () => {
    const { manager } = createManager();

    await manager.syncPeers(["peer_b"]);
    manager.setLocalAudioStream(null, "peer_b");
    await vi.advanceTimersByTimeAsync(0);
    const initialMediaPeer = FakeRTCPeerConnection.instances.find((entry) => entry.mediaSender)!;

    const first = manager.restartMediaPeer("peer_b", { forceRecreate: true });
    const second = manager.restartMediaPeer("peer_b", { forceRecreate: true });
    await Promise.all([first, second]);

    expect(initialMediaPeer.connectionState).toBe("closed");
    expect(FakeRTCPeerConnection.instances.filter((entry) => entry.mediaSender)).toHaveLength(2);
  });

  it("restores a failed receiver state when RTP resumes", async () => {
    const { manager } = createManager();

    await manager.syncPeers(["peer_b"]);
    manager.setLocalAudioStream(null, "peer_b");
    await vi.advanceTimersByTimeAsync(0);

    const entry = manager.getPeerEntry("peer_b", "media")!;
    const track = {
      kind: "audio",
      id: "resumed-track",
      readyState: "live"
    } as MediaStreamTrack;
    entry.audioReceiver = { track } as unknown as RTCRtpReceiver;
    entry.remoteAudioStream = { getAudioTracks: () => [track] } as unknown as MediaStream;
    entry.remoteAudioTrackId = track.id;
    entry.receiverTrackState = "failed";
    entry.receiverRtpActive = false;

    const observeMediaHealth = (manager as unknown as {
      observeMediaHealth: (peerId: string, sample: PeerConnectionStatsSample) => void;
    }).observeMediaHealth.bind(manager);
    observeMediaHealth("peer_b", {
      mediaReceiveBitrateKbps: 261,
      mediaSendBitrateKbps: null,
      packetLossRate: 0,
      jitterMs: 2
    } as PeerConnectionStatsSample);

    expect(entry.receiverTrackState).toBe("live");
    expect(entry.receiverRtpActive).toBe(true);
  });

  it("requires consecutive positive media windows before clearing recovery history", async () => {
    const { manager } = createManager();

    await manager.syncPeers(["peer_b"]);
    manager.setLocalAudioStream(null, "peer_b");
    await vi.advanceTimersByTimeAsync(0);
    manager.getPeerEntry("peer_b", "media")!.receiverTrackState = "live";

    const internals = manager as unknown as {
      observeMediaHealth: (peerId: string, sample: PeerConnectionStatsSample) => void;
      mediaRecovery: Map<string, { positiveMediaWindows: number }>;
    };
    const observeMediaHealth = internals.observeMediaHealth.bind(manager);
    const positiveSample = {
      mediaReceiveBitrateKbps: null,
      mediaSendBitrateKbps: 96,
      packetLossRate: 0,
      jitterMs: 2
    } as PeerConnectionStatsSample;
    const emptySample = {
      ...positiveSample,
      mediaSendBitrateKbps: 0
    };

    observeMediaHealth("peer_b", positiveSample);
    expect(internals.mediaRecovery.get("peer_b")?.positiveMediaWindows).toBe(1);
    observeMediaHealth("peer_b", emptySample);
    expect(internals.mediaRecovery.get("peer_b")?.positiveMediaWindows).toBe(0);
    observeMediaHealth("peer_b", positiveSample);
    observeMediaHealth("peer_b", positiveSample);
    expect(internals.mediaRecovery.get("peer_b")?.positiveMediaWindows).toBe(2);
  });

  it("does not clear recovery history while packet loss remains high", async () => {
    const { manager } = createManager();

    await manager.syncPeers(["peer_b"]);
    manager.setLocalAudioStream(null, "peer_b");
    await vi.advanceTimersByTimeAsync(0);
    const entry = manager.getPeerEntry("peer_b", "media")!;
    entry.receiverTrackState = "live";
    entry.receiverRtpActive = true;

    const internals = manager as unknown as {
      observeMediaHealth: (peerId: string, sample: PeerConnectionStatsSample) => void;
      mediaRecovery: Map<string, {
        highLossWindows: number;
        positiveMediaWindows: number;
      }>;
    };
    const observeMediaHealth = internals.observeMediaHealth.bind(manager);
    const degradedSample = {
      mediaReceiveBitrateKbps: 128,
      mediaSendBitrateKbps: null,
      packetLossRate: 8,
      jitterMs: 4
    } as PeerConnectionStatsSample;

    observeMediaHealth("peer_b", degradedSample);
    observeMediaHealth("peer_b", degradedSample);
    entry.connection.onconnectionstatechange?.(new Event("connectionstatechange"));

    expect(internals.mediaRecovery.get("peer_b")?.highLossWindows).toBeGreaterThan(0);
    expect(internals.mediaRecovery.get("peer_b")?.positiveMediaWindows).toBe(0);
  });

  it("does not let a stale media sample report receiver RTP as active", async () => {
    const { manager } = createManager();

    await manager.syncPeers(["peer_b"]);
    manager.setLocalAudioStream(null, "peer_b");
    await vi.advanceTimersByTimeAsync(0);
    const entry = manager.getPeerEntry("peer_b", "media")!;
    entry.receiverRtpActive = false;
    (manager as unknown as {
      latestMediaSamples: Map<string, PeerConnectionStatsSample>;
    }).latestMediaSamples.set("peer_b", {
      mediaReceiveBitrateKbps: 261
    } as PeerConnectionStatsSample);

    expect(manager.getPeerMediaState("peer_b")?.receiverRtpActive).toBe(false);
  });

  it("does not let receiver-track discovery mask a zero RTP window", async () => {
    const { manager } = createManager();

    await manager.syncPeers(["peer_b"]);
    manager.setLocalAudioStream(null, "peer_b");
    await vi.advanceTimersByTimeAsync(0);
    const entry = manager.getPeerEntry("peer_b", "media")!;
    const track = {
      kind: "audio",
      id: "known-track",
      readyState: "live",
      muted: false
    } as unknown as MediaStreamTrack;
    entry.audioReceiver = { track } as unknown as RTCRtpReceiver;
    entry.remoteAudioStream = { getAudioTracks: () => [track] } as unknown as MediaStream;
    entry.remoteAudioTrackId = track.id;
    entry.receiverTrackState = "live";
    entry.receiverRtpActive = false;

    expect(manager.getPeerMediaState("peer_b")?.receiverRtpActive).toBe(false);
  });
});
