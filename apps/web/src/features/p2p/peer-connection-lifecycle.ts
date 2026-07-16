import type { IceServerConfig } from "@music-room/shared";
import {
  clearPeerTimers,
  type PeerEntry
} from "./peer-connection-registry";
import type { PeerLinkKind } from "./signaling-transport";

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
    // Keep every configured candidate (direct, TURN UDP, TURN TCP/TLS) so ICE
    // can escape a lossy relay path after a restart. Bundle all media/control
    // components onto one transport to leave the largest possible allocation
    // for the live RTP audio track.
    iceTransportPolicy: "all",
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
    iceCandidatePoolSize: 4,
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
  deleteIfCurrent: (peerId: string, entry: PeerEntry, linkKind?: "data" | "media") => boolean;
  clearPendingRequestsForPeer: (peerId: string) => void;
  stopStatsSampling: (entry: PeerEntry) => void;
  onDataBufferedAmountChange?: (payload: {
    peerId: string;
    bufferedAmountBytes: number;
  }) => void;
}) {
  input.entry.releasing = true;
  if (input.entry.linkKind === "data") {
    input.deleteIfCurrent(input.peerId, input.entry);
  } else {
    input.deleteIfCurrent(input.peerId, input.entry, input.entry.linkKind);
  }
  clearPeerTimers(input.entry);
  if (input.entry.linkKind === "data") {
    input.clearPendingRequestsForPeer(input.peerId);
  }
  input.stopStatsSampling(input.entry);
  if (input.entry.linkKind === "data") {
    input.entry.channel?.close();
  }
  input.entry.connection.close();
  input.entry.audioTransceiver = null;
  input.entry.audioSender = null;
  input.entry.audioReceiver = null;
  input.entry.remoteAudioStream = null;
  input.entry.remoteAudioTrackId = null;
  input.entry.senderStreamId = null;
  input.entry.senderTrackState = "none";
  input.entry.configuredAudioMaxBitrateKbps = null;
  input.entry.appliedAudioBitrateKbps = null;
  input.entry.receiverTrackState = "none";
  input.entry.receiverRtpActive = false;
  if (input.entry.receiverMuteTimerId) {
    clearTimeout(input.entry.receiverMuteTimerId);
    input.entry.receiverMuteTimerId = null;
  }
  if (input.entry.mediaWatchdogTimerId) {
    clearTimeout(input.entry.mediaWatchdogTimerId);
    input.entry.mediaWatchdogTimerId = null;
  }
  if (input.entry.mediaSyncRetryTimerId !== null) {
    clearTimeout(input.entry.mediaSyncRetryTimerId);
    input.entry.mediaSyncRetryTimerId = null;
  }
  input.entry.mediaSyncRetryAttempts = 0;
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
  linkKind?: PeerLinkKind;
  autoReconnect: boolean;
  isCurrentEntry: (peerId: string, entry: PeerEntry) => boolean;
  isExpectedPeer: (peerId: string) => boolean;
  sendCandidate: (peerId: string, payload: Record<string, unknown>) => void;
  onPeerConnectionChange?: (payload: {
    peerId: string;
    state: RTCPeerConnectionState;
    linkKind?: PeerLinkKind;
  }) => void;
  onIceConnectionStateChange?: (payload: {
    peerId: string;
    state: RTCIceConnectionState;
    linkKind?: PeerLinkKind;
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
  onMediaTrackMuted?: (payload: { peerId: string; trackId: string }) => void;
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
      state: input.connection.connectionState,
      ...(input.entry.linkKind === "media" ? { linkKind: "media" as const } : {})
    });

    if (input.connection.connectionState === "connected" &&
      (input.entry.linkKind === "media" || input.entry.channel?.readyState === "open")) {
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
        if (input.autoReconnect && input.entry.linkKind === "data") {
          input.schedulePeerReconnect(input.peerId, input.entry);
        }
        return;
      }

      input.releasePeer(input.peerId, input.entry);
      return;
    }

    if (input.entry.linkKind === "data") {
      input.schedulePeerWatchdog(input.peerId, input.entry);
    }
  };

  input.connection.oniceconnectionstatechange = () => {
    input.entry.lastSignalProgressAtMs = Date.now();
    input.onIceConnectionStateChange?.({
      peerId: input.peerId,
      state: input.connection.iceConnectionState,
      ...(input.entry.linkKind === "media" ? { linkKind: "media" as const } : {})
    });
    if (input.isCurrentEntry(input.peerId, input.entry) && input.entry.linkKind === "data") {
      input.schedulePeerWatchdog(input.peerId, input.entry);
    }
  };

  input.connection.ondatachannel = (event) => {
    if ((input.linkKind ?? input.entry.linkKind) !== "data") {
      event.channel.close();
      return;
    }
    const channel = event.channel;
    if (channel.label !== "music-room-control") {
      channel.close();
      return;
    }
    input.entry.channel = channel;
    input.bindChannel(input.peerId, input.entry, channel);
  };

  input.connection.ontrack = (event) => {
    if ((input.linkKind ?? input.entry.linkKind) !== "media") {
      return;
    }
    if (event.track.kind !== "audio") {
      return;
    }
    input.entry.audioReceiver = event.receiver ?? null;
    const receiver = event.receiver as (RTCRtpReceiver & {
      playoutDelayHint?: number;
      jitterBufferTarget?: number;
    }) | null;
    if (receiver && "playoutDelayHint" in receiver) {
      try {
        // Keep a little more audio in the browser jitter buffer on WAN/relay
        // paths. This absorbs short loss bursts without rebuilding the
        // MediaStream, which would be audible as a larger dropout.
        receiver.playoutDelayHint = 0.3;
      } catch {
        // Older browsers expose the property but reject runtime updates.
      }
    }
    if (receiver && "jitterBufferTarget" in receiver) {
      try {
        receiver.jitterBufferTarget = 0.3;
      } catch {
        // Experimental in Chromium; ignore unsupported implementations.
      }
    }
    input.entry.remoteAudioStream = event.streams[0] ?? new MediaStream([event.track]);
    input.entry.remoteAudioTrackId = event.track.id;
    input.entry.receiverRtpActive = event.track.muted !== true;
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
      if (input.entry.receiverMuteTimerId) {
        clearTimeout(input.entry.receiverMuteTimerId);
      }
      // Remote tracks can briefly mute while the jitter buffer repairs a loss
      // burst. Only publish failed after a sustained mute so the room runtime
      // does not tear down a healthy audio element on every burst.
      input.entry.receiverMuteTimerId = setTimeout(() => {
        input.entry.receiverMuteTimerId = null;
        if (
          input.entry.remoteAudioTrackId === event.track.id &&
          event.track.muted &&
          event.track.readyState === "live"
        ) {
          input.entry.receiverRtpActive = false;
          input.entry.receiverTrackState = "failed";
          input.onMediaStateChange?.({
            peerId: input.peerId,
            entry: input.entry,
            direction: "receiver",
            state: "failed"
          });
        }
      }, 1_500);
      input.onMediaTrackMuted?.({ peerId: input.peerId, trackId: event.track.id });
    };
    event.track.onunmute = () => {
      if (input.entry.remoteAudioTrackId !== event.track.id) {
        return;
      }
      if (input.entry.receiverMuteTimerId) {
        clearTimeout(input.entry.receiverMuteTimerId);
        input.entry.receiverMuteTimerId = null;
      }
      input.entry.receiverRtpActive = true;
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
