import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  PeerDiagnosticsSnapshot,
  PeerRecentEvent,
  RoomSnapshot
} from "@music-room/shared";
import type { SegmentedPlaybackSnapshot } from "@/features/playback/use-segmented-opus-playback";
import {
  buildMemberAssetSummaries,
  countPeersWithinActiveMembers,
  filterVisiblePeerDiagnostics,
  getLocalPlaybackStatus,
  selectWorkspacePeerDiagnostics
} from "./use-room-derived-state";

const playbackAsset = {
  assetId: "a".repeat(64),
  kind: "playback" as const,
  sourceFileHash: "b".repeat(64),
  profileId: "opus-music-v2" as const,
  codec: "opus" as const,
  container: "audio/ogg" as const,
  sampleRate: 48_000 as const,
  channels: 2 as const,
  bitrate: 192_000 as const,
  durationMs: 320_000,
  segmentDurationMs: 2_000 as const,
  seekPrerollMs: 80 as const,
  unitCount: 160,
  merkleRoot: "c".repeat(64),
  encoder: { name: "@audio/opus-encode" as const, version: "2.0.0" as const }
};

const roomSnapshot = {
  room: {
    id: "room_1",
    playback: {
      status: "playing",
      currentTrackId: "track_1",
      currentQueueItemId: null,
      positionMs: 0,
      startAt: "2026-07-13T00:00:00.000Z",
      sourcePeerId: "peer_host",
      sourceSessionId: "host",
      mediaEpoch: 1,
      revision: 1,
      queueVersion: 1
    },
    members: [
      { id: "host", nickname: "Host", role: "host", peerId: "peer_host", presenceState: "online", joinedAt: "2026-07-13T00:00:00.000Z" },
      { id: "listener", nickname: "Listener", role: "member", peerId: "peer_listener", presenceState: "online", joinedAt: "2026-07-13T00:00:01.000Z" }
    ]
  },
  tracks: [{
    id: "track_1",
    title: "Track",
    artist: "Artist",
    album: null,
    durationMs: 320_000,
    bitrate: null,
    fileHash: "hash_1",
    artworkUrl: null,
    ownerSessionId: "host",
    ownerNickname: "Host",
    sourceType: "local_upload",
    playbackAsset
  }],
  queue: []
} as unknown as RoomSnapshot;

const livePlayback: SegmentedPlaybackSnapshot = {
  state: "live",
  bufferedMs: 14_000,
  ownedUnitCount: 8,
  totalUnitCount: 160,
  audioContextState: "running",
  lastError: null
};

describe("use-room-derived-state v4 helpers", () => {
  it("derives member media state from RTP diagnostics", () => {
    expect(buildMemberAssetSummaries({
      roomSnapshot,
      peerDiagnostics: [{
        peerId: "peer_host",
        ...({
          mediaReceiveBitrateKbps: null,
          mediaSendBitrateKbps: 192,
          mediaConnectionState: "connected",
          transportHealth: "healthy",
          jitterMs: 4,
          packetLossRate: 0
        } as Partial<PeerDiagnosticsSnapshot>)
      } as PeerDiagnosticsSnapshot],
      activeMemberPeerIds: new Set(["peer_host", "peer_listener"]),
      localPeerId: "peer_listener",
      segmentedPlayback: livePlayback
    })).toEqual([
      {
        memberId: "host",
        mediaTrackState: "live",
        mediaReceiveBitrateKbps: null,
        mediaSendBitrateKbps: 192,
        mediaJitterMs: 4,
        mediaPacketLossRate: 0
      },
      {
        memberId: "listener",
        mediaTrackState: "none",
        mediaReceiveBitrateKbps: null,
        mediaSendBitrateKbps: null,
        mediaJitterMs: null,
        mediaPacketLossRate: null
      }
    ]);
  });

  it("reports live segmented output as audible", () => {
    expect(getLocalPlaybackStatus({
      presenceState: "online",
      playbackStatus: "playing",
      segmentedPlayback: livePlayback
    })).toMatchObject({ label: "正在发声", tone: "success", badgeText: "RTP Opus" });
  });

  it("reports a suspended AudioContext instead of trusting stale unlock state", () => {
    expect(getLocalPlaybackStatus({
      presenceState: "online",
      playbackStatus: "playing",
      segmentedPlayback: {
        ...livePlayback,
        state: "awaiting-unlock",
        audioContextState: "suspended"
      }
    })).toMatchObject({ label: "等待本机音频解锁", badgeText: "Audio unlock" });
  });

  it("keeps diagnostics scoped to active members and the members tab", () => {
    const diagnostics = [
      { peerId: "peer_host", updatedAt: "2026-07-13T00:00:00.000Z" },
      { peerId: "peer_gone", updatedAt: "2026-07-13T00:00:00.000Z" }
    ] as PeerDiagnosticsSnapshot[];
    const recentEvents: PeerRecentEvent[] = [];

    expect(filterVisiblePeerDiagnostics(diagnostics, new Set(["peer_host"]), null)).toHaveLength(1);
    expect(countPeersWithinActiveMembers(["peer_host", "peer_gone"], new Set(["peer_host"]))).toBe(1);
    expect(selectWorkspacePeerDiagnostics({
      activeDashboardTab: "queue",
      visiblePeerDiagnostics: diagnostics,
      visiblePeerRecentEvents: recentEvents
    })).toEqual({ peerDiagnostics: [], peerRecentEvents: [] });
  });

  it("does not derive member state from the retired progressive diagnostics model", () => {
    const source = readFileSync(new URL("./use-room-derived-state.ts", import.meta.url), "utf8");

    expect(source).not.toContain("progressivePlaybackStatus");
    expect(source).not.toContain("buildDiagnosticsViewModel");
    expect(source).not.toContain("缓存播放链路");
  });
});
