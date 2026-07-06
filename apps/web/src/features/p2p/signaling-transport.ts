import type { PeerSignalMessage } from "@music-room/shared";

type SignalType = PeerSignalMessage["type"];

type SignalDiagnosticRecorder = (payload: {
  peerId: string;
  direction: "sent" | "received";
  type: SignalType;
}) => void;

export function buildDataPeerSignal(input: {
  roomId: string;
  localPeerId: string;
  remotePeerId: string;
  type: SignalType;
  payload: Record<string, unknown>;
}): PeerSignalMessage {
  return {
    roomId: input.roomId,
    fromPeerId: input.localPeerId,
    toPeerId: input.remotePeerId,
    channelKind: "data",
    type: input.type,
    payload: input.payload
  };
}

export class SignalingTransport {
  private readonly roomId: string;
  private readonly localPeerId: string;
  private readonly sendSignal: (payload: PeerSignalMessage) => void;
  private readonly onSignal?: SignalDiagnosticRecorder;

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

  markReceived(peerId: string, type: SignalType) {
    this.onSignal?.({
      peerId,
      direction: "received",
      type
    });
  }

  send(peerId: string, type: SignalType, payload: Record<string, unknown>) {
    this.onSignal?.({
      peerId,
      direction: "sent",
      type
    });
    this.sendSignal(
      buildDataPeerSignal({
        roomId: this.roomId,
        localPeerId: this.localPeerId,
        remotePeerId: peerId,
        type,
        payload
      })
    );
  }
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
