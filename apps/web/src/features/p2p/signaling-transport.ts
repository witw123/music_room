import type { PeerSignalMessage } from "@music-room/shared";

type SignalType = PeerSignalMessage["type"];
export type PeerLinkKind = "data" | "media";

type SignalDiagnosticRecorder = (payload: {
  peerId: string;
  direction: "sent" | "received";
  type: SignalType;
  linkKind?: PeerLinkKind;
}) => void;

type SignalPeerEntry = {
  connection: {
    addIceCandidate: (candidate: RTCIceCandidateInit) => Promise<void>;
    createAnswer: () => Promise<RTCLocalSessionDescriptionInit>;
    remoteDescription: RTCSessionDescription | RTCSessionDescriptionInit | null;
    setLocalDescription: (description?: RTCLocalSessionDescriptionInit) => Promise<void>;
    signalingState: RTCSignalingState;
  };
  pendingCandidates: RTCIceCandidateInit[];
  lastSignalProgressAtMs: number;
  connectionGeneration?: number;
};

type IncomingSignalOrder = {
  connectionGeneration: number | null;
  sequenceByType: Partial<Record<SignalType, number>>;
};

type LocalOfferConnection = {
  createOffer: (options?: RTCOfferOptions) => Promise<RTCLocalSessionDescriptionInit>;
  setLocalDescription: (description?: RTCLocalSessionDescriptionInit) => Promise<void>;
};

type IncomingSignalHandlers<TEntry extends SignalPeerEntry> = {
  getOrCreatePeerEntry: (peerId: string, linkKind?: PeerLinkKind) => Promise<TEntry>;
  runPeerOperation: <T>(entry: TEntry, task: () => Promise<T>) => Promise<T | undefined>;
  applyRemoteDescription: (
    entry: TEntry,
    remoteDescription: RTCSessionDescriptionInit
  ) => Promise<void>;
  flushPendingCandidates: (entry: TEntry) => Promise<void>;
  nowMs?: () => number;
};

export function buildDataPeerSignal(input: {
  roomId: string;
  localPeerId: string;
  remotePeerId: string;
  type: SignalType;
  payload: Record<string, unknown>;
}): PeerSignalMessage {
  return buildPeerSignal({ ...input, linkKind: "data" });
}

export function buildMediaPeerSignal(input: {
  roomId: string;
  localPeerId: string;
  remotePeerId: string;
  type: SignalType;
  payload: Record<string, unknown>;
}): PeerSignalMessage {
  return buildPeerSignal({ ...input, linkKind: "media" });
}

function buildPeerSignal(input: {
  roomId: string;
  localPeerId: string;
  remotePeerId: string;
  type: SignalType;
  payload: Record<string, unknown>;
  linkKind: PeerLinkKind;
  connectionGeneration?: number;
}): PeerSignalMessage {
  return {
    protocolVersion: 4,
    capability: "webrtc-opus-v1",
    roomId: input.roomId,
    fromPeerId: input.localPeerId,
    toPeerId: input.remotePeerId,
    channelKind: "data",
    linkKind: input.linkKind,
    type: input.type,
    payload: input.payload,
    ...(typeof input.connectionGeneration === "number"
      ? { connectionGeneration: input.connectionGeneration }
      : {})
  };
}

export class SignalingTransport {
  private readonly roomId: string;
  private readonly localPeerId: string;
  private readonly sendSignal: (payload: PeerSignalMessage) => void;
  private readonly onSignal?: SignalDiagnosticRecorder;
  private readonly incomingSignalOrder = new Map<string, IncomingSignalOrder>();

  constructor(input: {
    roomId: string;
    localPeerId: string;
    sendSignal: (payload: PeerSignalMessage) => void;
    onSignal?: SignalDiagnosticRecorder;
  }) {
    this.roomId = input.roomId;
    this.localPeerId = input.localPeerId;
    this.sendSignal = input.sendSignal;
    this.onSignal = input.onSignal;
  }

  markReceived(peerId: string, type: SignalType, linkKind: PeerLinkKind = "data") {
    this.onSignal?.({
      peerId,
      direction: "received",
      type,
      linkKind
    });
  }

  send(
    peerId: string,
    type: SignalType,
    payload: Record<string, unknown>,
    linkKind: PeerLinkKind = "data",
    connectionGeneration?: number
  ) {
    this.onSignal?.({
      peerId,
      direction: "sent",
      type,
      linkKind
    });
    this.sendSignal(
      buildPeerSignal({
        roomId: this.roomId,
        localPeerId: this.localPeerId,
        remotePeerId: peerId,
        type,
        payload,
        linkKind,
        connectionGeneration
      })
    );
  }

  async createAndSendOffer(
    peerId: string,
    connection: LocalOfferConnection,
    options?: RTCOfferOptions,
    linkKind: PeerLinkKind = "data",
    connectionGeneration?: number
  ) {
    const offer = options ? await connection.createOffer(options) : await connection.createOffer();
    await connection.setLocalDescription(offer);
    this.send(peerId, "offer", toSessionDescriptionPayload(offer), linkKind, connectionGeneration);
    return offer;
  }

