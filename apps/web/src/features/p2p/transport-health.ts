import type { PeerDiagnosticsSnapshot } from "@music-room/shared";

export function isDataChannelReady(
  snapshot: Pick<PeerDiagnosticsSnapshot, "dataChannelState">
) {
  return snapshot.dataChannelState === "open";
}

export function isMediaConnectionReady(
  snapshot: Pick<PeerDiagnosticsSnapshot, "mediaConnectionState">
) {
  return snapshot.mediaConnectionState === "connected" || snapshot.mediaConnectionState === "live";
}

export function resolveTransportHealth(
  snapshot: Pick<
    PeerDiagnosticsSnapshot,
    | "dataConnectionState"
    | "dataChannelState"
    | "mediaConnectionState"
    | "mediaIceState"
    | "recoveryActionLevel"
    | "audibleSource"
  >
) {
  const dataReady = isDataChannelReady(snapshot);
  const mediaReady = isMediaConnectionReady(snapshot);
  const audible = snapshot.audibleSource !== null;
  const failed =
    snapshot.dataConnectionState === "failed" ||
    snapshot.mediaConnectionState === "failed" ||
    snapshot.dataConnectionState === "closed" ||
    snapshot.mediaConnectionState === "closed";
  const degraded =
    snapshot.mediaConnectionState === "buffering" ||
    snapshot.mediaIceState === "checking" ||
    (snapshot.mediaConnectionState === "connecting" && audible) ||
    (snapshot.dataConnectionState === "connecting" && audible) ||
    false;
  const reconnecting =
    snapshot.dataConnectionState === "connecting" ||
    snapshot.dataConnectionState === "disconnected" ||
    snapshot.mediaConnectionState === "connecting" ||
    snapshot.mediaConnectionState === "disconnected";
  const recoveryActionLevel = snapshot.recoveryActionLevel ?? "observe";
  const hardRecoveryActive =
    recoveryActionLevel === "hard-reconnect" || recoveryActionLevel === "full-resubscribe";
  const anyRecoveryActive = recoveryActionLevel !== "observe";

  if (mediaReady && !dataReady) {
    return {
      transportHealth: "media-only" as const,
      degradedReason: "data-channel-not-ready"
    };
  }

  if (failed) {
    return {
      transportHealth: "failed" as const,
      degradedReason: "transport-failed"
    };
  }

  if (anyRecoveryActive) {
    return {
      transportHealth: hardRecoveryActive && !audible ? ("reconnecting" as const) : ("recovering" as const),
      degradedReason:
        recoveryActionLevel === "full-resubscribe"
          ? "full-resubscribe"
          : recoveryActionLevel === "hard-reconnect"
            ? "hard-reconnect"
            : recoveryActionLevel === "peer-restart"
            ? "peer-restart"
              : "soft-media-retry"
    };
  }

  if (degraded) {
    return {
      transportHealth: "degraded" as const,
      degradedReason:
        snapshot.mediaIceState === "checking" ? "ice-checking" : "transport-buffering"
    };
  }

  if (reconnecting && (!mediaReady || !dataReady)) {
    return {
      transportHealth: audible ? ("degraded" as const) : ("reconnecting" as const),
      degradedReason: audible ? "transport-degraded" : "transport-reconnecting"
    };
  }

  if (mediaReady && dataReady) {
    return {
      transportHealth: "healthy" as const,
      degradedReason: null
    };
  }

  return {
    transportHealth: null,
    degradedReason: null
  };
}

export function pickActiveMediaDiagnostic(
  peerDiagnostics: PeerDiagnosticsSnapshot[],
  preferredPeerId: string | null
) {
  if (preferredPeerId) {
    const preferred = peerDiagnostics.find((peer) => peer.peerId === preferredPeerId) ?? null;
    if (preferred && isMediaConnectionReady(preferred)) {
      return preferred;
    }
  }

  const connectedMediaPeers = peerDiagnostics
    .filter((peer) => isMediaConnectionReady(peer))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return connectedMediaPeers[0] ?? null;
}
