import type { IceServerConfig } from "@music-room/shared";
import {
  clearPeerTimers,
  type PeerEntry
} from "./peer-connection-registry";

type PeerStalledReason = "watchdog-timeout" | "connection-failed" | "data-channel-closed";

export function shouldInitiatePeerConnection(localPeerId: string, peerId: string) {
  return localPeerId.localeCompare(peerId) < 0;
}

export function buildPeerConnectionConfig(input: {
  peerId: string;
  iceServers: IceServerConfig[];
  resolveConnectionConfig?: (peerId: string) => Partial<RTCConfiguration> | null | undefined;
}): RTCConfiguration {
  return {
    iceServers: restrictIceServersToUdp(
      input.iceServers.length > 0
        ? input.iceServers
        : [{ urls: "stun:stun.l.google.com:19302" }]
    ),
    ...(input.resolveConnectionConfig?.(input.peerId) ?? {})
  };
}

function restrictIceServersToUdp(iceServers: IceServerConfig[]): IceServerConfig[] {
  return iceServers.flatMap((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    const filteredUrls = urls.filter((url) => {
      const normalized = url.trim().toLowerCase();
      return !normalized.startsWith("turn:") && !normalized.startsWith("turns:")
        ? true
        : normalized.includes("transport=udp");
    });
    if (filteredUrls.length === 0) {
      return [];
    }
    return [{
      ...server,
      urls: Array.isArray(server.urls) ? filteredUrls : filteredUrls[0]!
    }];
  });
}

export function resolveExistingPeerConnectionAction(input: {
  entry: PeerEntry;
}): "release" | "reuse" {
  if (
    input.entry.connection.connectionState === "failed" ||
    input.entry.connection.connectionState === "closed"
  ) {
    return "release";
  }

  return "reuse";
}

export function releasePeerConnectionEntry(input: {
  peerId: string;
  entry: PeerEntry;
  deleteIfCurrent: (peerId: string, entry: PeerEntry) => boolean;
  clearPendingRequestsForPeer: (peerId: string) => void;
  stopStatsSampling: (entry: PeerEntry) => void;
  onDataBufferedAmountChange?: (payload: {
    peerId: string;
    bufferedAmountBytes: number;
  }) => void;
}) {
  input.entry.releasing = true;
  input.entry.sendQueue = [];
  input.deleteIfCurrent(input.peerId, input.entry);
  clearPeerTimers(input.entry);
  input.clearPendingRequestsForPeer(input.peerId);
  input.stopStatsSampling(input.entry);
  input.entry.controlChannel?.close();
  input.entry.dataChannel?.close();
  if (!input.entry.controlChannel && !input.entry.dataChannel) {
    input.entry.channel?.close();
  }
  input.entry.connection.close();
  input.onDataBufferedAmountChange?.({
    peerId: input.peerId,
    bufferedAmountBytes: 0
  });
}

export function bindPeerConnectionEvents(input: {
  peerId: string;
  entry: PeerEntry;
  localPeerId: string;
  connection: RTCPeerConnection;
  autoReconnect: boolean;
  isCurrentEntry: (peerId: string, entry: PeerEntry) => boolean;
  isExpectedPeer: (peerId: string) => boolean;
  sendCandidate: (peerId: string, payload: Record<string, unknown>) => void;
  onPeerConnectionChange?: (payload: {
    peerId: string;
    state: RTCPeerConnectionState;
  }) => void;
  onIceConnectionStateChange?: (payload: {
    peerId: string;
    state: RTCIceConnectionState;
  }) => void;
  onPeerStalled?: (payload: {
    peerId: string;
    reason: PeerStalledReason;
  }) => void;
  schedulePeerReconnect: (peerId: string, entry: PeerEntry) => void;
  schedulePeerWatchdog: (peerId: string, entry: PeerEntry) => void;
  releasePeer: (peerId: string, entry: PeerEntry) => void;
  bindChannel: (peerId: string, entry: PeerEntry, channel: RTCDataChannel) => void;
}) {
  input.connection.onicecandidate = (event) => {
    if (!event.candidate) {
      return;
    }
    input.entry.lastSignalProgressAtMs = Date.now();
    input.sendCandidate(
      input.peerId,
      toIceCandidatePayload(event.candidate.toJSON())
    );
  };

  input.connection.onconnectionstatechange = () => {
    input.entry.lastSignalProgressAtMs = Date.now();
    input.onPeerConnectionChange?.({
      peerId: input.peerId,
      state: input.connection.connectionState
    });

    if (input.connection.connectionState === "connected" && input.entry.channel?.readyState === "open") {
      input.entry.reconnectAttempts = 0;
    }

    if (!input.isCurrentEntry(input.peerId, input.entry)) {
      return;
    }

    if (
      input.connection.connectionState === "failed" ||
      input.connection.connectionState === "closed"
    ) {
      if (input.isExpectedPeer(input.peerId)) {
        input.onPeerStalled?.({
          peerId: input.peerId,
          reason: "connection-failed"
        });
        if (input.autoReconnect) {
          input.schedulePeerReconnect(input.peerId, input.entry);
        }
        return;
      }

      input.releasePeer(input.peerId, input.entry);
      return;
    }

    input.schedulePeerWatchdog(input.peerId, input.entry);
  };

  input.connection.oniceconnectionstatechange = () => {
    input.entry.lastSignalProgressAtMs = Date.now();
    input.onIceConnectionStateChange?.({
      peerId: input.peerId,
      state: input.connection.iceConnectionState
    });
    if (input.isCurrentEntry(input.peerId, input.entry)) {
      input.schedulePeerWatchdog(input.peerId, input.entry);
    }
  };

  input.connection.ondatachannel = (event) => {
    const channel = event.channel;
    if (channel.label === "music-room-control") {
      input.entry.controlChannel = channel;
    } else if (channel.label === "music-room-data") {
      input.entry.dataChannel = channel;
    }
    input.entry.channel = input.entry.controlChannel ?? input.entry.dataChannel ?? channel;
    input.bindChannel(input.peerId, input.entry, channel);
  };
}

export function toIceCandidatePayload(candidate: RTCIceCandidateInit): Record<string, unknown> {
  return {
    candidate: candidate.candidate,
    ...(typeof candidate.sdpMid === "string" ? { sdpMid: candidate.sdpMid } : {}),
    ...(typeof candidate.sdpMLineIndex === "number"
      ? { sdpMLineIndex: candidate.sdpMLineIndex }
      : {}),
    ...(typeof candidate.usernameFragment === "string"
      ? { usernameFragment: candidate.usernameFragment }
      : {})
  };
}
