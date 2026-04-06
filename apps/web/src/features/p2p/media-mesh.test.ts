import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeerSignalMessage } from "@music-room/shared";
import {
  RoomMediaMesh,
  resolvePreferredAudioMaxBitrateBps,
  resolvePreferredReceiverJitterTargetMs
} from "./media-mesh";

class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = [];
  static senders: Array<{
    replaceTrack: ReturnType<typeof vi.fn>;
    getParameters: ReturnType<typeof vi.fn>;
    setParameters: ReturnType<typeof vi.fn>;
    track: MediaStreamTrack | null;
  }> = [];
  static transceivers: Array<{
    receiver: {
      jitterBufferTarget?: number;
    };
    setCodecPreferences: ReturnType<typeof vi.fn>;
  }> = [];
  static nextReplaceTrackPromise: Promise<void> | null = null;
  static nextRemoteDescriptionError: Error | null = null;

  connectionState: RTCPeerConnectionState = "new";
  signalingState: RTCSignalingState = "stable";
  localDescriptions: Array<RTCSessionDescriptionInit | null | undefined> = [];
  remoteDescriptions: RTCSessionDescriptionInit[] = [];
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  closed = false;
  addTransceiver = vi.fn(() => {
    const transceiver = {
      receiver: {
        jitterBufferTarget: undefined as number | undefined
      },
      setCodecPreferences: vi.fn()
    };
    FakeRTCPeerConnection.transceivers.push(transceiver);
    return transceiver as unknown as RTCRtpTransceiver;
  });

  constructor() {
    FakeRTCPeerConnection.instances.push(this);
  }

  addTrack(track: MediaStreamTrack | null) {
    const sender = {
      track,
      replaceTrack: vi.fn(async (nextTrack: MediaStreamTrack | null) => {
        if (FakeRTCPeerConnection.nextReplaceTrackPromise) {
          await FakeRTCPeerConnection.nextReplaceTrackPromise;
          FakeRTCPeerConnection.nextReplaceTrackPromise = null;
        }
        sender.track = nextTrack;
      }),
      getParameters: vi.fn(() => ({})),
      setParameters: vi.fn(async () => undefined)
    };
    FakeRTCPeerConnection.senders.push(sender);
    return sender as unknown as RTCRtpSender;
  }

  async createOffer() {
    this.signalingState = "have-local-offer";
    return { type: "offer" as const, sdp: "fake-offer" };
  }

  async setLocalDescription(description?: RTCSessionDescriptionInit | null) {
    this.localDescriptions.push(description);
    if (description?.type === "offer") {
      this.signalingState = "have-local-offer";
    }

    if (description?.type === "answer") {
      this.signalingState = "stable";
    }

    if (description?.type === "rollback") {
      this.signalingState = "stable";
    }
  }

  async createAnswer() {
    return { type: "answer" as const, sdp: "fake-answer" };
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    if (description.type === "answer" && FakeRTCPeerConnection.nextRemoteDescriptionError) {
      const error = FakeRTCPeerConnection.nextRemoteDescriptionError;
      FakeRTCPeerConnection.nextRemoteDescriptionError = null;
      throw error;
    }
    this.remoteDescriptions.push(description);
    if (description.type === "offer") {
      this.signalingState = "have-remote-offer";
      return;
    }

    if (description.type === "answer") {
      this.signalingState = "stable";
    }
  }

  async addIceCandidate() {
    return undefined;
  }

  close() {
    this.closed = true;
    this.connectionState = "closed";
    this.onconnectionstatechange?.();
  }
}

function buildOffer(fromPeerId: string, mediaEpoch: number): PeerSignalMessage {
  return {
    roomId: "room_1",
    fromPeerId,
    toPeerId: "peer_listener",
    channelKind: "media",
    mediaEpoch,
    type: "offer",
    payload: {
      type: "offer",
      sdp: `offer-${fromPeerId}-${mediaEpoch}`
    }
  };
}

