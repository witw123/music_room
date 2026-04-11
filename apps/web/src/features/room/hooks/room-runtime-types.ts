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
  ): Promise<void>;
  restartPeer(peerId: string): Promise<unknown>;
  requestPieces(
    peerId: string,
    trackId: string,
    chunkIndexes: number[],
    totalChunks: number,
    timeoutMs?: number
  ): boolean;
  getConnectedPeerIds(): string[];
};

export type MediaRuntimeBridge = {
  scheduleRemotePlaybackRetry(attempt?: number, generation?: string | null): void;
  syncHostMediaStream(options?: { forceResync?: boolean; reason?: string }): Promise<void>;
  ensureSourcePlaybackStarted(): Promise<void>;
  getMediaConnectedPeerIds(): string[];
};

export type ManualCacheDownloadBridge = Pick<
  DataMeshBridge,
  "syncPeers" | "requestPieces" | "getConnectedPeerIds"
>;

export type RoomRuntimeEvent =
  | {
      type: "diagnostic";
      peerId: string;
      channelKind: "data" | "media" | "system";
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
  remoteAudioRef: RefObject<HTMLAudioElement | null>;
  uploadedTracks: Record<string, UploadedTrack>;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
};
