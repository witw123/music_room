import type { PeerDiagnosticsSnapshot, RoomMember } from "@music-room/shared";

export const realtimeMediaSampleWindowMs = 6_000;

const presencePriority: Record<RoomMember["presenceState"], number> = {
  online: 3,
  reconnecting: 2,
  offline: 1
};

function preferMember(current: RoomMember, candidate: RoomMember) {
  const currentScore = presencePriority[current.presenceState] + (current.peerId ? 1 : 0);
  const candidateScore = presencePriority[candidate.presenceState] + (candidate.peerId ? 1 : 0);
  return candidateScore >= currentScore ? candidate : current;
}

export function dedupeRoomMembers(members: RoomMember[]) {
  const byMemberId = new Map<string, RoomMember>();
  for (const member of members) {
    const current = byMemberId.get(member.id);
    byMemberId.set(member.id, current ? preferMember(current, member) : member);
  }
  return [...byMemberId.values()];
}

export function dedupePeerDiagnostics(diagnostics: PeerDiagnosticsSnapshot[]) {
  const byPeerId = new Map<string, PeerDiagnosticsSnapshot>();
  for (const diagnostic of diagnostics) {
    const current = byPeerId.get(diagnostic.peerId);
    if (!current || getTimestampMs(diagnostic.updatedAt) >= getTimestampMs(current.updatedAt)) {
      byPeerId.set(diagnostic.peerId, diagnostic);
    }
  }
  return [...byPeerId.values()];
}

export function getMediaSampleAgeMs(
  diagnostic: PeerDiagnosticsSnapshot | null | undefined,
  now = Date.now()
) {
  if (!diagnostic) {
    return null;
  }

  const timestamp =
    diagnostic.reportedTelemetryAt ??
    diagnostic.lastMediaStatsProgressAt ??
    diagnostic.lastMediaPacketAt ??
    null;
  if (!timestamp) {
    return null;
  }

  const timestampMs = getTimestampMs(timestamp);
  return Number.isFinite(timestampMs) ? Math.max(0, now - timestampMs) : null;
}

export function hasFreshMediaObservation(
  diagnostic: PeerDiagnosticsSnapshot | null | undefined,
  now = Date.now()
) {
  if (!diagnostic) {
    return false;
  }

  const hasMediaRate =
    (diagnostic.reportedReceiveRateKbps ?? diagnostic.mediaReceiveBitrateKbps ?? 0) > 0 ||
    (diagnostic.reportedSendRateKbps ?? diagnostic.mediaSendBitrateKbps ?? 0) > 0;
  return hasRecentMediaSample(diagnostic, now) && hasMediaRate;
}

export function hasRecentMediaSample(
  diagnostic: PeerDiagnosticsSnapshot | null | undefined,
  now = Date.now()
) {
  const sampleAgeMs = getMediaSampleAgeMs(diagnostic, now);
  return sampleAgeMs !== null && sampleAgeMs <= realtimeMediaSampleWindowMs;
}

function getTimestampMs(value: string) {
  return new Date(value).getTime();
}
