"use client";

import { useEffect, useMemo, useRef } from "react";
import type {
  AssetAvailabilityAnnouncement,
  PeerDiagnosticsSnapshot,
  RoomSnapshot,
  TrackMeta
} from "@music-room/shared";
import { useSegmentedOpusPlayback } from "@/features/playback/use-segmented-opus-playback";

export function useRoomSegmentedPlaybackRuntime(input: {
  roomSnapshot: RoomSnapshot | null;
  currentTrack: TrackMeta | null;
  peerId: string;
  volume: number;
  audioUnlocked: boolean;
  peerDiagnostics: PeerDiagnosticsSnapshot[];
  availabilityByAsset: Record<string, Record<string, AssetAvailabilityAnnouncement>>;
  requestAssetUnits: Parameters<typeof useSegmentedOpusPlayback>[0]["requestAssetUnits"];
  emitAssetAvailability: (announcement: AssetAvailabilityAnnouncement) => void;
  setStatusMessage: (message: string) => void;
}) {
  const setStatusMessage = input.setStatusMessage;
  const network = useMemo(() => {
    const throughput = input.peerDiagnostics.flatMap((diagnostic) =>
      typeof diagnostic.streamThroughputKbps === "number"
        ? [diagnostic.streamThroughputKbps]
        : typeof diagnostic.transportReceiveBitrateKbps === "number"
          ? [diagnostic.transportReceiveBitrateKbps]
          : []
    );
    const rtt = input.peerDiagnostics.flatMap((diagnostic) =>
      typeof diagnostic.pieceRttMsP95 === "number"
        ? [diagnostic.pieceRttMsP95]
        : typeof diagnostic.currentRoundTripTimeMs === "number"
          ? [diagnostic.currentRoundTripTimeMs]
          : []
    );
    return {
      throughputKbps: throughput.length > 0 ? Math.max(...throughput) : null,
      rttP95Ms: rtt.length > 0 ? Math.min(...rtt) : null,
      playbackChannelBufferedBytes: Math.max(
        0,
        ...input.peerDiagnostics.map(
          (diagnostic) => diagnostic.dataBufferedAmountBytes ?? 0
        )
      ),
      deadlineMissesLast30s: input.peerDiagnostics.reduce(
        (total, diagnostic) =>
          total + (diagnostic.progressivePlaybackStatus?.waitingEventsLast30s ?? 0),
        0
      )
    };
  }, [input.peerDiagnostics]);

  const playback = useSegmentedOpusPlayback({
    roomSnapshot: input.roomSnapshot,
    currentTrack: input.currentTrack,
    peerId: input.peerId,
    volume: input.volume,
    audioUnlocked: input.audioUnlocked,
    availabilityByAsset: input.availabilityByAsset,
    requestAssetUnits: input.requestAssetUnits,
    emitAssetAvailability: input.emitAssetAvailability,
    network
  });
  const wasUnavailableRef = useRef(false);
  useEffect(() => {
    if (playback.state === "unavailable") {
      wasUnavailableRef.current = true;
      setStatusMessage("播放资产当前没有在线成员可提供。");
    } else if (wasUnavailableRef.current && playback.state === "live") {
      wasUnavailableRef.current = false;
      setStatusMessage("成员端播放资产已恢复。");
    }
  }, [playback.state, setStatusMessage]);

  return input.currentTrack?.playbackAsset ? null : input.currentTrack;
}
