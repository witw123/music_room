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
    "dataConnectionState" | "dataChannelState" | "mediaConnectionState" | "mediaIceState"
  >
) {
  const dataReady = isDataChannelReady(snapshot);
  const mediaReady = isMediaConnectionReady(snapshot);
  const failed =
    snapshot.dataConnectionState === "failed" ||
    snapshot.mediaConnectionState === "failed" ||
    snapshot.dataConnectionState === "closed" ||
    snapshot.mediaConnectionState === "closed";
  const reconnecting =
    snapshot.dataConnectionState === "connecting" ||
    snapshot.dataConnectionState === "disconnected" ||
    snapshot.mediaConnectionState === "connecting" ||
    snapshot.mediaConnectionState === "disconnected" ||
    snapshot.mediaConnectionState === "buffering" ||
    snapshot.mediaIceState === "checking";

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

  if (reconnecting && (!mediaReady || !dataReady)) {
    return {
      transportHealth: "reconnecting" as const,
      degradedReason: "transport-reconnecting"
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