describe("RoomMediaMesh", () => {
  beforeEach(() => {
    FakeRTCPeerConnection.instances = [];
    FakeRTCPeerConnection.senders = [];
    FakeRTCPeerConnection.transceivers = [];
    FakeRTCPeerConnection.nextReplaceTrackPromise = null;
    FakeRTCPeerConnection.nextRemoteDescriptionError = null;
    vi.stubGlobal("RTCPeerConnection", FakeRTCPeerConnection);
    vi.stubGlobal("RTCRtpReceiver", {
      getCapabilities: vi.fn(() => ({
        codecs: [
          { mimeType: "audio/opus" },
          { mimeType: "audio/PCMU" }
        ]
      }))
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a newer media epoch and tears down the previous peer session", async () => {
    const sendSignal = vi.fn();
    const onRemoteStream = vi.fn();
    const mesh = new RoomMediaMesh("room_1", "peer_listener", sendSignal, [], {
      onRemoteStream
    });

    await mesh.handleSignal(buildOffer("peer_source_a", 0));
    expect(sendSignal).toHaveBeenCalledTimes(1);
    expect(sendSignal.mock.calls[0]?.[0]).toMatchObject({
      type: "answer",
      toPeerId: "peer_source_a",
      mediaEpoch: 0
    });

    const firstPeer = FakeRTCPeerConnection.instances[0];
    expect(firstPeer?.closed).toBe(false);
    expect(firstPeer?.addTransceiver).toHaveBeenCalledWith("audio", {
      direction: "recvonly"
    });
    expect(FakeRTCPeerConnection.transceivers[0]?.setCodecPreferences).toHaveBeenCalledTimes(1);

    await mesh.handleSignal(buildOffer("peer_source_b", 1));

    expect(firstPeer?.closed).toBe(true);
    expect(sendSignal).toHaveBeenCalledTimes(2);
    expect(sendSignal.mock.calls[1]?.[0]).toMatchObject({
      type: "answer",
      toPeerId: "peer_source_b",
      mediaEpoch: 1
    });
    expect(onRemoteStream).toHaveBeenCalledWith(null);
  });

  it("releases failed peer connections so they can be renegotiated", async () => {
    const sendSignal = vi.fn();
    const mesh = new RoomMediaMesh("room_1", "peer_source", sendSignal, [], {
      onRemoteStream: vi.fn()
    });
    const stream = {
      getAudioTracks: () => [{ id: "track_1" }]
    } as unknown as MediaStream;

    await mesh.syncHostPeers(["peer_listener"], stream, 1);

    const firstPeer = FakeRTCPeerConnection.instances[0];
    expect(firstPeer).toBeDefined();
    expect(sendSignal).toHaveBeenCalledTimes(1);

    firstPeer!.connectionState = "failed";
    firstPeer!.onconnectionstatechange?.();
    expect(firstPeer!.closed).toBe(true);

    await mesh.syncHostPeers(["peer_listener"], stream, 1);

    expect(FakeRTCPeerConnection.instances).toHaveLength(2);
    expect(sendSignal).toHaveBeenCalledTimes(2);
  });

  it("can proactively restart a recvonly listener peer and send a fresh offer", async () => {
    const sendSignal = vi.fn();
    const mesh = new RoomMediaMesh("room_1", "peer_listener", sendSignal, [], {
      onRemoteStream: vi.fn()
    });

    await mesh.handleSignal(buildOffer("peer_source_a", 1));
    expect(sendSignal).toHaveBeenCalledTimes(1);
    expect(sendSignal.mock.calls[0]?.[0]).toMatchObject({
      type: "answer",
      toPeerId: "peer_source_a",
      mediaEpoch: 1
    });

    await mesh.restartPeer("peer_source_a");

    expect(FakeRTCPeerConnection.instances).toHaveLength(2);
    expect(sendSignal).toHaveBeenCalledTimes(2);
    expect(sendSignal.mock.calls[1]?.[0]).toMatchObject({
      type: "offer",
      toPeerId: "peer_source_a",
      mediaEpoch: 1
    });
  });

  it("can restart ICE on an existing listener peer without recreating it", async () => {
    const sendSignal = vi.fn();
    const mesh = new RoomMediaMesh("room_1", "peer_listener", sendSignal, [], {
      onRemoteStream: vi.fn()
    });

    await mesh.handleSignal(buildOffer("peer_source_a", 1));
    sendSignal.mockClear();

    await mesh.restartIce("peer_source_a");

    expect(FakeRTCPeerConnection.instances).toHaveLength(1);
    expect(sendSignal).toHaveBeenCalledTimes(1);
    expect(sendSignal.mock.calls[0]?.[0]).toMatchObject({
      type: "offer",
      toPeerId: "peer_source_a",
      mediaEpoch: 1
    });
  });

  it("attaches the latest host audio track before answering a listener-initiated offer", async () => {
    const sendSignal = vi.fn();
    const mesh = new RoomMediaMesh("room_1", "peer_source", sendSignal, [], {
      onRemoteStream: vi.fn()
    });
    const stream = {
      getAudioTracks: () => [{ id: "track_live" }]
    } as unknown as MediaStream;

    await mesh.syncHostPeers([], stream, 2);
    await mesh.handleSignal({
      roomId: "room_1",
      fromPeerId: "peer_listener",
      toPeerId: "peer_source",
      channelKind: "media",
      mediaEpoch: 2,
      type: "offer",
      payload: {
        type: "offer",
        sdp: "listener-offer"
      }
    });

    expect(FakeRTCPeerConnection.senders).toHaveLength(1);
    expect(FakeRTCPeerConnection.senders[0]?.track).toMatchObject({ id: "track_live" });
    expect(sendSignal).toHaveBeenCalledTimes(1);
    expect(sendSignal.mock.calls[0]?.[0]).toMatchObject({
      type: "answer",
      toPeerId: "peer_listener",
      mediaEpoch: 2
    });
  });

  it("waits for replaceTrack to finish before answering after a host-side track switch", async () => {
    const sendSignal = vi.fn();
    const mesh = new RoomMediaMesh("room_1", "peer_source", sendSignal, [], {
      onRemoteStream: vi.fn()
    });
    const initialTrack = { id: "track_initial" } as MediaStreamTrack;
    const switchedTrack = { id: "track_switched" } as MediaStreamTrack;
    const initialStream = {
      getAudioTracks: () => [initialTrack]
    } as unknown as MediaStream;
    const switchedStream = {
      getAudioTracks: () => [switchedTrack]
    } as unknown as MediaStream;

    await mesh.syncHostPeers([], initialStream, 2);
    await mesh.handleSignal({
      roomId: "room_1",
      fromPeerId: "peer_listener",
      toPeerId: "peer_source",
      channelKind: "media",
      mediaEpoch: 2,
      type: "offer",
      payload: {
        type: "offer",
        sdp: "listener-offer-before-switch"
      }
    });
    sendSignal.mockClear();
    (mesh as unknown as { latestLocalStream: MediaStream | null }).latestLocalStream = switchedStream;

    let resolveReplaceTrack!: () => void;
    FakeRTCPeerConnection.nextReplaceTrackPromise = new Promise<void>((resolve) => {
      resolveReplaceTrack = resolve;
    });

    const pendingAnswer = mesh.handleSignal({
      roomId: "room_1",
      fromPeerId: "peer_listener",
      toPeerId: "peer_source",
      channelKind: "media",
      mediaEpoch: 2,
      type: "offer",
      payload: {
        type: "offer",
        sdp: "listener-offer-after-track-switch"
      }
    });

    await Promise.resolve();
    expect(sendSignal).not.toHaveBeenCalled();

    resolveReplaceTrack();
    await pendingAnswer;

    expect(FakeRTCPeerConnection.senders[0]?.track).toMatchObject({ id: "track_switched" });
    expect(sendSignal).toHaveBeenCalledTimes(1);
    expect(sendSignal.mock.calls[0]?.[0]).toMatchObject({
      type: "answer",
      toPeerId: "peer_listener",
      mediaEpoch: 2
    });
  });

  it("rolls back a polite listener peer before accepting a colliding offer", async () => {
    const sendSignal = vi.fn();
    const mesh = new RoomMediaMesh("room_1", "peer_listener", sendSignal, [], {
      onRemoteStream: vi.fn()
    });

    await mesh.handleSignal(buildOffer("peer_source_a", 1));
    await mesh.restartPeer("peer_source_a");
    sendSignal.mockClear();

    const collisionPeer = FakeRTCPeerConnection.instances[1];
    expect(collisionPeer?.signalingState).toBe("have-local-offer");

    await mesh.handleSignal(buildOffer("peer_source_a", 1));

    expect(collisionPeer?.localDescriptions.some((description) => description?.type === "rollback")).toBe(true);
    expect(sendSignal).toHaveBeenCalledTimes(1);
    expect(sendSignal.mock.calls[0]?.[0]).toMatchObject({
      type: "answer",
      toPeerId: "peer_source_a",
      mediaEpoch: 1
    });
  });

  it("ignores a colliding offer on an impolite source peer", async () => {
    const sendSignal = vi.fn();
    const mesh = new RoomMediaMesh("room_1", "peer_source", sendSignal, [], {
      onRemoteStream: vi.fn()
    });
    const stream = {
      getAudioTracks: () => [{ id: "track_live" }]
    } as unknown as MediaStream;

    await mesh.syncHostPeers(["peer_listener"], stream, 1);
    sendSignal.mockClear();

    const sourcePeer = FakeRTCPeerConnection.instances[0];
    expect(sourcePeer?.signalingState).toBe("have-local-offer");

    await mesh.handleSignal({
      roomId: "room_1",
      fromPeerId: "peer_listener",
      toPeerId: "peer_source",
      channelKind: "media",
      mediaEpoch: 1,
      type: "offer",
      payload: {
        type: "offer",
        sdp: "colliding-offer"
      }
    });

    expect(sourcePeer?.remoteDescriptions).toHaveLength(0);
    expect(sendSignal).toHaveBeenCalledTimes(0);
  });

  it("flushes a pending restart after the current offer/answer round stabilizes", async () => {
    const sendSignal = vi.fn();
    const mesh = new RoomMediaMesh("room_1", "peer_source", sendSignal, [], {
      onRemoteStream: vi.fn()
    });
    const initialTrack = { id: "track_initial" } as MediaStreamTrack;
    const switchedTrack = { id: "track_switched" } as MediaStreamTrack;
    const initialStream = {
      getAudioTracks: () => [initialTrack]
    } as unknown as MediaStream;
    const switchedStream = {
      getAudioTracks: () => [switchedTrack]
    } as unknown as MediaStream;

    await mesh.syncHostPeers(["peer_listener"], initialStream, 1);
    expect(sendSignal).toHaveBeenCalledTimes(1);

    await mesh.updateLocalStream(switchedStream);
    expect(sendSignal).toHaveBeenCalledTimes(1);

    await mesh.handleSignal({
      roomId: "room_1",
      fromPeerId: "peer_listener",
      toPeerId: "peer_source",
      channelKind: "media",
      mediaEpoch: 1,
      type: "answer",
      payload: {
        type: "answer",
        sdp: "listener-answer"
      }
    });

    expect(sendSignal).toHaveBeenCalledTimes(2);
    expect(sendSignal.mock.calls[1]?.[0]).toMatchObject({
      type: "offer",
      toPeerId: "peer_listener",
      mediaEpoch: 1
    });
    expect(FakeRTCPeerConnection.senders[0]?.track).toMatchObject({ id: "track_switched" });
  });

  it("ignores a stale media answer once the peer has already returned to stable", async () => {
    const sendSignal = vi.fn();
    const mesh = new RoomMediaMesh("room_1", "peer_source", sendSignal, [], {
      onRemoteStream: vi.fn()
    });
    const stream = {
      getAudioTracks: () => [{ id: "track_live" }]
    } as unknown as MediaStream;

    await mesh.syncHostPeers(["peer_listener"], stream, 1);
    const peer = FakeRTCPeerConnection.instances[0]!;
    expect(peer.signalingState).toBe("have-local-offer");

    peer.signalingState = "stable";
    FakeRTCPeerConnection.nextRemoteDescriptionError = new Error(
      "Failed to set remote answer sdp: Called in wrong state: stable"
    );

    await expect(
      mesh.handleSignal({
        roomId: "room_1",
        fromPeerId: "peer_listener",
        toPeerId: "peer_source",
        channelKind: "media",
        mediaEpoch: 1,
        type: "answer",
        payload: {
          type: "answer",
          sdp: "stale-answer"
        }
      })
    ).resolves.toBeUndefined();
  });

  it("does not tear down peers on transient disconnected state", async () => {
    const sendSignal = vi.fn();
    const mesh = new RoomMediaMesh("room_1", "peer_source", sendSignal, [], {
      onRemoteStream: vi.fn()
    });
    const stream = {
      getAudioTracks: () => [{ id: "track_1" }]
    } as unknown as MediaStream;

    await mesh.syncHostPeers(["peer_listener"], stream, 1);

    const firstPeer = FakeRTCPeerConnection.instances[0];
    firstPeer!.connectionState = "disconnected";
    firstPeer!.onconnectionstatechange?.();

    expect(firstPeer!.closed).toBe(false);

    await mesh.syncHostPeers(["peer_listener"], stream, 1);

    expect(FakeRTCPeerConnection.instances).toHaveLength(1);
  });

  it("renegotiates when audio tracks become available after the first sync", async () => {
    const sendSignal = vi.fn();
    const mesh = new RoomMediaMesh("room_1", "peer_source", sendSignal, [], {
      onRemoteStream: vi.fn()
    });
    const emptyStream = {
      getAudioTracks: () => []
    } as unknown as MediaStream;
    const liveStream = {
      getAudioTracks: () => [{ id: "track_live" }]
    } as unknown as MediaStream;

    await mesh.syncHostPeers(["peer_listener"], emptyStream, 1);
    expect(sendSignal).toHaveBeenCalledTimes(0);

    const firstPeer = FakeRTCPeerConnection.instances[0];
    expect(firstPeer?.addTransceiver).not.toHaveBeenCalled();

    await mesh.syncHostPeers(["peer_listener"], liveStream, 1);
    expect(sendSignal).toHaveBeenCalledTimes(1);
    expect(sendSignal.mock.calls[0]?.[0]).toMatchObject({
      type: "offer",
      toPeerId: "peer_listener",
      mediaEpoch: 1
    });
  });

  it("attaches a track when the same stream object gains audio later", async () => {
    const sendSignal = vi.fn();
    const mesh = new RoomMediaMesh("room_1", "peer_source", sendSignal, [], {
      onRemoteStream: vi.fn()
    });
    const liveTrack = { id: "track_live" } as MediaStreamTrack;
    let audioTracks: MediaStreamTrack[] = [];
    const stream = {
      getAudioTracks: () => audioTracks
    } as unknown as MediaStream;

    await mesh.syncHostPeers(["peer_listener"], stream, 1);
    expect(sendSignal).toHaveBeenCalledTimes(0);

    audioTracks = [liveTrack];
    await mesh.syncHostPeers(["peer_listener"], stream, 1);

    expect(sendSignal).toHaveBeenCalledTimes(1);
    expect(sendSignal.mock.calls[0]?.[0]).toMatchObject({
      type: "offer",
      toPeerId: "peer_listener",
      mediaEpoch: 1
    });
  });

  it("configures outgoing audio senders for music bootstrap stability", async () => {
    const sendSignal = vi.fn();
    const mesh = new RoomMediaMesh("room_1", "peer_source", sendSignal, [], {
      onRemoteStream: vi.fn()
    });
    const liveTrack = {
      id: "track_live",
      contentHint: ""
    } as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [liveTrack]
    } as unknown as MediaStream;

    await mesh.syncHostPeers(["peer_listener"], stream, 1);

    const sender = FakeRTCPeerConnection.senders[0];
    expect(sender).toBeDefined();
    expect(liveTrack.contentHint).toBe("music");
    expect(sender?.setParameters).toHaveBeenCalledWith({
      encodings: [{ maxBitrate: 320_000 }]
    });
  });

  it("keeps healthy relay tcp links above the old 144kbps cap", () => {
    expect(
      resolvePreferredAudioMaxBitrateBps({
        candidateType: "relay",
        protocol: "tcp",
        currentRoundTripTimeMs: 70,
        availableOutgoingBitrateKbps: 420,
        mediaReceiveBitrateKbps: null,
        mediaSendBitrateKbps: null,
        packetLossRate: 1.4,
        packetsLost: 12,
        jitterMs: 3
      })
    ).toBe(256_000);
  });

  it("reduces sender bitrate against measured headroom on constrained relay tcp links", () => {
    expect(
      resolvePreferredAudioMaxBitrateBps({
        candidateType: "relay",
        protocol: "tcp",
        currentRoundTripTimeMs: 70,
        availableOutgoingBitrateKbps: 148,
        mediaReceiveBitrateKbps: null,
        mediaSendBitrateKbps: null,
        packetLossRate: 1.4,
        packetsLost: 104,
        jitterMs: 3
      })
    ).toBe(133_200);
  });

  it("caps sender bitrate to measured headroom on weak links", () => {
    expect(
      resolvePreferredAudioMaxBitrateBps({
        candidateType: "relay",
        protocol: "tcp",
        currentRoundTripTimeMs: 90,
        availableOutgoingBitrateKbps: 90,
        mediaReceiveBitrateKbps: null,
        mediaSendBitrateKbps: null,
        packetLossRate: 2.6,
        packetsLost: 20,
        jitterMs: 4
      })
    ).toBe(96_000);
  });

  it("prefers a stronger receiver jitter target on constrained links", () => {
    expect(
      resolvePreferredReceiverJitterTargetMs({
        candidateType: "relay",
        protocol: "tcp",
        currentRoundTripTimeMs: 62,
        availableOutgoingBitrateKbps: 220,
        mediaReceiveBitrateKbps: null,
        mediaSendBitrateKbps: 65,
        packetLossRate: 1.2,
        packetsLost: 0,
        jitterMs: 4
      })
    ).toBe(220);
  });

  it("prefers the strongest receiver jitter target on weak links", () => {
    expect(
      resolvePreferredReceiverJitterTargetMs({
        candidateType: "host",
        protocol: "udp",
        currentRoundTripTimeMs: 210,
        availableOutgoingBitrateKbps: 320,
        mediaReceiveBitrateKbps: 128,
        mediaSendBitrateKbps: 96,
        packetLossRate: 8.5,
        packetsLost: 120,
        jitterMs: 34
      })
    ).toBe(320);
  });

  it("does not keep audio in weak-link mode on high cumulative loss when the short window is healthy", () => {
    expect(
      resolvePreferredAudioMaxBitrateBps({
        candidateType: "host",
        protocol: "udp",
        currentRoundTripTimeMs: 72,
        availableOutgoingBitrateKbps: 320,
        mediaReceiveBitrateKbps: 96,
        mediaSendBitrateKbps: 96,
        packetLossRate: 0.7,
        packetsLost: 520,
        jitterMs: 4
      })
    ).toBe(288_000);
  });

  it("keeps the existing bitrate when the new target is only a tiny step away", () => {
    expect(
      resolvePreferredAudioMaxBitrateBps(
        {
          candidateType: "relay",
          protocol: "tcp",
          currentRoundTripTimeMs: 90,
          availableOutgoingBitrateKbps: 150,
          mediaReceiveBitrateKbps: null,
          mediaSendBitrateKbps: null,
          packetLossRate: 1.4,
          packetsLost: 12,
          jitterMs: 4
        },
        144_000
      )
    ).toBe(144_000);
  });

  it("keeps the existing jitter target when the new recommendation is within hysteresis", () => {
    expect(
      resolvePreferredReceiverJitterTargetMs(
        {
          candidateType: "relay",
          protocol: "tcp",
          currentRoundTripTimeMs: 80,
          availableOutgoingBitrateKbps: 220,
          mediaReceiveBitrateKbps: null,
          mediaSendBitrateKbps: 96,
          packetLossRate: 1.2,
          packetsLost: 0,
          jitterMs: 4
        },
        260
      )
    ).toBe(260);
  });
});
