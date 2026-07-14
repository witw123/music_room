"use client";

import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { RoomSnapshot, TrackMeta } from "@music-room/shared";
import {
  useSegmentedOpusPlayback,
  type SegmentedPlaybackSnapshot
} from "@/features/playback/use-segmented-opus-playback";
import { roomAudioOutput } from "@/features/playback/room-audio-output";

export function useRoomSegmentedPlaybackRuntime(input: {
  roomSnapshot: RoomSnapshot | null;
  currentTrack: TrackMeta | null;
  peerId: string;
  isCurrentSource: boolean;
  audioRef: RefObject<HTMLAudioElement | null>;
  volume: number;
  audioUnlocked: boolean;
  setAudioUnlocked: Dispatch<SetStateAction<boolean>>;
  setLocalAudioStream: (stream: MediaStream | null, sourcePeerId: string | null, maxBitrateKbps?: number | null) => void;
  getPeerMediaState: (peerId: string) => {
    receiverTrackState: "none" | "live" | "ended" | "failed";
    remoteStream: MediaStream | null;
  } | null;
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
  const setAudioUnlocked = input.setAudioUnlocked;
  const {
    audioRef,
    audioUnlocked: runtimeAudioUnlocked,
    currentTrack: runtimeCurrentTrack,
    getPeerMediaState,
    isCurrentSource,
    peerId: runtimePeerId,
    roomSnapshot: runtimeRoomSnapshot,
    setLocalAudioStream
  } = input;
  const audioUnlocked = input.audioUnlocked;
  const missingMediaSinceRef = useRef<number | null>(null);
  const boundMediaKeyRef = useRef<string | null>(null);
  const [mediaPlayback, setMediaPlayback] = useState<SegmentedPlaybackSnapshot>(() => ({
    state: "idle",
    bufferedMs: 0,
    ownedUnitCount: 0,
    totalUnitCount: input.currentTrack?.playbackAsset?.unitCount ?? 0,
    audioContextState: null,
    lastError: null
  }));

  const playback = useSegmentedOpusPlayback({
    roomSnapshot: input.roomSnapshot,
    currentTrack: input.currentTrack,
    peerId: input.peerId,
    isCurrentSource: input.isCurrentSource,
    volume: input.volume,
    audioUnlocked: input.audioUnlocked,
  });

  useEffect(() => {
    let cancelled = false;
    const syncMedia = async () => {
      const playback = runtimeRoomSnapshot?.room.playback ?? null;
      const sourcePeerId = playback?.sourcePeerId ??
        (playback?.sourceSessionId
          ? runtimeRoomSnapshot?.room.members.find((member) => member.id === playback.sourceSessionId)?.peerId ?? null
          : null);
      const bitrateKbps = runtimeCurrentTrack?.playbackAsset
        ? runtimeCurrentTrack.playbackAsset.bitrate / 1000
        : null;
      const audio = audioRef.current;
      const mediaKey = [
        playback?.currentTrackId ?? "none",
        playback?.mediaEpoch ?? "none",
        sourcePeerId ?? "none"
      ].join(":");

      if (isCurrentSource) {
        missingMediaSinceRef.current = null;
        boundMediaKeyRef.current = null;
        const sourceStream = playback?.status === "playing"
          ? roomAudioOutput.getBroadcastStream()
          : null;
        setLocalAudioStream(
          sourceStream,
          runtimePeerId,
          bitrateKbps
        );
        return;
      }

      setLocalAudioStream(null, sourcePeerId, null);
      const remote = sourcePeerId ? getPeerMediaState(sourcePeerId) : null;
      if (boundMediaKeyRef.current !== mediaKey && audio) {
        audio.pause();
        audio.srcObject = null;
        boundMediaKeyRef.current = null;
      }
      if (playback?.status !== "playing") {
        missingMediaSinceRef.current = null;
        if (audio) {
          audio.pause();
          audio.srcObject = null;
        }
        boundMediaKeyRef.current = null;
        setMediaPlayback({
          state: playback ? "paused" : "idle",
          bufferedMs: 0,
          ownedUnitCount: 0,
          totalUnitCount: runtimeCurrentTrack?.playbackAsset?.unitCount ?? 0,
          audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
          lastError: null
        });
        return;
      }
      if (remote?.remoteStream && remote.receiverTrackState === "live" && audio) {
        missingMediaSinceRef.current = null;
        if (audio.srcObject !== remote.remoteStream) {
          audio.srcObject = remote.remoteStream;
        }
        boundMediaKeyRef.current = mediaKey;
        if (runtimeAudioUnlocked) {
          const result = await roomAudioOutput.playElement(audio);
          if (!cancelled && !result.ok) {
            setMediaPlayback({
              ...idlePlaybackSnapshot(),
              state: "awaiting-unlock",
              audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
              lastError: result.error
            });
            return;
          }
        } else {
          if (!cancelled) {
            setMediaPlayback({
              state: "awaiting-unlock",
              bufferedMs: 0,
              ownedUnitCount: 0,
              totalUnitCount: runtimeCurrentTrack?.playbackAsset?.unitCount ?? 0,
              audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
              lastError: null
            });
          }
          return;
        }
        if (!cancelled) {
          setMediaPlayback({
            state: "live",
            bufferedMs: 0,
            ownedUnitCount: 0,
            totalUnitCount: runtimeCurrentTrack?.playbackAsset?.unitCount ?? 0,
            audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
            lastError: null
          });
        }
        return;
      }

      if (!cancelled) {
        const now = Date.now();
        missingMediaSinceRef.current ??= now;
        const timedOut = playback?.status === "playing" &&
          now - missingMediaSinceRef.current >= 8_000;
        setMediaPlayback({
          state: timedOut ? "unavailable" : playback?.status === "playing" ? "buffering" : "idle",
          bufferedMs: 0,
          ownedUnitCount: 0,
          totalUnitCount: runtimeCurrentTrack?.playbackAsset?.unitCount ?? 0,
          audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
          lastError: timedOut ? "当前播放源的 WebRTC 音频轨道未建立。" : null
        });
      }
    };

    void syncMedia();
    const interval = window.setInterval(() => void syncMedia(), 250);
    const mountedAudio = audioRef.current;
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      setLocalAudioStream(null, null, null);
      const audio = mountedAudio;
      if (audio && !isCurrentSource) {
        audio.pause();
        audio.srcObject = null;
      }
    };
  }, [
    audioRef,
    getPeerMediaState,
    isCurrentSource,
    runtimeAudioUnlocked,
    runtimeCurrentTrack,
    runtimePeerId,
    runtimeRoomSnapshot,
    setLocalAudioStream
  ]);

  useEffect(() => {
    if (isCurrentSource) {
      return;
    }
    roomAudioOutput.applyVolume({
      localAudio: audioRef.current,
      volume: input.volume
    });
  }, [audioRef, input.volume, isCurrentSource]);

  const lastReportedErrorRef = useRef<string | null>(null);
  const completedTimelineRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      audioUnlocked &&
      playback.state === "awaiting-unlock" &&
      playback.audioContextState !== "running"
    ) {
      setAudioUnlocked(false);
      setStatusMessage("音频上下文已暂停，请点击播放或在房间内交互以恢复声音。");
    }
  }, [
    audioUnlocked,
    playback.audioContextState,
    playback.state,
    setAudioUnlocked,
    setStatusMessage
  ]);

  useEffect(() => {
    if (playback.lastError && playback.lastError !== lastReportedErrorRef.current) {
      lastReportedErrorRef.current = playback.lastError;
      setLastSourceStartError(playback.lastError);
      setStatusMessage(`媒体播放正在自动恢复：${playback.lastError}`);
      return;
    }
    if (!playback.lastError && lastReportedErrorRef.current && playback.state === "live") {
      lastReportedErrorRef.current = null;
      setLastSourceStartError(null);
      setStatusMessage("分段播放已自动恢复。");
    }
  }, [playback.lastError, playback.state, setLastSourceStartError, setStatusMessage]);

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
      if (playback.lastError) {
        setLastSourceStartError(playback.lastError);
      }
      return;
    }
    if (playback.state === "awaiting-unlock") {
      setSourceStartState("awaiting-unlock");
      setMediaConnectionState("connecting");
      return;
    }
    if (playback.state === "ended") {
      setSourceStartState("live");
      setMediaConnectionState("live");
      return;
    }
    if (playback.state === "unavailable") {
      setSourceStartState("failed");
      setMediaConnectionState("failed");
      setLastSourceStartError(playback.lastError ?? "当前播放源媒体轨道不可用。");
      return;
    }
    setSourceStartState("idle");
    setMediaConnectionState("idle");
  }, [
    playback.state,
    playback.lastError,
    setLastSourceStartError,
    setMediaConnectionState,
    setSourceStartState
  ]);

  useEffect(() => {
    if (playback.state !== "ended" || !isCurrentSource) return;
    const room = roomSnapshot?.room;
    const activePlayback = room?.playback;
    if (!room || !activePlayback?.currentTrackId) return;
    if (localPeerId !== runtimePeerId) return;
    const timelineKey = [
      activePlayback.currentTrackId,
      activePlayback.mediaEpoch,
      activePlayback.startAt
    ].join(":");
    if (completedTimelineRef.current === timelineKey) return;
    completedTimelineRef.current = timelineKey;
    void onPlaybackEnded();
  }, [isCurrentSource, localPeerId, onPlaybackEnded, playback.state, roomSnapshot, runtimePeerId]);

  return input.isCurrentSource ? playback : mediaPlayback;
}

function idlePlaybackSnapshot(): SegmentedPlaybackSnapshot {
  return {
    state: "idle",
    bufferedMs: 0,
    ownedUnitCount: 0,
    totalUnitCount: 0,
    audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
    lastError: null
  };
}
