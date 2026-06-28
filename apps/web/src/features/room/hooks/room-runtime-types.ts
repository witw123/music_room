"use client";

import type { MutableRefObject, RefObject } from "react";
import type {
  AuthSession,
  PeerDiagnosticsSnapshot,
  RoomSnapshot,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";
import type { RoomSocket } from "@/lib/ws-client";
import type { UploadedTrack } from "@/features/upload/audio-utils";

export type DataMeshBridge = {
  syncPeers(
    peerIds: string[],
    options?: { forceReconnectDegraded?: boolean }
  ): Promise<boolean>;
  restartPeer(peerId: string): Promise<unknown>;
  requestPieces(
    peerId: string,
    trackId: string,
    chunkIndexes: number[],
    totalChunks: number,
    timeoutMs?: number
  ): boolean;
  getConnectedPeerIds(): string[];
  isReady(): boolean;
};

export type ManualCacheDownloadBridge = Pick<
  DataMeshBridge,
  "syncPeers" | "requestPieces" | "getConnectedPeerIds"
>;

export type PlaybackConnectionKey = string;

export type PlaybackRecoveryAction = {
  actionId: string;
  playbackConnectionKey: PlaybackConnectionKey;
  actionType: "restart-data-peer" | "full-resubscribe";
  peerId: string | null;
  startedAt: string;
  expiresAt: string;
  result: "running" | "completed" | "failed" | "dropped";
  reason: string;
};

export type PlaybackRecoveryDropReason =
  | "stale-connection-key"
  | "lower-priority-running"
  | "suppressed-by-guard"
  | "missing-peer";

export type PlaybackRecoveryRecommendation = {
  playbackConnectionKey: PlaybackConnectionKey | null;
  peerId: string | null;
  scope: "data" | "room";
  level: "soft" | "hard-recreate" | "full-resubscribe";
  reason: string;
  observedNoProgressMs: number | null;
};

export type RoomRecoveryPhase =
  | "joining"
  | "resyncing"
  | "bootstrapping-data"
  | "playing-local-fallback"
  | "steady";

export type RoomRecoveryMode = "late-join" | "rejoin" | "steady";

export type RoomRecoveryState = {
  phase: RoomRecoveryPhase;
  mode: RoomRecoveryMode;
  generation: number | null;
  bootstrapStartedAt: string | null;
  bootstrapSourcePeerId: string | null;
  pendingSnapshot: boolean;
  pendingData: boolean;
  pendingMedia: boolean;
  listenerBootstrapAttempts: number | null;
  fullLocalRecoveryActive: boolean;
};

export type RoomRuntimeEvent =
  | {
      type: "diagnostic";
      peerId: string;
      channelKind: "data" | "system";
      direction: "local" | "sent" | "received";
      event: string;
      summary: string;
      level?: "info" | "warning" | "error";
      recordEvent?: boolean;
      update?: (snapshot: PeerDiagnosticsSnapshot) => PeerDiagnosticsSnapshot;
    }
  | {
      type: "status";
      message: string;
    };

export type RoomRuntimeBaseContext = {
  roomSnapshot: RoomSnapshot | null;
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  peerId: string;
  activeSession: AuthSession | null;
  socketRef: MutableRefObject<RoomSocket | null>;
  audioRef: RefObject<HTMLAudioElement | null>;
  uploadedTracks: Record<string, UploadedTrack>;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
};
