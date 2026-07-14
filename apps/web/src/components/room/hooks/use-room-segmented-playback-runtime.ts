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
    remoteTrackId?: string | null;
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
  const lastSourceHealthRef = useRef<SegmentedPlaybackSnapshot["sourceHealth"]>(undefined);
  const receiverAudioHealthRef = useRef({
    boundAtMs: 0,
    lastProgressAtMs: 0,
    lastCurrentTime: null as number | null,
    waitingSinceMs: null as number | null,
    lastRecoveryAtMs: 0,
    recoveryCount: 0
  });
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
      const roomPlayback = runtimeRoomSnapshot?.room.playback ?? null;
      const sourcePeerId = roomPlayback?.sourcePeerId ??
        (roomPlayback?.sourceSessionId
          ? runtimeRoomSnapshot?.room.members.find((member) => member.id === roomPlayback.sourceSessionId)?.peerId ?? null
          : null);
      const bitrateKbps = runtimeCurrentTrack?.playbackAsset
        ? runtimeCurrentTrack.playbackAsset.bitrate / 1000
        : null;
      const audio = audioRef.current;

      if (isCurrentSource) {
        missingMediaSinceRef.current = null;
        boundMediaKeyRef.current = null;
        const sourceStream = roomPlayback?.status === "playing" &&
          playbackStateIsReady(roomPlayback, playback.sourceHealth)
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
      const mediaKey = [
        roomPlayback?.currentTrackId ?? "none",
        roomPlayback?.mediaEpoch ?? "none",
        sourcePeerId ?? "none",
        remote?.remoteTrackId ?? "none"
      ].join(":");
      if (boundMediaKeyRef.current !== mediaKey && audio) {
        audio.pause();
        audio.srcObject = null;
        boundMediaKeyRef.current = null;
        receiverAudioHealthRef.current = {
          boundAtMs: 0,
          lastProgressAtMs: 0,
          lastCurrentTime: null,
          waitingSinceMs: null,
          lastRecoveryAtMs: 0,
          recoveryCount: 0
        };
      }
      if (roomPlayback?.status !== "playing") {
        missingMediaSinceRef.current = null;
        if (audio) {
          audio.pause();
          audio.srcObject = null;
        }
        boundMediaKeyRef.current = null;
        setMediaPlayback({
          state: roomPlayback ? "paused" : "idle",
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
        const health = receiverAudioHealthRef.current;
        if (audio.srcObject !== remote.remoteStream) {
          audio.srcObject = remote.remoteStream;
          health.boundAtMs = Date.now();
          health.lastProgressAtMs = health.boundAtMs;
          health.lastCurrentTime = null;
          health.waitingSinceMs = null;
        }
        boundMediaKeyRef.current = mediaKey;
        if (runtimeAudioUnlocked) {
          const now = Date.now();
          const startupGraceElapsed = now - health.boundAtMs >= 2_500;
          const waitingTooLong = health.waitingSinceMs !== null &&
            now - health.waitingSinceMs >= 1_500;
          const progressStalled = startupGraceElapsed &&
            now - health.lastProgressAtMs >= 5_000 &&
            audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
          const shouldNudge = waitingTooLong || progressStalled;
          if (shouldNudge && now - health.lastRecoveryAtMs >= 10_000) {
            health.lastRecoveryAtMs = now;
            health.waitingSinceMs = null;
            health.recoveryCount += 1;
            setMediaConnectionState("reconnecting");
            // Keep the same MediaStream binding. Replacing srcObject here
            // destroys the browser jitter buffer and is a common source of
            // repeated silence during short packet-loss bursts.
          }
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
          if (!cancelled && shouldNudge) {
            setMediaConnectionState("live");
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
        const timedOut = roomPlayback?.status === "playing" &&
          now - missingMediaSinceRef.current >= 8_000;
        setMediaPlayback({
          state: timedOut ? "unavailable" : roomPlayback?.status === "playing" ? "buffering" : "idle",
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
      receiverAudioHealthRef.current = {
        boundAtMs: 0,
        lastProgressAtMs: 0,
        lastCurrentTime: null,
        waitingSinceMs: null,
        lastRecoveryAtMs: 0,
        recoveryCount: 0
      };
    };
  }, [
    audioRef,
    getPeerMediaState,
    isCurrentSource,
    runtimeAudioUnlocked,
    runtimeCurrentTrack,
    runtimePeerId,
    runtimeRoomSnapshot,
    playback.sourceHealth,
    setLocalAudioStream,
    setMediaConnectionState
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || isCurrentSource) {
      return;
    }

    const health = receiverAudioHealthRef.current;
    const markProgress = () => {
      const now = Date.now();
      const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : null;
      const advanced = currentTime !== null && (
        health.lastCurrentTime === null || currentTime > health.lastCurrentTime + 0.01
      );
      if (advanced || !audio.paused) {
        health.lastProgressAtMs = now;
      }
      health.lastCurrentTime = currentTime;
      health.waitingSinceMs = null;
    };
    const markWaiting = () => {
      health.waitingSinceMs ??= Date.now();
    };

    audio.addEventListener("playing", markProgress);
    audio.addEventListener("timeupdate", markProgress);
    audio.addEventListener("canplay", markProgress);
    audio.addEventListener("waiting", markWaiting);
    audio.addEventListener("stalled", markWaiting);
    audio.addEventListener("error", markWaiting);
    return () => {
      audio.removeEventListener("playing", markProgress);
      audio.removeEventListener("timeupdate", markProgress);
      audio.removeEventListener("canplay", markProgress);
      audio.removeEventListener("waiting", markWaiting);
      audio.removeEventListener("stalled", markWaiting);
      audio.removeEventListener("error", markWaiting);
    };
  }, [audioRef, isCurrentSource]);

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
    if (!input.isCurrentSource) {
      lastSourceHealthRef.current = undefined;
      return;
    }
    if (playback.sourceHealth && playback.sourceHealth !== lastSourceHealthRef.current) {
      lastSourceHealthRef.current = playback.sourceHealth;
      if (playback.sourceHealth === "source-underrun") {
        setStatusMessage("本地音频供给不足，正在预读并恢复播放。");
      } else if (playback.sourceHealth === "source-silent") {
        setStatusMessage("本地音频轨道暂时无能量，正在检查 AudioContext 和输出轨道。");
      } else if (playback.sourceHealth === "source-ready") {
        setStatusMessage("音频源已就绪，正在通过 WebRTC 实时发送。");
      }
    }
  }, [input.isCurrentSource, playback.sourceHealth, setStatusMessage]);

  useEffect(() => {
    if (input.isCurrentSource) {
      if (playback.sourceHealth === "source-underrun") {
        setMediaConnectionState("buffering");
      } else if (playback.sourceHealth === "source-silent") {
        setMediaConnectionState("reconnecting");
      } else if (playback.sourceHealth === "source-ready") {
        setMediaConnectionState("live");
      }
    }
  }, [input.isCurrentSource, playback.sourceHealth, setMediaConnectionState]);

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

function playbackStateIsReady(
  _playback: { status?: string } | null,
  sourceHealth?: SegmentedPlaybackSnapshot["sourceHealth"]
) {
  return sourceHealth === undefined || sourceHealth === "source-ready";
}
