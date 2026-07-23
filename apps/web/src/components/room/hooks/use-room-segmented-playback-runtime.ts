"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import type { PlaybackSnapshot, RoomSnapshot, TrackMeta } from "@music-room/shared";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import { maximumAudioBitrateKbps } from "@/features/p2p/audio-bitrate-policy";
import {
  useSegmentedOpusPlayback,
  type PlaybackAudioPath,
  type SegmentedPlaybackSnapshot
} from "@/features/playback/use-segmented-opus-playback";
import { createPlaybackMediaSession } from "@/features/playback/playback-media-session";
import { roomAudioOutput } from "@/features/playback/room-audio-output";
import { getRoomPlaybackClockNowMs } from "@/features/playback/room-playback-clock";
import {
  ensureOfflineProviderPlaybackAsset,
  resolveOfflineProviderSource
} from "@/features/playback/offline-source-fallback";
import { getRoomLocalAudioFile } from "@/features/upload/local-audio-storage";
import {
  appSettingsChangeEvent,
  getAppSettings
} from "@/features/settings/settings-store";
import { resolveCurrentSourcePeerId } from "./use-room-page-derived";

const receiverBufferingGraceMs = 3_000;
const localAudioSeekToleranceSeconds = 0.35;
const localAudioMetadataTimeoutMs = 8_000;

type LocalAudioResolutionStatus = "idle" | "checking" | "available" | "missing";

type LocalAudioResolution = {
  key: string | null;
  status: LocalAudioResolutionStatus;
  file: Blob | null;
  error: string | null;
};

type LocalAudioObjectUrl = {
  key: string;
  url: string;
};

export type ReceiverAudioHealth = {
  lastProgressAtMs: number;
  lastCurrentTime: number | null;
  hasStarted: boolean;
  waitingSinceMs: number | null;
};

export function recordReceiverAudioProgress(input: {
  health: ReceiverAudioHealth;
  event: "playing" | "progress";
  currentTime: number | null;
  nowMs: number;
}) {
  const currentTime = input.currentTime !== null && Number.isFinite(input.currentTime)
    ? input.currentTime
    : null;
  const previousTime = input.health.lastCurrentTime;
  const advanced = currentTime !== null && (
    previousTime !== null
      ? currentTime > previousTime + 0.01
      : currentTime > 0.01
  );

  if (input.event === "playing") {
    input.health.hasStarted = true;
  }
  if (advanced) {
    input.health.lastProgressAtMs = input.nowMs;
    input.health.hasStarted = true;
    input.health.waitingSinceMs = null;
  }
  input.health.lastCurrentTime = currentTime;
  return advanced;
}

export function resolveRoomAudioPositionMs(
  playback: Pick<PlaybackSnapshot, "status" | "positionMs" | "startedAt" | "startAt">,
  nowMs = getRoomPlaybackClockNowMs()
) {
  if (playback.status !== "playing") {
    return Math.max(0, playback.positionMs);
  }

  const anchorAt = playback.startedAt ?? playback.startAt ?? null;
  const anchorMs = anchorAt ? Date.parse(anchorAt) : Number.NaN;
  if (!Number.isFinite(anchorMs)) {
    return Math.max(0, playback.positionMs);
  }

  return Math.max(0, playback.positionMs + Math.max(0, nowMs - anchorMs));
}

function resolveLocalAudioTrackKey(track: TrackMeta | null | undefined) {
  return track ? `${track.id}:${track.fileHash}` : null;
}

function resolveLocalAudioTimelineKey(playback: PlaybackSnapshot) {
  return [
    playback.currentTrackId ?? "none",
    playback.mediaEpoch,
    playback.status,
    playback.startedAt ?? playback.startAt ?? "none",
    playback.status === "playing" ? "playing" : playback.positionMs
  ].join(":");
}

export function resolveRoomAudioPath(input: {
  isCurrentSource: boolean;
  nativeLocalAudio: boolean;
  localFallback: boolean;
}): PlaybackAudioPath {
  if (input.nativeLocalAudio) {
    return "local-file";
  }
  if (input.localFallback) {
    return "local-segmented";
  }
  return input.isCurrentSource ? "broadcast-segmented" : "remote-stream";
}

function isAudioPlaybackBlockedError(error: string | null) {
  return !!error && /notallowed|autoplay|user gesture|blocked/i.test(error);
}

