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
    iceServers: normalizeIceServers(
      input.iceServers.length > 0
        ? input.iceServers
        : [{ urls: "stun:stun.l.google.com:19302" }]
    ),
    ...(input.resolveConnectionConfig?.(input.peerId) ?? {})
  };
}

function normalizeIceServers(iceServers: IceServerConfig[]): IceServerConfig[] {
  return iceServers.filter((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => url.trim().length > 0);
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
  input.entry.originalChannel?.close();
  if (!input.entry.controlChannel && !input.entry.dataChannel && !input.entry.originalChannel) {
    input.entry.channel?.close();
  }
  input.entry.connection.close();
  input.entry.audioSender = null;
  input.entry.audioReceiver = null;
  input.entry.remoteAudioStream = null;
  input.entry.remoteAudioTrackId = null;
  input.entry.senderTrackState = "none";
  input.entry.configuredAudioMaxBitrateKbps = null;
  input.entry.appliedAudioBitrateKbps = null;
  input.entry.receiverTrackState = "none";
  input.entry.mediaNegotiationPending = false;
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
  onRemoteAudioTrack?: (payload: {
    peerId: string;
    entry: PeerEntry;
    track: MediaStreamTrack;
    streams: readonly MediaStream[];
  }) => void;
  onMediaStateChange?: (payload: {
    peerId: string;
    entry: PeerEntry;
    direction: "sender" | "receiver";
    state: PeerEntry["senderTrackState"];
  }) => void;
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
    } else if (channel.label === "music-room-original") {
      input.entry.originalChannel = channel;
    } else if (channel.label === "music-room-data") {
      input.entry.dataChannel = channel;
    }
    input.entry.channel = input.entry.controlChannel ?? input.entry.dataChannel ?? channel;
    input.bindChannel(input.peerId, input.entry, channel);
  };

  input.connection.ontrack = (event) => {
    if (event.track.kind !== "audio") {
      return;
    }
    input.entry.audioReceiver = event.receiver ?? null;
    const receiver = event.receiver as (RTCRtpReceiver & {
      playoutDelayHint?: number;
    }) | null;
    if (receiver && "playoutDelayHint" in receiver) {
      try {
        // A small jitter buffer absorbs short WAN bursts without adding a
        // noticeable delay to synchronized room playback.
        receiver.playoutDelayHint = 0.18;
      } catch {
        // Older browsers expose the property but reject runtime updates.
      }
    }
    input.entry.remoteAudioStream = event.streams[0] ?? new MediaStream([event.track]);
    input.entry.remoteAudioTrackId = event.track.id;
    input.entry.receiverTrackState = event.track.readyState === "live" ? "live" : "ended";
    input.onMediaStateChange?.({
      peerId: input.peerId,
      entry: input.entry,
      direction: "receiver",
      state: input.entry.receiverTrackState
    });
    input.onRemoteAudioTrack?.({
      peerId: input.peerId,
      entry: input.entry,
      track: event.track,
      streams: event.streams
    });
    event.track.onended = () => {
      if (input.entry.remoteAudioTrackId !== event.track.id) {
        return;
      }
      input.entry.receiverTrackState = "ended";
      input.onMediaStateChange?.({
        peerId: input.peerId,
        entry: input.entry,
        direction: "receiver",
        state: "ended"
      });
    };
    event.track.onmute = () => {
      if (input.entry.remoteAudioTrackId !== event.track.id) {
        return;
      }
      input.entry.receiverTrackState = "failed";
      input.onMediaStateChange?.({
        peerId: input.peerId,
        entry: input.entry,
        direction: "receiver",
        state: "failed"
      });
    };
    event.track.onunmute = () => {
      if (input.entry.remoteAudioTrackId !== event.track.id) {
        return;
      }
      input.entry.receiverTrackState = "live";
      input.onMediaStateChange?.({
        peerId: input.peerId,
        entry: input.entry,
        direction: "receiver",
        state: "live"
      });
    };
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
