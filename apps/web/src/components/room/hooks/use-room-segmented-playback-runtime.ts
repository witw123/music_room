"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { RoomSnapshot, TrackMeta } from "@music-room/shared";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import {
  useSegmentedOpusPlayback,
  type SegmentedPlaybackSnapshot
} from "@/features/playback/use-segmented-opus-playback";
import { createPlaybackMediaSession } from "@/features/playback/playback-media-session";
import { roomAudioOutput } from "@/features/playback/room-audio-output";
import { resolveCurrentSourcePeerId } from "./use-room-page-derived";

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
    receiverRtpActive?: boolean;
    remoteStream: MediaStream | null;
    remoteTrackId?: string | null;
    } | null;
  restartMediaPeer: (peerId: string) => Promise<unknown>;
  onPlaybackEnded: () => void | Promise<void>;
  setMediaConnectionState: Dispatch<SetStateAction<"idle" | "connecting" | "live" | "buffering" | "reconnecting" | "failed">>;
  setSourceStartState: Dispatch<SetStateAction<"idle" | "awaiting-unlock" | "starting" | "live" | "failed">>;
  setLastSourceStartError: Dispatch<SetStateAction<string | null>>;
  setStatusMessage: (message: string) => void;
  recordPeerDiagnostic: PeerDiagnosticRecorder;
}) {
  const setStatusMessage = input.setStatusMessage;
  const onPlaybackEnded = input.onPlaybackEnded;
  const localPeerId = input.peerId;
  const roomSnapshot = input.roomSnapshot;
  const setLastSourceStartError = input.setLastSourceStartError;
  const setMediaConnectionState = input.setMediaConnectionState;
  const setSourceStartState = input.setSourceStartState;
  const setAudioUnlocked = input.setAudioUnlocked;
  const runtimeInputRef = useRef(input);
  runtimeInputRef.current = input;
  const { audioRef, isCurrentSource, peerId: runtimePeerId } = input;
  const audioUnlocked = input.audioUnlocked;
  const missingMediaSinceRef = useRef<number | null>(null);
  const mediaEnsureKeyRef = useRef<string | null>(null);
  const lastMediaEnsureAtRef = useRef(0);
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
  const localMediaBindingRef = useRef<string | null>(null);
  const roomId = input.roomSnapshot?.room.id ?? null;
  const [mediaPlayback, setMediaPlayback] = useState<SegmentedPlaybackSnapshot>(() => ({
    state: "idle",
    bufferedMs: 0,
    ownedUnitCount: 0,
    totalUnitCount: input.currentTrack?.playbackAsset?.unitCount ?? 0,
    audioContextState: null,
    lastError: null
  }));

  const ensureListenerMediaConnection = useCallback((input: {
    runtime: typeof runtimeInputRef.current;
    sourcePeerId: string;
    trackId: string;
    mediaEpoch: number;
  }) => {
    const recoveryKey = `${input.sourcePeerId}:${input.trackId}:${input.mediaEpoch}`;
    if (mediaEnsureKeyRef.current !== recoveryKey) {
      mediaEnsureKeyRef.current = recoveryKey;
      lastMediaEnsureAtRef.current = 0;
    }
    const now = Date.now();
    if (now - lastMediaEnsureAtRef.current < 2_000) {
      return;
    }
    lastMediaEnsureAtRef.current = now;
    input.runtime.setMediaConnectionState("reconnecting");
    input.runtime.recordPeerDiagnostic({
      peerId: input.sourcePeerId,
      channelKind: "media",
      direction: "local",
      event: "listener-media-ensure",
      summary: `监听端媒体连接或接收轨道缺失，确保媒体连接（${input.trackId}）`,
      level: "warning"
    });
    void input.runtime.restartMediaPeer(input.sourcePeerId).catch((error) => {
      input.runtime.recordPeerDiagnostic({
        peerId: input.sourcePeerId,
        channelKind: "media",
        direction: "local",
        event: "listener-media-ensure-failed",
        summary: `监听端媒体连接确保失败：${String(error)}`,
        level: "error"
      });
    });
  }, []);

  const playback = useSegmentedOpusPlayback({
    roomSnapshot: input.roomSnapshot,
    currentTrack: input.currentTrack,
    peerId: input.peerId,
    isCurrentSource: input.isCurrentSource,
    volume: input.volume,
    audioUnlocked: input.audioUnlocked,
  });

  useEffect(() => {
    const runtime = runtimeInputRef.current;
    const roomPlayback = runtime.roomSnapshot?.room.playback ?? null;
    const sourcePeerId = resolveCurrentSourcePeerId(runtime.roomSnapshot, roomPlayback);
    const remote = sourcePeerId ? runtime.getPeerMediaState(sourcePeerId) : null;
    const visiblePlayback = runtime.isCurrentSource ? playback : mediaPlayback;
    const track = runtime.currentTrack;
    const mediaSession =
      roomPlayback?.currentTrackId && track?.playbackAsset
        ? createPlaybackMediaSession({
            trackId: roomPlayback.currentTrackId,
            playbackAssetId: track.playbackAsset.assetId,
            playback: roomPlayback,
            sourcePeerId,
            outputTrackId: runtime.isCurrentSource ? roomAudioOutput.getBroadcastTrackId() : null,
            remoteTrackId: remote?.remoteTrackId ?? null
          })
        : null;
    const playbackState = toDiagnosticPlaybackState(visiblePlayback.state);
    const isRecovering = visiblePlayback.state === "buffering" ||
      visiblePlayback.sourceHealth === "source-underrun" ||
      visiblePlayback.sourceHealth === "source-silent";

    runtime.recordPeerDiagnostic({
      peerId: "system",
      channelKind: "system",
      direction: "local",
      event: "segmented-playback-status",
      summary: "Segmented Opus playback status updated",
      recordEvent: false,
      update: (snapshot) => ({
        ...snapshot,
        segmentedPlaybackStatus: {
          playbackAssetId: track?.playbackAsset?.assetId ?? null,
          mediaSessionKey: mediaSession?.sessionKey ?? null,
          sourcePeerId,
          isSourceOwner: runtime.isCurrentSource,
          listenerPlaybackState: playbackState,
          sourceStartState: toDiagnosticSourceStartState(visiblePlayback.state),
          audioContextState: visiblePlayback.audioContextState,
          outputTrackId: mediaSession?.outputTrackId ?? null,
          remoteTrackId: mediaSession?.remoteTrackId ?? null,
          bufferedAheadMs: runtime.isCurrentSource ? visiblePlayback.bufferedMs : 0,
          scheduledAheadMs: runtime.isCurrentSource ? visiblePlayback.bufferedMs : 0,
          underrunCount: visiblePlayback.underrunCount ?? 0,
          lastUnderrunAt: visiblePlayback.lastUnderrunAt ?? null,
          decodedPeak: runtime.isCurrentSource ? visiblePlayback.decodedPeak ?? null : null,
          decodedRms: runtime.isCurrentSource ? visiblePlayback.decodedRms ?? null : null,
          lastDecodeError: visiblePlayback.lastDecodeError ?? visiblePlayback.lastError,
          mediaRecoveryState: visiblePlayback.state === "unavailable"
            ? "failed"
            : isRecovering
              ? "recovering"
              : visiblePlayback.state === "live"
                ? "reconnected"
                : "idle"
        }
      })
    });
  }, [
    input.currentTrack?.id,
    input.isCurrentSource,
    input.peerId,
    input.roomSnapshot?.room.id,
    input.recordPeerDiagnostic,
    mediaPlayback.audioContextState,
    mediaPlayback.bufferedMs,
    mediaPlayback.lastError,
    mediaPlayback.state,
    mediaPlayback,
    playback.audioContextState,
    playback.bufferedMs,
    playback.decodedPeak,
    playback.decodedRms,
    playback.lastDecodeError,
    playback.lastError,
    playback.lastUnderrunAt,
    playback.sourceHealth,
    playback.state,
    playback.underrunCount,
    playback
  ]);

  useEffect(() => {
    let cancelled = false;
    const runSyncMedia = async () => {
      const runtime = runtimeInputRef.current;
      const roomPlayback = runtime.roomSnapshot?.room.playback ?? null;
      const sourcePeerId = resolveCurrentSourcePeerId(runtime.roomSnapshot, roomPlayback);
      const bitrateKbps = runtime.currentTrack?.playbackAsset
        ? runtime.currentTrack.playbackAsset.bitrate / 1000
        : null;
      const audio = audioRef.current;

      if (runtime.isCurrentSource) {
        missingMediaSinceRef.current = null;
        mediaEnsureKeyRef.current = null;
        boundMediaKeyRef.current = null;
        const sourceStream = runtime.currentTrack?.playbackAsset && roomPlayback?.currentTrackId
          ? roomAudioOutput.getBroadcastDestination()?.stream ?? null
          : null;
        const bindingKey = sourceStream
          ? `source:${sourceStream.id}:${runtime.peerId}:${bitrateKbps ?? "none"}`
          : `source:none:${runtime.peerId}`;
        if (localMediaBindingRef.current !== bindingKey) {
          localMediaBindingRef.current = bindingKey;
        }
        // Keep this idempotent call in the source poll. It lets the manager
        // notice a replaced/ended destination track without renegotiating
        // healthy media on every tick.
        runtime.setLocalAudioStream(sourceStream, runtime.peerId, bitrateKbps);
        return;
      }

      const expectedSourcePeerId = roomPlayback?.status === "playing" ? sourcePeerId : null;
      const listenerBindingKey = `listener:${expectedSourcePeerId ?? "none"}`;
      if (localMediaBindingRef.current !== listenerBindingKey) {
        localMediaBindingRef.current = listenerBindingKey;
        runtime.setLocalAudioStream(null, expectedSourcePeerId, null);
      }
      const remote = sourcePeerId ? runtime.getPeerMediaState(sourcePeerId) : null;
      // Playback revisions and clock anchors can change while the negotiated
      // RTP track stays alive. The element binding follows only Track identity.
      const remoteTrackId = remote?.remoteTrackId ?? null;
      const totalUnitCount = runtime.currentTrack?.playbackAsset?.unitCount ?? 0;
      const hasActiveTimeline = !!roomPlayback?.currentTrackId;
      if (boundMediaKeyRef.current !== remoteTrackId && audio) {
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
      if (!hasActiveTimeline) {
        missingMediaSinceRef.current = null;
        mediaEnsureKeyRef.current = null;
        if (audio) {
          audio.pause();
          audio.srcObject = null;
        }
        boundMediaKeyRef.current = null;
        setMediaPlayback({
          state: roomPlayback ? "paused" : "idle",
          bufferedMs: 0,
          ownedUnitCount: 0,
          totalUnitCount,
          audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
          lastError: null
        });
        return;
      }
      if (roomPlayback?.status !== "playing" && !remote?.remoteStream) {
        missingMediaSinceRef.current = null;
        mediaEnsureKeyRef.current = null;
        setMediaPlayback({
          state: "paused",
          bufferedMs: 0,
          ownedUnitCount: 0,
          totalUnitCount,
          audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
          lastError: null
        });
        return;
      }
      if (remote?.remoteStream && remote.receiverTrackState === "live" && audio) {
        const now = Date.now();
        if (roomPlayback?.status === "playing" && !remote.receiverRtpActive) {
          missingMediaSinceRef.current ??= now;
        } else {
          missingMediaSinceRef.current = null;
          mediaEnsureKeyRef.current = null;
        }
        const health = receiverAudioHealthRef.current;
        if (audio.srcObject !== remote.remoteStream) {
          audio.srcObject = remote.remoteStream;
          health.boundAtMs = Date.now();
          health.lastProgressAtMs = health.boundAtMs;
          health.lastCurrentTime = null;
          health.waitingSinceMs = null;
        }
        boundMediaKeyRef.current = remoteTrackId;
        if (runtime.audioUnlocked) {
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
            runtime.setMediaConnectionState("reconnecting");
            // Keep the same MediaStream binding. Replacing srcObject here
            // destroys the browser jitter buffer and is a common source of
            // repeated silence during short packet-loss bursts.
          }
          const result = await roomAudioOutput.playElement(audio, {
            force: shouldNudge
          });
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
            runtime.setMediaConnectionState("live");
          }
        } else {
          if (!cancelled) {
            setMediaPlayback({
              state: "awaiting-unlock",
              bufferedMs: 0,
              ownedUnitCount: 0,
              totalUnitCount,
              audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
              lastError: null
            });
          }
          return;
        }
        if (!cancelled) {
          setMediaPlayback({
            state: remote?.receiverRtpActive ? "live" : "buffering",
            bufferedMs: 0,
            ownedUnitCount: 0,
            totalUnitCount,
            audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
            lastError: null
          });
        }
        return;
      }

      if (!cancelled) {
        const isPlayingWithoutMedia = roomPlayback?.status === "playing" &&
          !!sourcePeerId &&
          !!roomPlayback.currentTrackId;
        if (isPlayingWithoutMedia && sourcePeerId && roomPlayback.currentTrackId) {
          ensureListenerMediaConnection({
            runtime,
            sourcePeerId,
            trackId: roomPlayback.currentTrackId,
            mediaEpoch: roomPlayback.mediaEpoch
          });
        }
        setMediaPlayback({
          state: isPlayingWithoutMedia ? "buffering" : "idle",
          bufferedMs: 0,
          ownedUnitCount: 0,
          totalUnitCount,
          audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
          lastError: null
        });
      }
    };

    let syncInFlight: Promise<void> | null = null;
    const syncMedia = () => {
      if (syncInFlight) {
        return syncInFlight;
      }
      const operation = runSyncMedia();
      syncInFlight = operation;
      operation.then(
        () => {
          if (syncInFlight === operation) {
            syncInFlight = null;
          }
        },
        () => {
          if (syncInFlight === operation) {
            syncInFlight = null;
          }
        }
      );
      return operation;
    };

    void syncMedia();
    const interval = window.setInterval(() => void syncMedia(), 250);
    const mountedAudio = audioRef.current;
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      runtimeInputRef.current.setLocalAudioStream(null, null, null);
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
      mediaEnsureKeyRef.current = null;
      lastMediaEnsureAtRef.current = 0;
      localMediaBindingRef.current = null;
    };
  }, [
    audioRef,
    isCurrentSource,
    roomId,
    ensureListenerMediaConnection
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
      const previousSourceHealth = lastSourceHealthRef.current;
      lastSourceHealthRef.current = playback.sourceHealth;
      if (playback.sourceHealth === "source-underrun") {
        // The initial underrun is the normal decode warm-up window. It must not
        // be presented as a missing local audio source before RTP is published.
        if (previousSourceHealth) {
          setStatusMessage("WebRTC RTP Opus 音频正在恢复。");
        }
      } else if (playback.sourceHealth === "source-silent") {
        if (previousSourceHealth) {
          setStatusMessage("WebRTC RTP Opus 音频暂时无数据，正在恢复。");
        }
      } else if (playback.sourceHealth === "source-ready") {
        setStatusMessage("WebRTC RTP Opus 播放已启动。");
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

function toDiagnosticPlaybackState(state: SegmentedPlaybackSnapshot["state"]) {
  if (state === "unavailable") {
    return "failed" as const;
  }
  if (state === "ended") {
    return "paused" as const;
  }
  return state;
}

function toDiagnosticSourceStartState(state: SegmentedPlaybackSnapshot["state"]) {
  if (state === "awaiting-unlock") {
    return "awaiting-unlock" as const;
  }
  if (state === "buffering") {
    return "starting" as const;
  }
  if (state === "unavailable") {
    return "failed" as const;
  }
  if (state === "live" || state === "ended") {
    return "live" as const;
  }
  return "idle" as const;
}
