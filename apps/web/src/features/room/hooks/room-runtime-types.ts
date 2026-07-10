"use client";

import type { MutableRefObject, RefObject } from "react";
import type {
  AuthSession,
  PeerDiagnosticsSnapshot,
  RoomSnapshot,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";
import type { PeerConnectionStatsSample } from "@/features/p2p/connection-stats";
import type { PeerConnectionSupervisorState } from "@/features/p2p/connection-supervisor";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import type { PieceRequestOptions } from "@/features/p2p/piece-request-client";
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
    timeoutMs?: number,
    options?: PieceRequestOptions
  ): boolean;
  getConnectedPeerIds(): string[];
  isReady(): boolean;
};

export type ManualCacheDownloadBridge = Pick<
  DataMeshBridge,
  "syncPeers" | "requestPieces" | "getConnectedPeerIds"
>;

export type FullLocalPlaybackTrackRecord = Record<string, Pick<UploadedTrack, "objectUrl">>;

export type ManualCachePieceReceivedInput = {
  trackId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkSize: number;
  mimeType: string;
};

export type PieceTransferInput = {
  peerId: string;
  direction: "download" | "upload";
  bytes: number;
  durationMs?: number | null;
};

export type PieceRequestSampleInput = {
  peerId: string;
  outcome: "completed" | "timeout";
  durationMs: number;
};

export type PieceTransferSample = {
  startedAtMs?: number;
  timestampMs: number;
  bytes: number;
};

export type PieceTransferWindow = {
  downloads: PieceTransferSample[];
  uploads: PieceTransferSample[];
};

export type PieceTransferRates = {
  downloadRateKbps: number | null;
  uploadRateKbps: number | null;
};

export type DataTransportStatsInput = {
  peerId: string;
  sample?: PeerConnectionStatsSample &
    Partial<{
      connectionState: string | null;
      iceConnectionState: string | null;
      dataChannelState: string | null;
    }>;
};

export type ConnectionSupervisorSignalStateInput = {
  peerId: string;
  channelKind: "data" | "media";
  dataConnectionState?: string;
  dataIceState?: string;
  dataChannelState?: string;
  lastFailureReason?: string;
  mediaConnectionState?: string;
  mediaIceState?: string;
};

export type PeerRoundTripTimeSource =
  | PeerConnectionSupervisorState
  | {
      pieceRttMsP50?: number | null;
    }
  | null
  | undefined;

export type RoomDataMeshDiagnosticsRefs = {
  recordPeerDiagnosticRef: MutableRefObject<PeerDiagnosticRecorder>;
  recordPieceTransferRef: MutableRefObject<(input: PieceTransferInput) => void>;
  recordPieceRequestSampleRef: MutableRefObject<(input: PieceRequestSampleInput) => void>;
  updatePeerBufferedAmountRef: MutableRefObject<
    (peerId: string, bufferedAmountBytes: number) => void
  >;
  updateDataTransportStatsRef: MutableRefObject<(input: DataTransportStatsInput) => void>;
  connectionSupervisorStatesRef: MutableRefObject<Map<string, PeerConnectionSupervisorState>>;
  updateConnectionSupervisorSignalState: (
    input: ConnectionSupervisorSignalStateInput
  ) => PeerConnectionSupervisorState | null;
  updateConnectionSupervisorTransportStats: (input: {
    peerId: string;
    sample: PeerConnectionStatsSample;
  }) => PeerConnectionSupervisorState | null;
  withResolvedTransportHealth: (
    snapshot: PeerDiagnosticsSnapshot
  ) => PeerDiagnosticsSnapshot;
  withSupervisorDiagnosticPatch: (
    snapshot: PeerDiagnosticsSnapshot,
    state: PeerConnectionSupervisorState | null
  ) => PeerDiagnosticsSnapshot;
  getPieceTransferRates: (
    transferWindows: Map<string, PieceTransferWindow>,
    peerId: string,
    now?: number
  ) => PieceTransferRates;
  pieceTransferRatesRef: MutableRefObject<Map<string, PieceTransferWindow>>;
  getPeerMedianRttMs: (state: PeerRoundTripTimeSource) => number | null;
};

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
