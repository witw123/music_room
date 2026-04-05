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

  connectionState: RTCPeerConnectionState = "new";
  signalingState: RTCSignalingState = "stable";
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
    if (description?.type === "offer") {
      this.signalingState = "have-local-offer";
    }

    if (description?.type === "answer") {
      this.signalingState = "stable";
    }
  }

  async createAnswer() {
    return { type: "answer" as const, sdp: "fake-answer" };
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
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
      encodings: [{ maxBitrate: 160_000 }]
    });
  });

  it("reduces sender bitrate on constrained relay tcp links", () => {
    expect(
      resolvePreferredAudioMaxBitrateBps({
        candidateType: "relay",
        protocol: "tcp",
        currentRoundTripTimeMs: 70,
        availableOutgoingBitrateKbps: 148,
        mediaReceiveBitrateKbps: null,
        mediaSendBitrateKbps: null,
        packetsLost: 104,
        jitterMs: 3
      })
    ).toBe(72_000);
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
        packetsLost: 20,
        jitterMs: 4
      })
    ).toBe(62_999);
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
        packetsLost: 0,
        jitterMs: 4
      })
    ).toBe(480);
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
        packetsLost: 120,
        jitterMs: 34
      })
    ).toBe(560);
  });
});