  async handleIncomingSignal<TEntry extends SignalPeerEntry>(
    payload: PeerSignalMessage,
    handlers: IncomingSignalHandlers<TEntry>
  ) {
    if (payload.channelKind !== "data" || payload.toPeerId !== this.localPeerId) {
      return;
    }

    if (!this.acceptIncomingSignalOrder(payload)) {
      return;
    }

    const linkKind = payload.linkKind ?? "data";
    const entry = await handlers.getOrCreatePeerEntry(payload.fromPeerId, linkKind);
    entry.lastSignalProgressAtMs = (handlers.nowMs ?? Date.now)();

    if (payload.type === "offer") {
      await handlers.runPeerOperation(entry, async () => {
        this.markReceived(payload.fromPeerId, "offer", linkKind);
        const remoteDescription = toSessionDescriptionInit(payload.payload);
        if (!remoteDescription) {
          return;
        }

        if (
          entry.connection.signalingState !== "stable" &&
          entry.connection.signalingState !== "have-local-offer"
        ) {
          return;
        }

        if (entry.connection.signalingState === "have-local-offer") {
          // The lexically larger peer is polite during renegotiation. It rolls
          // back its local media offer so a source change cannot strand the
          // connection in have-local-offer.
          if (this.localPeerId.localeCompare(payload.fromPeerId) < 0) {
            return;
          }
          await entry.connection.setLocalDescription({ type: "rollback" });
        }

        await handlers.applyRemoteDescription(entry, remoteDescription);
        await handlers.flushPendingCandidates(entry);
        const answer = await entry.connection.createAnswer();
        await entry.connection.setLocalDescription(answer);
        entry.lastSignalProgressAtMs = (handlers.nowMs ?? Date.now)();
        this.send(
          payload.fromPeerId,
          "answer",
          toSessionDescriptionPayload(answer),
          linkKind,
          entry.connectionGeneration
        );
      });
      return;
    }

    if (payload.type === "answer") {
      await handlers.runPeerOperation(entry, async () => {
        this.markReceived(payload.fromPeerId, "answer", linkKind);
        const remoteDescription = toSessionDescriptionInit(payload.payload);
        if (!remoteDescription) {
          return;
        }

        if (entry.connection.signalingState !== "have-local-offer") {
          return;
        }

        await handlers.applyRemoteDescription(entry, remoteDescription);
        await handlers.flushPendingCandidates(entry);
        entry.lastSignalProgressAtMs = (handlers.nowMs ?? Date.now)();
      });
      return;
    }

    if (payload.type === "candidate") {
      await handlers.runPeerOperation(entry, async () => {
        this.markReceived(payload.fromPeerId, "candidate", linkKind);
        const candidate = toIceCandidateInit(payload.payload);
        if (!candidate) {
          return;
        }

        if (!entry.connection.remoteDescription) {
          entry.pendingCandidates.push(candidate);
          return;
        }

        try {
          await entry.connection.addIceCandidate(candidate);
          entry.lastSignalProgressAtMs = (handlers.nowMs ?? Date.now)();
        } catch {
          if (!entry.connection.remoteDescription) {
            entry.pendingCandidates.push(candidate);
          }
        }
      });
    }
  }

  private acceptIncomingSignalOrder(payload: PeerSignalMessage) {
    const linkKind = payload.linkKind ?? "data";
    const recoveryGeneration = payload.recoveryGeneration ?? 0;
    const key = `${payload.fromPeerId}:${linkKind}:${recoveryGeneration}`;
    const previous = this.incomingSignalOrder.get(key);
    const connectionGeneration = payload.connectionGeneration ?? null;
    const sequence = payload.sequence ?? null;

    if (previous) {
      // Once a peer has announced a connection incarnation, an untagged
      // signal cannot be safely assigned to the current RTCPeerConnection.
      // Accepting it here lets delayed candidates from an older connection
      // contaminate a newly recreated media peer.
      if (previous.connectionGeneration !== null && connectionGeneration === null) {
        return false;
      }
      if (
        connectionGeneration !== null &&
        previous.connectionGeneration !== null &&
        connectionGeneration < previous.connectionGeneration
      ) {
        return false;
      }
      if (
        connectionGeneration === previous.connectionGeneration &&
        sequence !== null &&
        typeof previous.sequenceByType[payload.type] === "number" &&
        sequence <= previous.sequenceByType[payload.type]!
      ) {
        return false;
      }
    }

    const generationChanged = previous !== undefined &&
      connectionGeneration !== previous.connectionGeneration;
    const sequenceByType = generationChanged
      ? {}
      : { ...(previous?.sequenceByType ?? {}) };
    if (sequence !== null) {
      sequenceByType[payload.type] = Math.max(
        sequenceByType[payload.type] ?? Number.MIN_SAFE_INTEGER,
        sequence
      );
    }
    this.incomingSignalOrder.set(key, {
      connectionGeneration:
        connectionGeneration ?? previous?.connectionGeneration ?? null,
      sequenceByType
    });
    return true;
  }
}

export function toSessionDescriptionPayload(
  description: RTCLocalSessionDescriptionInit
): Record<string, unknown> {
  return {
    type: description.type,
    ...(typeof description.sdp === "string" ? { sdp: description.sdp } : {})
  };
}

export function toSessionDescriptionInit(
  payload: Record<string, unknown>
): RTCSessionDescriptionInit | null {
  if (typeof payload.type !== "string") {
    return null;
  }

  return {
    type: payload.type as RTCSdpType,
    sdp: typeof payload.sdp === "string" ? payload.sdp : undefined
  };
}

export function toIceCandidateInit(
  payload: Record<string, unknown>
): RTCIceCandidateInit | null {
  if (typeof payload.candidate !== "string") {
    return null;
  }

  return {
    candidate: payload.candidate,
    sdpMid: typeof payload.sdpMid === "string" ? payload.sdpMid : undefined,
    sdpMLineIndex:
      typeof payload.sdpMLineIndex === "number" ? payload.sdpMLineIndex : undefined,
    usernameFragment:
      typeof payload.usernameFragment === "string" ? payload.usernameFragment : undefined
  };
}

export function shouldIgnoreStaleAnswerError(
  signalingState: RTCSignalingState,
  error: unknown
) {
  if (signalingState === "have-local-offer") {
    return false;
  }

  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /wrong state:\s*stable/i.test(message) || /Called in wrong state:\s*stable/i.test(message);
}
