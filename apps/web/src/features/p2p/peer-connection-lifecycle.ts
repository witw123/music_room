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
    iceServers:
      input.iceServers.length > 0
        ? input.iceServers
        : [{ urls: "stun:stun.l.google.com:19302" }],
    ...(input.resolveConnectionConfig?.(input.peerId) ?? {})
  };
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
  input.entry.channel?.close();
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
      event.candidate.toJSON() as unknown as Record<string, unknown>
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
    input.entry.channel = event.channel;
    input.bindChannel(input.peerId, input.entry, input.entry.channel);
  };
}
