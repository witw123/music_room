import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeerSignalMessage } from "@music-room/shared";
import { RoomMediaMesh } from "./media-mesh";

class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = [];

  connectionState: RTCPeerConnectionState = "new";
  signalingState: RTCSignalingState = "stable";
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  closed = false;

  constructor() {
    FakeRTCPeerConnection.instances.push(this);
  }

  addTransceiver() {
    return {} as RTCRtpTransceiver;
  }

  addTrack() {
    return {
      replaceTrack: vi.fn()
    } as unknown as RTCRtpSender;
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
    vi.stubGlobal("RTCPeerConnection", FakeRTCPeerConnection);
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
});
