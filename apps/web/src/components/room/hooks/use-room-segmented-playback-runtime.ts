"use client";

import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
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
  onPlaybackEnded: () => void | Promise<void>;
  setMediaConnectionState: Dispatch<SetStateAction<"idle" | "connecting" | "live" | "buffering" | "reconnecting" | "failed">>;
  setSourceStartState: Dispatch<SetStateAction<"idle" | "awaiting-unlock" | "starting" | "live" | "failed">>;
  setLastSourceStartError: Dispatch<SetStateAction<string | null>>;
  setStatusMessage: (message: string) => void;
}) {
  const setStatusMessage = input.setStatusMessage;
  const onPlaybackEnded = input.onPlaybackEnded;
  const localPeerId = input.peerId;
  const roomSnapshot = input.roomSnapshot;
  const setLastSourceStartError = input.setLastSourceStartError;
  const setMediaConnectionState = input.setMediaConnectionState;
  const setSourceStartState = input.setSourceStartState;
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
  const completedTimelineRef = useRef<string | null>(null);
  useEffect(() => {
    if (playback.state === "unavailable") {
      wasUnavailableRef.current = true;
      setStatusMessage("播放资产当前没有在线成员可提供。");
    } else if (wasUnavailableRef.current && playback.state === "live") {
      wasUnavailableRef.current = false;
      setStatusMessage("成员端播放资产已恢复。");
    }
  }, [playback.state, setStatusMessage]);

  useEffect(() => {
    if (playback.state === "live") {
      setSourceStartState("live");
      setMediaConnectionState("live");
      setLastSourceStartError(null);
      return;
    }
    if (playback.state === "buffering") {
      setSourceStartState("starting");
      setMediaConnectionState("buffering");
      return;
    }
    if (playback.state === "awaiting-unlock") {
      setSourceStartState("awaiting-unlock");
      setMediaConnectionState("connecting");
      return;
    }
    if (playback.state === "unavailable") {
      const message = "播放资产当前没有在线成员可提供。";
      setSourceStartState("failed");
      setMediaConnectionState("failed");
      setLastSourceStartError(message);
      return;
    }
    setSourceStartState("idle");
    setMediaConnectionState("idle");
  }, [
    playback.state,
    setLastSourceStartError,
    setMediaConnectionState,
    setSourceStartState
  ]);

  useEffect(() => {
    if (playback.state !== "ended") return;
    const room = roomSnapshot?.room;
    const activePlayback = room?.playback;
    if (!room || !activePlayback?.currentTrackId) return;
    const leaderPeerId = room.members
      .flatMap((member) => member.peerId ? [member.peerId] : [])
      .sort()[0];
    if (leaderPeerId !== localPeerId) return;
    const timelineKey = [
      activePlayback.currentTrackId,
      activePlayback.mediaEpoch,
      activePlayback.startAt
    ].join(":");
    if (completedTimelineRef.current === timelineKey) return;
    completedTimelineRef.current = timelineKey;
    void onPlaybackEnded();
  }, [localPeerId, onPlaybackEnded, playback.state, roomSnapshot]);

  return playback;
}