function waitForLocalAudioMetadata(audio: HTMLAudioElement) {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("error", onError);
      window.clearTimeout(timeout);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const onLoadedMetadata = () => finish();
    const onError = () => finish(new Error("本地音频文件无法解码。"));
    const timeout = window.setTimeout(
      () => finish(new Error("本地音频文件读取超时。")),
      localAudioMetadataTimeoutMs
    );
    audio.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
    audio.addEventListener("error", onError, { once: true });

    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      finish();
    }
  });
}

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
  restartMediaPeer: (peerId: string, options?: { forceRecreate?: boolean }) => Promise<unknown>;
  onPlaybackEnded: () => void | Promise<void>;
  setMediaConnectionState: Dispatch<SetStateAction<"idle" | "connecting" | "live" | "buffering" | "reconnecting" | "failed">>;
  setSourceStartState: Dispatch<SetStateAction<"idle" | "awaiting-unlock" | "starting" | "live" | "failed">>;
  setLastSourceStartError: Dispatch<SetStateAction<string | null>>;
  setStatusMessage: (message: string) => void;
  recordPeerDiagnostic: PeerDiagnosticRecorder;
  audibleRef: MutableRefObject<boolean | null>;
  localFallbackAsset?: TrackMeta["playbackAsset"] | null;
}) {
  const setStatusMessage = input.setStatusMessage;
  const onPlaybackEnded = input.onPlaybackEnded;
  const localPeerId = input.peerId;
  const roomSnapshot = input.roomSnapshot;
  const setLastSourceStartError = input.setLastSourceStartError;
  const setMediaConnectionState = input.setMediaConnectionState;
  const setSourceStartState = input.setSourceStartState;
  const setAudioUnlocked = input.setAudioUnlocked;
  const [playbackPreferences, setPlaybackPreferences] = useState(
    () => getAppSettings().playback
  );

  useEffect(() => {
    const syncPlaybackPreferences = () => setPlaybackPreferences(getAppSettings().playback);
    syncPlaybackPreferences();
    window.addEventListener(appSettingsChangeEvent, syncPlaybackPreferences);
    window.addEventListener("storage", syncPlaybackPreferences);
    return () => {
      window.removeEventListener(appSettingsChangeEvent, syncPlaybackPreferences);
      window.removeEventListener("storage", syncPlaybackPreferences);
    };
  }, []);

  const { preventOfflineAutoLoad, streamingOnlyPlayback } = playbackPreferences;
  const offlineSource = resolveOfflineProviderSource({
    roomSnapshot: input.roomSnapshot,
    track: input.currentTrack
  });
  const sourceMemberPresenceState = input.roomSnapshot?.room.members.find(
    (member) => member.id === (input.roomSnapshot?.room.playback.sourceSessionId ?? input.currentTrack?.ownerSessionId)
  )?.presenceState ?? null;
  const offlineFallbackInputRef = useRef({
    roomSnapshot: input.roomSnapshot,
    track: input.currentTrack,
    source: offlineSource
  });
  offlineFallbackInputRef.current = {
    roomSnapshot: input.roomSnapshot,
    track: input.currentTrack,
    source: offlineSource
  };
  const [offlineFallbackAsset, setOfflineFallbackAsset] = useState<TrackMeta["playbackAsset"] | null>(null);
  const localAudioTrackKey = resolveLocalAudioTrackKey(input.currentTrack);
  const [localAudioResolution, setLocalAudioResolution] = useState<LocalAudioResolution>({
    key: null,
    status: "idle",
    file: null,
    error: null
  });
  const runtimeInputRef = useRef({
    ...input,
    localFallbackAsset: null as TrackMeta["playbackAsset"] | null,
    localAudioResolution: {
      key: null as string | null,
      status: "idle" as LocalAudioResolutionStatus,
      file: null as Blob | null,
      error: null as string | null
    } satisfies LocalAudioResolution
  });
  runtimeInputRef.current = {
    ...input,
    localFallbackAsset: offlineFallbackAsset,
    localAudioResolution
  };
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
    hasStarted: false,
    waitingSinceMs: null as number | null,
    lastRecoveryAtMs: 0,
    recoveryCount: 0
  });
  const localMediaBindingRef = useRef<string | null>(null);
  const localAudioObjectUrlRef = useRef<LocalAudioObjectUrl | null>(null);
  const localAudioReadyKeyRef = useRef<string | null>(null);
  const localAudioTimelineKeyRef = useRef<string | null>(null);
  const failedLocalAudioKeysRef = useRef<Set<string>>(new Set());
  const roomId = input.roomSnapshot?.room.id ?? null;
  const [mediaPlayback, setMediaPlayback] = useState<SegmentedPlaybackSnapshot>(() => ({
    state: "idle",
    bufferedMs: 0,
    ownedUnitCount: 0,
    totalUnitCount: input.currentTrack?.playbackAsset?.unitCount ?? 0,
    audioContextState: null,
    lastError: null
  }));

  useEffect(() => {
    const track = input.currentTrack;
    if (!track || !localAudioTrackKey) {
      setLocalAudioResolution((current) => current.status === "idle" && current.key === null
        ? current
        : {
            key: null,
            status: "idle",
            file: null,
            error: null
          });
      return;
    }

    if (streamingOnlyPlayback) {
      setLocalAudioResolution({
        key: localAudioTrackKey,
        status: "missing",
        file: null,
        error: null
      });
      return;
    }

    if (failedLocalAudioKeysRef.current.has(localAudioTrackKey)) {
      setLocalAudioResolution({
        key: localAudioTrackKey,
        status: "missing",
        file: null,
        error: "本地音频文件不可播放。"
      });
      return;
    }

    let cancelled = false;
    // Do not flip an already-resolved key back to "checking". That briefly
    // cleared the source media fanout on every redundant effect re-run.
    setLocalAudioResolution((current) => {
      if (
        current.key === localAudioTrackKey &&
        (current.status === "available" || current.status === "missing")
      ) {
        return current;
      }
      return {
        key: localAudioTrackKey,
        status: "checking",
        file: null,
        error: null
      };
    });
    void getRoomLocalAudioFile({
      trackId: track.id,
      fileHash: track.fileHash,
      title: track.title,
      mimeType: track.mimeType ?? "audio/mpeg",
      originalAssetId: track.originalAsset?.assetId ?? null
    }).then((file) => {
      if (cancelled) return;
      setLocalAudioResolution({
        key: localAudioTrackKey,
        status: file ? "available" : "missing",
        file,
        error: null
      });
    }).catch((error) => {
      if (cancelled) return;
      setLocalAudioResolution({
        key: localAudioTrackKey,
        status: "missing",
        file: null,
        error: error instanceof Error && error.message.trim()
          ? error.message
          : "本地音频文件读取失败。"
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    input.currentTrack?.fileHash,
    input.currentTrack?.id,
    input.currentTrack?.mimeType,
    input.currentTrack?.originalAsset?.assetId,
    input.currentTrack?.title,
    localAudioTrackKey,
    streamingOnlyPlayback
  ]);

  useEffect(() => {
    const fallbackInput = offlineFallbackInputRef.current;
    if (
      input.isCurrentSource ||
      preventOfflineAutoLoad ||
      streamingOnlyPlayback ||
      localAudioResolution.status !== "missing" ||
      !fallbackInput.source ||
      !fallbackInput.roomSnapshot ||
      !fallbackInput.track
    ) {
      setOfflineFallbackAsset(null);
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();
    setOfflineFallbackAsset(null);
    setStatusMessage(`成员不在线，正在从${fallbackInput.source.label}获取歌曲并导入曲库…`);
    void ensureOfflineProviderPlaybackAsset({
      roomSnapshot: fallbackInput.roomSnapshot,
      track: fallbackInput.track,
      source: fallbackInput.source,
      onStatus: setStatusMessage,
      signal: abortController.signal
    }).then((result) => {
      if (!cancelled) {
        if (result.file) {
          setOfflineFallbackAsset(null);
          setLocalAudioResolution({
            key: localAudioTrackKey,
            status: "available",
            file: result.file,
            error: null
          });
        } else {
          setOfflineFallbackAsset(result.playbackAsset);
        }
      }
    }).catch((error) => {
      if (cancelled) return;
      const detail = error instanceof Error && error.message.trim()
        ? error.message
        : "平台音频暂时不可用，请稍后重试。";
      setStatusMessage(`成员不在线，无法从${fallbackInput.source?.label ?? "音乐平台"}获取《${fallbackInput.track?.title ?? "当前歌曲"}》：${detail}`);
    });

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [
    input.currentTrack?.id,
    input.currentTrack?.title,
    input.currentTrack?.ownerSessionId,
    input.currentTrack?.sourceRef?.trackId,
    input.currentTrack?.sourceType,
    input.isCurrentSource,
    input.roomSnapshot?.room.id,
    input.roomSnapshot?.room.playback.currentTrackId,
    input.roomSnapshot?.room.playback.sourceSessionId,
    input.roomSnapshot?.room.playback.status,
    localAudioTrackKey,
    localAudioResolution.status,
    offlineSource?.label,
    offlineSource?.provider,
    offlineSource?.trackId,
    preventOfflineAutoLoad,
    setStatusMessage,
    sourceMemberPresenceState,
    streamingOnlyPlayback
  ]);

  const ensureListenerMediaConnection = useCallback((input: {
    runtime: typeof runtimeInputRef.current;
    sourcePeerId: string;
    trackId: string;
    mediaEpoch: number;
    forceRecreate?: boolean;
  }) => {
    const recoveryKey = `${input.sourcePeerId}:${input.trackId}:${input.mediaEpoch}`;
    if (mediaEnsureKeyRef.current !== recoveryKey) {
      mediaEnsureKeyRef.current = recoveryKey;
      lastMediaEnsureAtRef.current = 0;
    }
    const now = Date.now();
    // Aggressive 2s recreates tore down healthy ICE sessions while the source
    // was still attaching its track, producing the listen-side sound/silence
    // cycle. Soft recovery every 8s is enough for genuine missing-track cases.
    if (now - lastMediaEnsureAtRef.current < 8_000) {
      return;
    }
    lastMediaEnsureAtRef.current = now;
    const remote = input.runtime.getPeerMediaState(input.sourcePeerId);
    const hasLiveReceiver = remote?.receiverTrackState === "live" && !!remote.remoteStream;
    if (hasLiveReceiver && !input.forceRecreate) {
      return;
    }
    input.runtime.setMediaConnectionState("reconnecting");
    input.runtime.recordPeerDiagnostic({
      peerId: input.sourcePeerId,
      channelKind: "media",
      direction: "local",
      event: "listener-media-ensure",
      summary: `监听端媒体连接或接收轨道缺失，确保媒体连接（${input.trackId}）`,
      level: "warning"
    });
    void input.runtime.restartMediaPeer(input.sourcePeerId, {
      // Never force-recreate from the poll path. Force recreate is reserved for
      // explicit source-side wedged-sender recovery and races empty media offers.
      forceRecreate: false
    }).catch((error) => {
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

  const clearLocalAudioSource = useCallback((audio: HTMLAudioElement | null) => {
    // Disconnect before changing src. MediaElementAudioSourceNode is tied to
    // the element for the lifetime of the AudioContext; leaving the graph
    // connected across a failed decode or track switch can strand the next
    // source or keep stale audio flowing into the room broadcast.
    roomAudioOutput.unbindLocalAudioElement(audio);
    if (audio) {
      try {
        audio.pause();
        audio.srcObject = null;
        audio.removeAttribute("src");
        audio.load();
      } catch {
        // Media element cleanup is best effort during room transitions.
      }
    }

    const objectUrl = localAudioObjectUrlRef.current?.url;
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    localAudioObjectUrlRef.current = null;
    localAudioReadyKeyRef.current = null;
    localAudioTimelineKeyRef.current = null;
  }, []);

  const markLocalAudioUnavailable = useCallback((key: string, error: string) => {
    failedLocalAudioKeysRef.current.add(key);
    setLocalAudioResolution((current) => current.key === key
      ? {
          key,
          status: "missing",
          file: null,
          error
        }
      : current);
  }, []);

  const playback = useSegmentedOpusPlayback({
    roomSnapshot: input.roomSnapshot,
    currentTrack: input.currentTrack,
    localFallbackAsset: offlineFallbackAsset,
    peerId: input.peerId,
    isCurrentSource: input.isCurrentSource,
    disableSourcePlayback: input.isCurrentSource && localAudioResolution.status !== "missing",
    volume: input.volume,
    audioUnlocked: input.audioUnlocked,
  });

  useEffect(() => {
    const runtime = runtimeInputRef.current;
    const roomPlayback = runtime.roomSnapshot?.room.playback ?? null;
    const sourcePeerId = resolveCurrentSourcePeerId(runtime.roomSnapshot, roomPlayback);
    const remote = sourcePeerId ? runtime.getPeerMediaState(sourcePeerId) : null;
    const usesNativeLocalAudio = runtime.localAudioResolution.status === "available";
    const usesLocalAudio = !runtime.isCurrentSource && usesNativeLocalAudio;
    const usesOfflineFallback = !runtime.isCurrentSource &&
      !!runtime.localFallbackAsset && !usesLocalAudio;
    const usesSegmentedPlayback = (runtime.isCurrentSource && !usesNativeLocalAudio) || usesOfflineFallback;
    const visiblePlayback = usesSegmentedPlayback ? playback : mediaPlayback;
    const track = runtime.currentTrack;
    const mediaSession =
      roomPlayback?.currentTrackId && track?.playbackAsset
        ? createPlaybackMediaSession({
            trackId: roomPlayback.currentTrackId,
            playbackAssetId: track.playbackAsset.assetId,
            playback: roomPlayback,
            sourcePeerId,
            outputTrackId: runtime.isCurrentSource ? roomAudioOutput.getBroadcastTrackId() : null,
            remoteTrackId: usesLocalAudio ? null : remote?.remoteTrackId ?? null
          })
        : null;
    const playbackState = toDiagnosticPlaybackState(visiblePlayback.state);
    const isAudible = isSegmentedPlaybackAudible({
      state: visiblePlayback.state,
      isCurrentSource: runtime.isCurrentSource,
      sourceHealth: visiblePlayback.sourceHealth,
      nativeLocalAudio: usesNativeLocalAudio
    });
    runtime.audibleRef.current = isAudible;
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
          bufferedAheadMs: usesSegmentedPlayback ? visiblePlayback.bufferedMs : 0,
          scheduledAheadMs: usesSegmentedPlayback ? visiblePlayback.bufferedMs : 0,
          underrunCount: visiblePlayback.underrunCount ?? 0,
          lastUnderrunAt: visiblePlayback.lastUnderrunAt ?? null,
          decodedPeak: usesSegmentedPlayback ? visiblePlayback.decodedPeak ?? null : null,
          decodedRms: usesSegmentedPlayback ? visiblePlayback.decodedRms ?? null : null,
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
    localAudioResolution.status,
    offlineFallbackAsset?.assetId,
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
        ? maximumAudioBitrateKbps
        : null;
      const audio = audioRef.current;

      if (runtime.isCurrentSource && runtime.localAudioResolution.status !== "available") {
        missingMediaSinceRef.current = null;
        mediaEnsureKeyRef.current = null;
        boundMediaKeyRef.current = null;
        if (
          localAudioObjectUrlRef.current ||
          localMediaBindingRef.current?.endsWith(":local") ||
          localMediaBindingRef.current?.startsWith("listener:local:") ||
          localMediaBindingRef.current?.startsWith("source:local:")
        ) {
          roomAudioOutput.unbindLocalAudioElement(audio);
          clearLocalAudioSource(audio);
          roomAudioOutput.releaseRoomAudioSession();
        }
        if (runtime.localAudioResolution.status !== "missing") {
          // While IndexedDB resolves local audio availability, keep the source
          // role (and any existing broadcast stream). Clearing sourcePeerId
          // here used to release every media peer mid-playback and push
          // listeners into a connect/silence recovery loop.
          if (
            runtime.localAudioResolution.status === "checking" ||
            runtime.localAudioResolution.status === "idle"
          ) {
            runtime.setLocalAudioStream(
              roomAudioOutput.getBroadcastStream(),
              runtime.peerId,
              bitrateKbps
            );
            if (!cancelled) {
              setMediaPlayback({
                state: roomPlayback?.status === "playing" ? "buffering" : "paused",
                bufferedMs: 0,
                ownedUnitCount: 0,
                totalUnitCount: runtime.currentTrack?.playbackAsset?.unitCount ?? 0,
                audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
                lastError: null
              });
            }
            return;
          }
          runtime.setLocalAudioStream(null, null, null);
          if (!cancelled) {
            setMediaPlayback({
              state: roomPlayback?.status === "playing" ? "buffering" : "paused",
              bufferedMs: 0,
              ownedUnitCount: 0,
              totalUnitCount: runtime.currentTrack?.playbackAsset?.unitCount ?? 0,
              audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
              lastError: null
            });
          }
          return;
        }
        const sourceStream = runtime.currentTrack?.playbackAsset && roomPlayback?.currentTrackId
          && roomPlayback.status === "playing"
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

      const localAudio = runtime.localAudioResolution.status === "available"
        ? runtime.localAudioResolution.file
        : null;
      const localAudioKey = runtime.localAudioResolution.key;
      if (localAudio && localAudioKey) {
        const totalUnitCount = runtime.currentTrack?.playbackAsset?.unitCount ?? 0;
        const hasActiveTimeline = roomPlayback?.currentTrackId === runtime.currentTrack?.id;
        missingMediaSinceRef.current = null;
        mediaEnsureKeyRef.current = null;
        boundMediaKeyRef.current = null;
        runtime.setLocalAudioStream(null, null, null);
        const localBindingKey = `${runtime.isCurrentSource ? "source" : "listener"}:local:${localAudioKey}`;
        if (localMediaBindingRef.current !== localBindingKey) {
          localMediaBindingRef.current = localBindingKey;
          if (!runtime.isCurrentSource) {
            roomAudioOutput.releaseRoomAudioSession();
          }
        }

        if (!audio || !hasActiveTimeline) {
          if (audio) {
            audio.pause();
            audio.srcObject = null;
            if (runtime.isCurrentSource) {
              roomAudioOutput.unbindLocalAudioElement(audio);
            }
            if (localAudioObjectUrlRef.current) {
              clearLocalAudioSource(audio);
            }
          }
          if (!cancelled) {
            setMediaPlayback({
              state: roomPlayback ? "paused" : "idle",
              bufferedMs: 0,
              ownedUnitCount: 0,
              totalUnitCount,
              audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
              lastError: null
            });
          }
          return;
        }

        try {
          const isCurrentLocalAudioRequest = () => {
            const current = runtimeInputRef.current;
            return !cancelled &&
              current.currentTrack?.id === runtime.currentTrack?.id &&
              current.localAudioResolution.key === localAudioKey &&
              current.localAudioResolution.status === "available" &&
              current.localAudioResolution.file === localAudio;
          };
          if (audio.srcObject) {
            audio.pause();
            audio.srcObject = null;
          }
          if (localAudioObjectUrlRef.current?.key !== localAudioKey) {
            clearLocalAudioSource(audio);
            localAudioObjectUrlRef.current = {
              key: localAudioKey,
              url: URL.createObjectURL(localAudio)
            };
          }
          const objectUrl = localAudioObjectUrlRef.current?.url;
          if (!objectUrl) {
            throw new Error("本地音频对象地址创建失败。");
          }
          if (audio.src !== objectUrl) {
            audio.pause();
            audio.preload = "auto";
            audio.src = objectUrl;
            localAudioReadyKeyRef.current = null;
            localAudioTimelineKeyRef.current = null;
            const metadataReady = waitForLocalAudioMetadata(audio);
            audio.load();
            await metadataReady;
            if (!isCurrentLocalAudioRequest()) return;
            localAudioReadyKeyRef.current = localAudioKey;
          } else if (localAudioReadyKeyRef.current !== localAudioKey) {
            const metadataReady = waitForLocalAudioMetadata(audio);
            audio.load();
            await metadataReady;
            if (!isCurrentLocalAudioRequest()) return;
            localAudioReadyKeyRef.current = localAudioKey;
          }

          if (!isCurrentLocalAudioRequest()) return;
          const activeRuntime = runtimeInputRef.current;
          const activeRoomPlayback = activeRuntime.roomSnapshot?.room.playback ?? null;
          if (
            !activeRoomPlayback ||
            activeRoomPlayback.currentTrackId !== activeRuntime.currentTrack?.id
          ) {
            return;
          }
          if (audio.error) {
            throw new Error("本地音频文件无法解码。");
          }

          const timelineKey = resolveLocalAudioTimelineKey(activeRoomPlayback);
          const targetPositionMs = resolveRoomAudioPositionMs(activeRoomPlayback);
          const elementDurationSeconds = Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration
            : Math.max(0, (activeRuntime.currentTrack?.durationMs ?? 0) / 1000);
          const targetSeconds = elementDurationSeconds > 0
            ? Math.min(targetPositionMs / 1000, Math.max(0, elementDurationSeconds - 0.05))
            : targetPositionMs / 1000;
          const shouldForceSync = localAudioTimelineKeyRef.current !== timelineKey;
          if (
            shouldForceSync ||
            !Number.isFinite(audio.currentTime) ||
            Math.abs(audio.currentTime - targetSeconds) >= localAudioSeekToleranceSeconds
          ) {
            audio.currentTime = Math.max(0, targetSeconds);
          }
          localAudioTimelineKeyRef.current = timelineKey;

          if (activeRoomPlayback.status !== "playing") {
            audio.pause();
            if (!cancelled) {
              setMediaPlayback({
                state: "paused",
                bufferedMs: 0,
                ownedUnitCount: 0,
                totalUnitCount,
                audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
                lastError: null
              });
            }
            return;
          }

          const sourceBroadcastStream = activeRuntime.isCurrentSource
            ? roomAudioOutput.bindLocalAudioElement(audio)
            : null;
          if (activeRuntime.isCurrentSource && !sourceBroadcastStream) {
            roomAudioOutput.unbindLocalAudioElement(audio);
            throw new Error("本地音频无法连接到房间广播音频图。");
          }
          activeRuntime.setLocalAudioStream(
            sourceBroadcastStream,
            activeRuntime.isCurrentSource ? activeRuntime.peerId : null,
            activeRuntime.currentTrack?.playbackAsset
              ? maximumAudioBitrateKbps
              : null
          );

          const audioContextState = roomAudioOutput.getSharedAudioContext()?.state ?? null;
          if (!activeRuntime.audioUnlocked || audioContextState !== "running") {
            if (!cancelled) {
              setMediaPlayback({
                state: "awaiting-unlock",
                bufferedMs: 0,
                ownedUnitCount: 0,
                totalUnitCount,
                audioContextState,
                lastError: null
              });
            }
            return;
          }

          if (audio.ended && elementDurationSeconds > 0 && targetSeconds >= elementDurationSeconds - 0.1) {
            audio.pause();
            if (!cancelled) {
              setMediaPlayback({
                state: "paused",
                bufferedMs: 0,
                ownedUnitCount: 0,
                totalUnitCount,
                audioContextState,
                lastError: null
              });
            }
            return;
          }

          const result = await roomAudioOutput.playElement(audio);
          if (!isCurrentLocalAudioRequest()) return;
          if (!result.ok) {
            if (isAudioPlaybackBlockedError(result.error)) {
              setAudioUnlocked(false);
              setMediaPlayback({
                state: "awaiting-unlock",
                bufferedMs: 0,
                ownedUnitCount: 0,
                totalUnitCount,
                audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
                lastError: result.error
              });
              return;
            }
            markLocalAudioUnavailable(localAudioKey, result.error ?? "本地音频播放失败。");
            clearLocalAudioSource(audio);
            return;
          }

          activeRuntime.setMediaConnectionState("live");
          setMediaPlayback({
            state: "live",
            bufferedMs: 0,
            ownedUnitCount: 0,
            totalUnitCount,
            audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
            lastError: null
          });
        } catch (error) {
          if (cancelled) return;
          const detail = error instanceof Error && error.message.trim()
            ? error.message
            : "本地音频播放失败。";
          markLocalAudioUnavailable(localAudioKey, detail);
          clearLocalAudioSource(audio);
        }
        return;
      }

      if (runtime.localFallbackAsset) {
        missingMediaSinceRef.current = null;
        mediaEnsureKeyRef.current = null;
        if (localMediaBindingRef.current !== "listener:local-fallback") {
          localMediaBindingRef.current = "listener:local-fallback";
          roomAudioOutput.releaseRoomAudioSession();
        }
        runtime.setLocalAudioStream(null, null, null);
        if (audio && localAudioObjectUrlRef.current) {
          clearLocalAudioSource(audio);
        } else if (audio) {
          audio.pause();
          audio.srcObject = null;
        }
        boundMediaKeyRef.current = null;
        return;
      }

      if (
        localAudioObjectUrlRef.current ||
        localMediaBindingRef.current?.startsWith("listener:local:")
      ) {
        clearLocalAudioSource(audio);
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
          hasStarted: false,
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
      if (roomPlayback?.status !== "playing") {
        missingMediaSinceRef.current = null;
        mediaEnsureKeyRef.current = null;
        if (audio) {
          // Keep srcObject bound so resume reuses the browser jitter buffer,
          // but never let a paused room continue consuming the remote stream.
          audio.pause();
        }
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
          health.hasStarted = false;
          health.waitingSinceMs = null;
        }
        boundMediaKeyRef.current = remoteTrackId;
        // A remote MediaStream is played directly by the media element. It
        // must not be blocked by the shared AudioContext unlock flag, which is
        // required by local Web Audio graphs but is not part of this path.
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
          const blocked = isAudioPlaybackBlockedError(result.error);
          if (blocked) {
            setAudioUnlocked(false);
          }
          setMediaPlayback({
            ...idlePlaybackSnapshot(),
            state: blocked ? "awaiting-unlock" : "buffering",
            audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
            lastError: blocked ? null : result.error
          });
          return;
        }
        if (!cancelled && !runtime.audioUnlocked) {
          // The remote element can be autoplayable even when the shared
          // AudioContext has not been resumed. Remember that this concrete
          // playback path is usable without forcing a false unlock prompt.
          setAudioUnlocked(true);
        }
        if (!cancelled && shouldNudge) {
          runtime.setMediaConnectionState("live");
        }
        if (cancelled) return;
        if (!cancelled) {
          setMediaPlayback({
            state: resolveReceiverPlaybackState({
              receiverRtpActive: remote?.receiverRtpActive,
              hasStarted: health.hasStarted,
              missingMediaSinceMs: missingMediaSinceRef.current,
              nowMs: now
            }),
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
            mediaEpoch: roomPlayback.mediaEpoch,
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
      runtimeInputRef.current.audibleRef.current = false;
      const audio = mountedAudio;
      roomAudioOutput.unbindLocalAudioElement(audio);
      clearLocalAudioSource(audio);
      receiverAudioHealthRef.current = {
        boundAtMs: 0,
        lastProgressAtMs: 0,
        lastCurrentTime: null,
        hasStarted: false,
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
    clearLocalAudioSource,
    markLocalAudioUnavailable,
    setAudioUnlocked,
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
    const markPlaying = () => {
      recordReceiverAudioProgress({
        health,
        event: "playing",
        currentTime: audio.currentTime,
        nowMs: Date.now()
      });
    };
    const markProgress = () => {
      recordReceiverAudioProgress({
        health,
        event: "progress",
        currentTime: audio.currentTime,
        nowMs: Date.now()
      });
    };
    const markWaiting = () => {
      health.waitingSinceMs ??= Date.now();
    };

    audio.addEventListener("playing", markPlaying);
    audio.addEventListener("timeupdate", markProgress);
    audio.addEventListener("canplay", markProgress);
    audio.addEventListener("waiting", markWaiting);
    audio.addEventListener("stalled", markWaiting);
    audio.addEventListener("error", markWaiting);
    return () => {
      audio.removeEventListener("playing", markPlaying);
      audio.removeEventListener("timeupdate", markProgress);
      audio.removeEventListener("canplay", markProgress);
      audio.removeEventListener("waiting", markWaiting);
      audio.removeEventListener("stalled", markWaiting);
      audio.removeEventListener("error", markWaiting);
    };
  }, [audioRef, isCurrentSource]);

  useEffect(() => {
    const usesNativeLocalAudio = isCurrentSource && localAudioResolution.status === "available";
    if (isCurrentSource && !usesNativeLocalAudio) {
      return;
    }
    roomAudioOutput.applyVolume({
      localAudio: audioRef.current,
      volume: input.volume
    });
  }, [audioRef, input.volume, isCurrentSource, localAudioResolution.status]);

  const lastReportedErrorRef = useRef<string | null>(null);
  const completedTimelineRef = useRef<string | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !input.isCurrentSource) {
      return;
    }

    const handleEnded = () => {
      const runtime = runtimeInputRef.current;
      const roomPlayback = runtime.roomSnapshot?.room.playback;
      if (
        runtime.localAudioResolution.status !== "available" ||
        roomPlayback?.status !== "playing" ||
        roomPlayback.currentTrackId !== runtime.currentTrack?.id
      ) {
        return;
      }
      const timelineKey = [
        roomPlayback.currentTrackId,
        roomPlayback.mediaEpoch,
        roomPlayback.startAt ?? roomPlayback.startedAt
      ].join(":");
      if (completedTimelineRef.current === timelineKey) return;
      completedTimelineRef.current = timelineKey;
      void onPlaybackEnded();
    };

    audio.addEventListener("ended", handleEnded);
    return () => audio.removeEventListener("ended", handleEnded);
  }, [audioRef, input.isCurrentSource, onPlaybackEnded]);

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
      if (
        playback.sourceHealth === "source-silent" &&
        previousSourceHealth &&
        previousSourceHealth !== "source-silent"
      ) {
        // source-silent means that the broadcast RTP track is missing or
        // ended. A quiet song section remains source-ready and never reaches
        // this branch.
        setStatusMessage("WebRTC RTP Opus 媒体链路不可用，正在恢复。");
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
      setMediaConnectionState(
        input.isCurrentSource && playback.sourceHealth === "source-silent"
          ? "reconnecting"
          : "live"
      );
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
    input.isCurrentSource,
    playback.state,
    playback.lastError,
    playback.sourceHealth,
    setLastSourceStartError,
    setMediaConnectionState,
    setSourceStartState
  ]);

  useEffect(() => {
    if (playback.state !== "ended" || (!isCurrentSource && !offlineFallbackAsset)) return;
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
  }, [isCurrentSource, localPeerId, offlineFallbackAsset, onPlaybackEnded, playback.state, roomSnapshot, runtimePeerId]);

  const usesSegmentedSource = input.isCurrentSource && localAudioResolution.status === "missing";
  const audioPath = resolveRoomAudioPath({
    isCurrentSource: input.isCurrentSource,
    nativeLocalAudio: localAudioResolution.status === "available",
    localFallback: !!offlineFallbackAsset
  });
  const effectivePlayback = usesSegmentedSource || !!offlineFallbackAsset ? playback : mediaPlayback;
  return useMemo(
    () => ({ ...effectivePlayback, audioPath }),
    [audioPath, effectivePlayback]
  );
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

export function resolveReceiverPlaybackState(input: {
  receiverRtpActive?: boolean;
  hasStarted: boolean;
  missingMediaSinceMs: number | null;
  nowMs: number;
  graceMs?: number;
}): "buffering" | "live" {
  if (input.receiverRtpActive === true) {
    return "live";
  }
  if (!input.hasStarted) {
    return "buffering";
  }
  if (input.missingMediaSinceMs === null) {
    return "live";
  }
  return input.nowMs - input.missingMediaSinceMs >=
    (input.graceMs ?? receiverBufferingGraceMs)
    ? "buffering"
    : "live";
}

export function isSegmentedPlaybackAudible(input: {
  state: SegmentedPlaybackSnapshot["state"];
  isCurrentSource: boolean;
  sourceHealth?: SegmentedPlaybackSnapshot["sourceHealth"];
  nativeLocalAudio?: boolean;
}) {
  return input.state === "live" && (
    input.nativeLocalAudio === true ||
    !input.isCurrentSource ||
    input.sourceHealth === "source-ready"
  );
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
