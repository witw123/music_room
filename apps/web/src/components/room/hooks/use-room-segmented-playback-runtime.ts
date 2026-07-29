"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import type {
  PlaybackSnapshot,
  RoomPlaybackReadinessInputPayload,
  RoomPlaybackReadinessPayload,
  RoomSnapshot,
  TrackLoudness,
  TrackMeta
} from "@music-room/shared";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import { preferredAudioRtpBitrateKbps } from "@/features/p2p/audio-bitrate-policy";
import {
  useSegmentedOpusPlayback,
  type PlaybackAudioPath,
  type SegmentedPlaybackSnapshot
} from "@/features/playback/use-segmented-opus-playback";
import { createPlaybackMediaSession } from "@/features/playback/playback-media-session";
import { roomAudioOutput } from "@/features/playback/room-audio-output";
import {
  getRoomPlaybackClockNowMs,
  resolveRoomPlaybackPositionMs,
  type RoomPlaybackBarrierClock
} from "@/features/playback/room-playback-clock";
import {
  ensureOfflineProviderPlaybackAsset,
  resolveOfflineProviderSource
} from "@/features/playback/offline-source-fallback";
import { getRoomLocalAudioFile } from "@/features/upload/local-audio-storage";
import { resolveProviderTrackSource } from "@/features/upload/provider-track-identity";
import {
  appSettingsChangeEvent,
  getAppSettings
} from "@/features/settings/settings-store";
import { analyzeAudioBlobLoudness, resolveLoudnessGainDb } from "@/features/playback/loudness";
import { resolveCurrentSourcePeerId } from "./use-room-page-derived";

const receiverBufferingGraceMs = 3_000;
const receiverStartupGraceMs = 2_500;
const receiverProgressRecoveryMs = 5_000;
const receiverRecoveryRetryMs = 10_000;
const localAudioSeekToleranceSeconds = 0.35;
const localAudioMetadataTimeoutMs = 8_000;
const mediaPlaybackCommitIntervalMs = 500;

type LocalAudioResolutionStatus = "idle" | "checking" | "available" | "missing";

type LocalAudioResolution = {
  key: string | null;
  status: LocalAudioResolutionStatus;
  file: Blob | null;
  loudness?: TrackLoudness;
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
  lastRecoveryAtMs?: number;
  recoveryCount?: number;
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

export function shouldRecoverStalledReceiverAudio(input: {
  boundAtMs: number;
  hasStarted: boolean;
  lastProgressAtMs: number;
  nowMs: number;
  receiverRtpActive?: boolean;
  audioPaused?: boolean;
  startupGraceMs?: number;
  recoveryAfterMs?: number;
}) {
  if (!input.hasStarted || input.audioPaused === true) {
    return false;
  }
  const startupStalled = input.receiverRtpActive === false &&
    input.nowMs - input.boundAtMs >= (input.startupGraceMs ?? receiverStartupGraceMs);
  const progressStalled = input.nowMs - input.boundAtMs >=
    (input.startupGraceMs ?? receiverStartupGraceMs) &&
    input.nowMs - input.lastProgressAtMs >= (input.recoveryAfterMs ?? receiverProgressRecoveryMs);
  return startupStalled || progressStalled;
}

export function resolveRoomAudioPositionMs(
  playback: Pick<PlaybackSnapshot, "status" | "positionMs" | "startedAt" | "startAt">,
  nowMs = getRoomPlaybackClockNowMs(),
  barrier?: Pick<RoomPlaybackBarrierClock, "holdPositionMs" | "resumeAtMs"> | null
) {
  return resolveRoomPlaybackPositionMs(playback, 0, nowMs, barrier);
}

function resolveLocalAudioTrackKey(
  track: TrackMeta | null | undefined,
  forceProviderCache: boolean
) {
  if (!track) {
    return null;
  }

  const providerSource = resolveProviderTrackSource(track);
  return [
    track.id,
    track.fileHash,
    forceProviderCache ? "provider-cache" : "room-cache",
    providerSource?.provider ?? "local",
    providerSource?.trackId ?? "none"
  ].join(":");
}

function isProviderTrack(track: TrackMeta | null | undefined) {
  return !!resolveProviderTrackSource(track);
}

function resolveLocalAudioTimelineKey(
  playback: PlaybackSnapshot,
  barrier?: Pick<RoomPlaybackBarrierClock, "holdPositionMs" | "resumeAtMs"> | null
) {
  return [
    playback.currentTrackId ?? "none",
    playback.mediaEpoch,
    playback.status,
    playback.startedAt ?? playback.startAt ?? "none",
    playback.status === "playing" ? "playing" : playback.positionMs,
    barrier?.holdPositionMs ?? "no-hold",
    barrier?.resumeAtMs ?? "no-resume"
  ].join(":");
}

export function resolveRemoteAudioTimelineKey(playback: Pick<
  PlaybackSnapshot,
  | "currentTrackId"
  | "mediaEpoch"
  | "status"
  | "startAt"
  | "startedAt"
  | "playbackRevision"
  | "positionMs"
>) {
  return [
    playback.currentTrackId ?? "none",
    playback.mediaEpoch,
    playback.status,
    playback.startAt ?? playback.startedAt ?? "none",
    playback.status === "playing" ? playback.playbackRevision : playback.positionMs
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

/**
 * A cache preference changes the preferred source, but it must not stop the
 * room source while that cache is being checked or downloaded. The segmented
 * source remains the continuity path until a playable local file exists.
 */
export function shouldDisableSourcePlayback(input: {
  isCurrentSource: boolean;
  localAudioStatus: LocalAudioResolutionStatus;
}) {
  return input.isCurrentSource && input.localAudioStatus === "available";
}

/**
 * A listener's cached file is played directly by the media element. Only a
 * source needs a running AudioContext because its local element is connected
 * to the room broadcast destination.
 */
export function shouldWaitForLocalAudioContext(input: {
  isCurrentSource: boolean;
  audioUnlocked: boolean;
  audioContextState: AudioContextState | null;
}) {
  return input.isCurrentSource && (
    !input.audioUnlocked || input.audioContextState !== "running"
  );
}

export function resolveCacheReadinessState(input: {
  cacheEnabled: boolean;
  localReady: boolean;
  isPreparingProviderCache: boolean;
  localAudioStatus: LocalAudioResolutionStatus;
}): RoomPlaybackReadinessInputPayload["state"] {
  if (!input.cacheEnabled || input.localReady) {
    return "ready";
  }
  // IndexedDB lookup is intentionally not a barrier. A song that is already
  // cached should retain the normal audio path while its local record is read.
  if (input.isPreparingProviderCache) {
    return "waiting";
  }
  return input.localAudioStatus === "missing" ? "failed" : "ready";
}

function isAudioPlaybackBlockedError(error: string | null) {
  return !!error && /notallowed|autoplay|user gesture|blocked/i.test(error);
}

function isRecoverableLocalAudioError(error: string | null) {
  return !!error && /abort|interrupted|cancelled|canceled|pause\(\)|playing request/i.test(error);
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
  setLocalAudioStream: (
    stream: MediaStream | null,
    sourcePeerId: string | null,
    maxBitrateKbps?: number | null,
    mediaTrafficExpected?: boolean
  ) => void;
  setMediaPlaybackEnabled: (enabled: boolean) => void | Promise<void>;
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
  playbackReadiness: RoomPlaybackReadinessPayload[];
  publishPlaybackReadiness: (payload: RoomPlaybackReadinessInputPayload) => void;
  activeSessionId: string | null;
}) {
  const setStatusMessage = input.setStatusMessage;
  const onPlaybackEnded = input.onPlaybackEnded;
  const localPeerId = input.peerId;
  const roomSnapshot = input.roomSnapshot;
  const setLastSourceStartError = input.setLastSourceStartError;
  const setMediaConnectionState = input.setMediaConnectionState;
  const setSourceStartState = input.setSourceStartState;
  const setAudioUnlocked = input.setAudioUnlocked;
  const playbackReadiness = input.playbackReadiness;
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

  const {
    preventOfflineAutoLoad,
    streamingOnlyPlayback,
    fullyCachedPlayback,
    loudnessNormalization
  } = playbackPreferences;
  // Offline auto-cache prevention and stream-only playback take priority over
  // the provider-cache preference when multiple strategies are enabled.
  const forceProviderCache = !preventOfflineAutoLoad &&
    !streamingOnlyPlayback &&
    fullyCachedPlayback &&
    isProviderTrack(input.currentTrack);
  const cacheBarrierEnabled = fullyCachedPlayback &&
    !preventOfflineAutoLoad &&
    !streamingOnlyPlayback &&
    isProviderTrack(input.currentTrack);
  const offlineSource = resolveOfflineProviderSource({
    roomSnapshot: input.roomSnapshot,
    track: input.currentTrack,
    forceProviderCache
  });
  const sourceMemberPresenceState = input.roomSnapshot?.room.members.find(
    (member) => member.id === (input.roomSnapshot?.room.playback.sourceSessionId ?? input.currentTrack?.ownerSessionId)
  )?.presenceState ?? null;
  const fallbackPresenceDependency = forceProviderCache
    ? null
    : sourceMemberPresenceState;
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
  const [isPreparingProviderCache, setIsPreparingProviderCache] = useState(false);
  const localAudioTrackKey = resolveLocalAudioTrackKey(
    input.currentTrack,
    forceProviderCache
  );
  const [localAudioResolution, setLocalAudioResolution] = useState<LocalAudioResolution>({
    key: null,
    status: "idle",
    file: null,
    error: null
  });
  const [barrierClockMs, setBarrierClockMs] = useState(() => getRoomPlaybackClockNowMs());
  const playbackBarrier = useMemo(
    () => resolvePlaybackBarrierState({
      playback: input.roomSnapshot?.room.playback ?? null,
      activeMembers: input.roomSnapshot?.room.members ?? [],
      readiness: playbackReadiness,
      cacheEnabled: cacheBarrierEnabled,
      nowMs: barrierClockMs
    }),
    [
      input.roomSnapshot?.room.members,
      input.roomSnapshot?.room.playback,
      playbackReadiness,
      cacheBarrierEnabled,
      barrierClockMs
    ]
  );
  const readinessRoomId = input.roomSnapshot?.room.id;
  const readinessTrackId = input.roomSnapshot?.room.playback.currentTrackId ?? null;
  const readinessMediaEpoch = input.roomSnapshot?.room.playback.mediaEpoch ?? 0;
  const readinessPlaybackStatus = input.roomSnapshot?.room.playback.status;
  const readinessActiveSessionId = input.activeSessionId;
  const readinessPeerId = input.peerId;
  const publishReadiness = input.publishPlaybackReadiness;
  useEffect(() => {
    if (!playbackBarrier.resumeAtMs || playbackBarrier.resumeAtMs <= getRoomPlaybackClockNowMs()) {
      return;
    }
    const interval = window.setInterval(
      () => setBarrierClockMs(getRoomPlaybackClockNowMs()),
      100
    );
    return () => window.clearInterval(interval);
  }, [playbackBarrier.resumeAtMs]);
  const localAudioLoudness = localAudioResolution.key === localAudioTrackKey
    ? localAudioResolution.loudness
    : undefined;
  const loudnessGainDb = resolveLoudnessGainDb(
    input.currentTrack?.loudness
      ? input.currentTrack
      : localAudioLoudness
        ? { loudness: localAudioLoudness }
        : input.currentTrack,
    loudnessNormalization
  );
  const runtimeInputRef = useRef({
    ...input,
    localFallbackAsset: null as TrackMeta["playbackAsset"] | null,
    forceProviderCache: false,
    cacheBarrierEnabled: false,
    playbackBarrier,
    loudnessGainDb: 0,
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
    localAudioResolution,
    forceProviderCache,
    cacheBarrierEnabled,
    playbackBarrier,
    loudnessGainDb
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
  const nativeAudioHealthRef = useRef({
    lastProgressAtMs: 0,
    lastCurrentTime: null as number | null,
    hasStarted: false
  });
  const localMediaBindingRef = useRef<string | null>(null);
  const localAudioObjectUrlRef = useRef<LocalAudioObjectUrl | null>(null);
  const localAudioReadyKeyRef = useRef<string | null>(null);
  const localAudioTimelineKeyRef = useRef<string | null>(null);
  const remoteAudioTimelineKeyRef = useRef<string | null>(null);
  const failedLocalAudioKeysRef = useRef<Set<string>>(new Set());
  const readinessPublishKeyRef = useRef<string | null>(null);
  const cacheBarrierParticipationRef = useRef(false);
  const roomId = input.roomSnapshot?.room.id ?? null;
  const [mediaPlayback, setMediaPlaybackState] = useState<SegmentedPlaybackSnapshot>(() => ({
    state: "idle",
    bufferedMs: 0,
    ownedUnitCount: 0,
    totalUnitCount: input.currentTrack?.playbackAsset?.unitCount ?? 0,
    audioContextState: null,
    lastError: null
  }));
  const lastMediaPlaybackCommitAtRef = useRef(0);
  const setMediaPlayback = useCallback((
    next: SetStateAction<SegmentedPlaybackSnapshot>
  ) => {
    setMediaPlaybackState((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      const immediate = current.state !== resolved.state ||
        current.playbackIdentity !== resolved.playbackIdentity ||
        current.audioContextState !== resolved.audioContextState ||
        current.sourceHealth !== resolved.sourceHealth ||
        current.lastError !== resolved.lastError ||
        current.lastDecodeError !== resolved.lastDecodeError;
      const now = Date.now();
      if (!immediate && now - lastMediaPlaybackCommitAtRef.current < mediaPlaybackCommitIntervalMs) {
        return current;
      }
      lastMediaPlaybackCommitAtRef.current = now;
      return resolved;
    });
  }, []);

  useEffect(() => {
    const track = input.currentTrack;
    if (!track || !localAudioTrackKey) {
      setLocalAudioResolution((current) => current.status === "idle" && current.key === null
        ? current
        : {
          key: null,
          status: "idle",
          file: null,
          loudness: undefined,
          error: null
        });
      return;
    }

    if (streamingOnlyPlayback && !forceProviderCache) {
      setLocalAudioResolution({
        key: localAudioTrackKey,
        status: "missing",
        file: null,
        loudness: undefined,
        error: null
      });
      return;
    }

    if (failedLocalAudioKeysRef.current.has(localAudioTrackKey)) {
      setLocalAudioResolution({
        key: localAudioTrackKey,
        status: "missing",
        file: null,
        loudness: undefined,
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
        loudness: undefined,
        error: null
      };
    });
    const providerSource = resolveProviderTrackSource(track);
    void getRoomLocalAudioFile({
      trackId: track.id,
      fileHash: track.fileHash,
      title: track.title,
      mimeType: track.mimeType ?? "audio/mpeg",
      originalAssetId: track.originalAsset?.assetId ?? null,
      allowOriginalAsset: !forceProviderCache,
      provider: providerSource?.provider,
      providerTrackId: providerSource?.trackId ?? null
    }).then((file) => {
      if (cancelled) return;
      setLocalAudioResolution({
        key: localAudioTrackKey,
        status: file ? "available" : "missing",
        file,
        ...(track.loudness ? { loudness: track.loudness } : {}),
        error: null
      });
      if (!track.loudness && file) {
        void analyzeAudioBlobLoudness(file).then((loudness) => {
          if (cancelled || !loudness) return;
          setLocalAudioResolution((current) => current.key === localAudioTrackKey
            ? { ...current, loudness }
            : current);
        });
      }
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
    // currentTrack identity is stabilized by resolveStableCurrentTrack; keep it
    // in the dep list for exhaustive-deps without re-adding isCurrentSource,
    // which previously forced unnecessary "checking" resets.
    input.currentTrack,
    input.currentTrack?.fileHash,
    input.currentTrack?.id,
    input.currentTrack?.mimeType,
    input.currentTrack?.originalAsset?.assetId,
    input.currentTrack?.title,
    localAudioTrackKey,
    streamingOnlyPlayback,
    forceProviderCache
  ]);

  useEffect(() => {
    const trackId = readinessTrackId;
    const mediaEpoch = readinessMediaEpoch;
    const cacheEnabled = cacheBarrierEnabled && !!trackId;
    if (!readinessRoomId || !readinessActiveSessionId || !readinessPeerId) {
      return;
    }

    // Normal playback is fully independent from the cache barrier. Send one
    // leave notification when the setting is turned off, then stop all
    // readiness traffic and leave the established audio route untouched.
    if (!cacheEnabled) {
      if (cacheBarrierParticipationRef.current) {
        publishReadiness({
          roomId: readinessRoomId,
          sessionId: readinessActiveSessionId,
          peerId: readinessPeerId,
          trackId,
          mediaEpoch,
          cacheEnabled: false,
          state: "ready"
        });
      }
      cacheBarrierParticipationRef.current = false;
      readinessPublishKeyRef.current = null;
      return;
    }

    cacheBarrierParticipationRef.current = true;
    const localReady = localAudioResolution.status === "available" || !!offlineFallbackAsset;
    const state = resolveCacheReadinessState({
      cacheEnabled,
      localReady,
      isPreparingProviderCache,
      localAudioStatus: localAudioResolution.status
    });
    const key = [
      readinessRoomId ?? "none",
      trackId ?? "none",
      mediaEpoch,
      cacheEnabled,
      state
    ].join(":");
    const payload: RoomPlaybackReadinessInputPayload = {
      roomId: readinessRoomId,
      sessionId: readinessActiveSessionId,
      peerId: readinessPeerId,
      trackId,
      mediaEpoch,
      cacheEnabled,
      state
    };
    if (readinessPublishKeyRef.current !== key) {
      readinessPublishKeyRef.current = key;
      publishReadiness(payload);
    }
    const interval = window.setInterval(
      () => publishReadiness(payload),
      4_000
    );
    return () => window.clearInterval(interval);
  }, [
    cacheBarrierEnabled,
    readinessActiveSessionId,
    readinessPeerId,
    publishReadiness,
    readinessRoomId,
    readinessTrackId,
    readinessMediaEpoch,
    readinessPlaybackStatus,
    localAudioResolution.status,
    offlineFallbackAsset,
    isPreparingProviderCache
  ]);

  useEffect(() => {
    const fallbackInput = offlineFallbackInputRef.current;
    if (
      (!forceProviderCache && (
        input.isCurrentSource ||
        preventOfflineAutoLoad ||
        streamingOnlyPlayback
      )) ||
      localAudioResolution.status !== "missing" ||
      !fallbackInput.source ||
      !fallbackInput.roomSnapshot ||
      !fallbackInput.track
    ) {
      setIsPreparingProviderCache(false);
      setOfflineFallbackAsset(null);
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();
    setIsPreparingProviderCache(true);
    setOfflineFallbackAsset(null);
    setStatusMessage(forceProviderCache
      ? `正在从${fallbackInput.source.label}获取《${fallbackInput.track.title}》并缓存播放…`
      : `成员不在线，正在从${fallbackInput.source.label}获取歌曲并缓存播放…`);
    void ensureOfflineProviderPlaybackAsset({
      roomSnapshot: fallbackInput.roomSnapshot,
      track: fallbackInput.track,
      source: fallbackInput.source,
      forceDownload: forceProviderCache,
      onStatus: setStatusMessage,
      signal: abortController.signal
    }).then((result) => {
      if (!cancelled) {
        setIsPreparingProviderCache(false);
        if (result.file) {
          setOfflineFallbackAsset(null);
          setLocalAudioResolution({
            key: localAudioTrackKey,
            status: "available",
            file: result.file,
            ...(fallbackInput.track?.loudness || result.loudness
              ? { loudness: fallbackInput.track?.loudness ?? result.loudness }
              : {}),
            error: null
          });
          if (!fallbackInput.track?.loudness && !result.loudness) {
            void analyzeAudioBlobLoudness(result.file).then((loudness) => {
              if (cancelled || !loudness) return;
              setLocalAudioResolution((current) => current.key === localAudioTrackKey
                ? { ...current, loudness }
                : current);
            });
          }
        } else {
          setOfflineFallbackAsset(result.playbackAsset);
        }
      }
    }).catch((error) => {
      if (cancelled) return;
      setIsPreparingProviderCache(false);
      const detail = error instanceof Error && error.message.trim()
        ? error.message
        : "平台音频暂时不可用，请稍后重试。";
      setStatusMessage(forceProviderCache
        ? `无法从${fallbackInput.source?.label ?? "音乐平台"}下载并缓存《${fallbackInput.track?.title ?? "当前歌曲"}》：${detail}`
        : `成员不在线，无法从${fallbackInput.source?.label ?? "音乐平台"}下载并缓存《${fallbackInput.track?.title ?? "当前歌曲"}》：${detail}`);
    });

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [
    input.currentTrack?.id,
    input.currentTrack?.title,
    input.currentTrack?.ownerSessionId,
    input.currentTrack?.sourceRef?.provider,
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
    fallbackPresenceDependency,
    streamingOnlyPlayback,
    fullyCachedPlayback,
    forceProviderCache
  ]);

  const ensureListenerMediaConnection = useCallback((input: {
    runtime: typeof runtimeInputRef.current;
    sourcePeerId: string;
    trackId: string;
    mediaEpoch: number;
    forceRecreate?: boolean;
    forceRecovery?: boolean;
  }) => {
    const recoveryKey = `${input.sourcePeerId}:${input.trackId}:${input.mediaEpoch}`;
    if (mediaEnsureKeyRef.current !== recoveryKey) {
      mediaEnsureKeyRef.current = recoveryKey;
      lastMediaEnsureAtRef.current = 0;
    }
    const now = Date.now();
    // Missing-track recovery stays one-shot. A stalled clock is different:
    // the old track can remain live after a soft recovery fails, so permit a
    // bounded retry while keeping the UI and signaling path rate-limited.
    if (
      mediaEnsureKeyRef.current === recoveryKey &&
      lastMediaEnsureAtRef.current > 0 &&
      (!input.forceRecovery || now - lastMediaEnsureAtRef.current < receiverRecoveryRetryMs)
    ) {
      return;
    }
    lastMediaEnsureAtRef.current = now;
    const remote = input.runtime.getPeerMediaState(input.sourcePeerId);
    const hasLiveReceiver = remote?.receiverTrackState === "live" && !!remote.remoteStream;
    const hasRecentReceiverRtp = hasLiveReceiver && remote?.receiverRtpActive === true;
    if (hasRecentReceiverRtp && !input.forceRecovery && !input.forceRecreate) {
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
      forceRecreate: input.forceRecreate === true
    }).catch((error) => {
      if (mediaEnsureKeyRef.current === recoveryKey) {
        // A rejected request is safe to retry on a later poll. A successful
        // request intentionally remains one-shot until a live track arrives.
        lastMediaEnsureAtRef.current = 0;
      }
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
    disableSourcePlayback: shouldDisableSourcePlayback({
      isCurrentSource: input.isCurrentSource,
      localAudioStatus: localAudioResolution.status
    }) || playbackBarrier.blocked,
    playbackBarrier,
    volume: input.volume,
    loudnessGainDb,
    audioUnlocked: input.audioUnlocked,
  });
  const usesNativeLocalAudio = localAudioResolution.status === "available";
  const usesOfflineFallback = !input.isCurrentSource &&
    !!offlineFallbackAsset && !usesNativeLocalAudio;
  const usesSegmentedPlayback = (input.isCurrentSource && !usesNativeLocalAudio) ||
    usesOfflineFallback;
  const visiblePlayback = usesSegmentedPlayback ? playback : mediaPlayback;

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
        ? preferredAudioRtpBitrateKbps
        : null;
      const audio = audioRef.current;

      if (runtime.playbackBarrier.blocked && roomPlayback?.status === "playing") {
        runtime.setMediaPlaybackEnabled(true);
        // Keep the media topology stable while cached participants wait. A
        // null stream tears down the source sender and can leave receivers on
        // a stale, silent track after the barrier opens.
        const waitingSourceStream = runtime.isCurrentSource
          ? (roomAudioOutput.getBroadcastStream() ??
            roomAudioOutput.getBroadcastDestination()?.stream ??
            null)
          : null;
        const waitingSourcePeerId = runtime.isCurrentSource
          ? runtime.peerId
          : sourcePeerId;
        runtime.setLocalAudioStream(
          waitingSourceStream,
          waitingSourcePeerId,
          runtime.isCurrentSource && waitingSourcePeerId
            ? bitrateKbps
            : null,
          runtime.audibleRef.current === true
        );
        if (audio) {
          audio.pause();
        }
        if (!cancelled) {
          setMediaPlayback({
            state: "buffering",
            bufferedMs: 0,
            ownedUnitCount: 0,
            totalUnitCount: runtime.currentTrack?.playbackAsset?.unitCount ?? 0,
            audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
            lastError: "正在等待房间成员完成缓存，随后统一开始播放。"
          });
        }
        return;
      }

      if (runtime.isCurrentSource && runtime.localAudioResolution.status !== "available") {
        runtime.setMediaPlaybackEnabled(true);
        missingMediaSinceRef.current = null;
        mediaEnsureKeyRef.current = null;
        boundMediaKeyRef.current = null;
        remoteAudioTimelineKeyRef.current = null;
        if (
          localAudioObjectUrlRef.current ||
          localMediaBindingRef.current?.endsWith(":local") ||
          localMediaBindingRef.current?.startsWith("listener:local:") ||
          localMediaBindingRef.current?.startsWith("source:local:")
        ) {
          roomAudioOutput.unbindLocalAudioElement(audio);
          clearLocalAudioSource(audio);
          localMediaBindingRef.current = null;
        }
        // The segmented engine is the continuity path while a local file is
        // being checked, downloaded, or rejected. Keep the source identity
        // stable and expose its broadcast destination as soon as the engine
        // creates it; clearing it here makes every listener wait for a new
        // media track during a normal cache transition.
        const sourceStream = roomPlayback?.currentTrackId === runtime.currentTrack?.id
          ? roomAudioOutput.getBroadcastStream()
          : null;
        const sourcePeerId = roomPlayback?.currentTrackId === runtime.currentTrack?.id
          ? runtime.peerId
          : null;
        runtime.setLocalAudioStream(
          sourceStream,
          sourcePeerId,
          sourcePeerId ? bitrateKbps : null,
          runtime.audibleRef.current === true
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

      const localAudio = runtime.localAudioResolution.status === "available"
        ? runtime.localAudioResolution.file
        : null;
      const localAudioKey = runtime.localAudioResolution.key;
      if (localAudio && localAudioKey) {
        runtime.setMediaPlaybackEnabled(runtime.isCurrentSource);
        const totalUnitCount = runtime.currentTrack?.playbackAsset?.unitCount ?? 0;
        const hasActiveTimeline = roomPlayback?.currentTrackId === runtime.currentTrack?.id;
        missingMediaSinceRef.current = null;
        mediaEnsureKeyRef.current = null;
        boundMediaKeyRef.current = null;
        remoteAudioTimelineKeyRef.current = null;
        const localBindingKey = `${runtime.isCurrentSource ? "source" : "listener"}:local:${localAudioKey}`;
        if (localMediaBindingRef.current !== localBindingKey) {
          localMediaBindingRef.current = localBindingKey;
        }

        if (!audio || !hasActiveTimeline) {
          // A source keeps its media peer while actively playing. Clearing the
          // source stream before every local-file sync tick releases the media
          // topology and makes seek/playback look like a reconnect loop.
          runtime.setLocalAudioStream(null, null, null, false);
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
            nativeAudioHealthRef.current = {
              lastProgressAtMs: 0,
              lastCurrentTime: null,
              hasStarted: false
            };
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

          const timelineKey = resolveLocalAudioTimelineKey(
            activeRoomPlayback,
            activeRuntime.playbackBarrier
          );
          const targetPositionMs = resolveRoomAudioPositionMs(
            activeRoomPlayback,
            getRoomPlaybackClockNowMs(),
            activeRuntime.playbackBarrier
          );
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
            // Pause the local timeline without tearing down the source's RTP
            // topology. The destination track remains live and carries
            // silence while the local element is paused, so resume/seek can
            // reuse the same ICE/DTLS session and receiver jitter buffer.
            const sourceBroadcastStream = activeRuntime.isCurrentSource
              ? roomAudioOutput.getBroadcastStream()
              : null;
            const activeMediaSourcePeerId = activeRuntime.isCurrentSource
              ? activeRuntime.peerId
              : null;
            activeRuntime.setLocalAudioStream(
              sourceBroadcastStream,
              activeMediaSourcePeerId,
              activeRuntime.isCurrentSource ? bitrateKbps : null,
              false
            );
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

          let sourceBroadcastStream: MediaStream | null = null;
          if (activeRuntime.isCurrentSource) {
            sourceBroadcastStream = roomAudioOutput.bindLocalAudioElement(audio, {
              loudnessGainDb: activeRuntime.loudnessGainDb,
              broadcast: true,
              volume: activeRuntime.volume
            });
          } else if (
            roomAudioOutput.hasLocalAudioElementSource(audio) ||
            activeRuntime.loudnessGainDb !== 0
          ) {
            // A MediaElementAudioSourceNode permanently takes over the
            // element's output. Reuse it when normalization is active, but
            // leave a default listener on native media output so a cache
            // transition cannot strand the element in a disconnected graph.
            roomAudioOutput.bindLocalAudioElement(audio, {
              broadcast: false,
              loudnessGainDb: activeRuntime.loudnessGainDb,
              volume: activeRuntime.volume
            });
          }
          if (activeRuntime.isCurrentSource && !sourceBroadcastStream) {
            roomAudioOutput.unbindLocalAudioElement(audio);
            throw new Error("本地音频无法连接到房间广播音频图。");
          }
          const activeMediaSourcePeerId = activeRuntime.isCurrentSource
            ? activeRuntime.peerId
            : null;
          activeRuntime.setLocalAudioStream(
            sourceBroadcastStream,
            activeMediaSourcePeerId,
            activeRuntime.currentTrack?.playbackAsset
              ? preferredAudioRtpBitrateKbps
              : null,
            activeRuntime.audibleRef.current === true
          );

          const audioContextState = roomAudioOutput.getSharedAudioContext()?.state ?? null;
          if (shouldWaitForLocalAudioContext({
            isCurrentSource: activeRuntime.isCurrentSource ||
              roomAudioOutput.hasLocalAudioElementSource(audio),
            audioUnlocked: activeRuntime.audioUnlocked,
            audioContextState
          })) {
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
            if (isRecoverableLocalAudioError(result.error)) {
              // A source switch or a competing media-element operation can
              // interrupt play(). Keep the resolved file and retry on the
              // next sync tick instead of poisoning this cache key until the
              // user re-enters the room.
              localAudioReadyKeyRef.current = localAudioKey;
              setMediaPlayback({
                state: "buffering",
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

          if (!activeRuntime.audioUnlocked) {
            // A direct listener cache does not require the shared AudioContext,
            // but it has still passed the browser's concrete media-element
            // autoplay check. Keep the unlock state from triggering a false
            // overlay while preserving the source-side context guard.
            setAudioUnlocked(true);
          }
          const now = Date.now();
          const nativeHealth = nativeAudioHealthRef.current;
          const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : null;
          const advanced = currentTime !== null && (
            nativeHealth.lastCurrentTime === null
              ? currentTime > 0.01
              : currentTime > nativeHealth.lastCurrentTime + 0.01
          );
          if (advanced) {
            nativeHealth.lastProgressAtMs = now;
          }
          nativeHealth.lastCurrentTime = currentTime;
          nativeHealth.hasStarted = nativeHealth.hasStarted || !audio.paused;
          const actuallyPlaying = !audio.paused &&
            audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            nativeHealth.hasStarted &&
            now - nativeHealth.lastProgressAtMs < 1_500;
          activeRuntime.setMediaConnectionState(actuallyPlaying ? "live" : "buffering");
          setMediaPlayback({
            state: actuallyPlaying ? "live" : "buffering",
            bufferedMs: 0,
            ownedUnitCount: 0,
            totalUnitCount,
            audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
            lastError: actuallyPlaying ? null : "音频元素尚未产生实际播放进度。"
          });
        } catch (error) {
          if (cancelled) return;
          const detail = error instanceof Error && error.message.trim()
            ? error.message
            : "本地音频播放失败。";
          if (isRecoverableLocalAudioError(detail)) {
            localAudioReadyKeyRef.current = localAudioKey;
            setMediaPlayback({
              state: "buffering",
              bufferedMs: 0,
              ownedUnitCount: 0,
              totalUnitCount,
              audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
              lastError: detail
            });
            return;
          }
          markLocalAudioUnavailable(localAudioKey, detail);
          clearLocalAudioSource(audio);
        }
        return;
      }

      if (runtime.localFallbackAsset) {
        runtime.setMediaPlaybackEnabled(false);
        missingMediaSinceRef.current = null;
        mediaEnsureKeyRef.current = null;
        if (localMediaBindingRef.current !== "listener:local-fallback") {
          localMediaBindingRef.current = "listener:local-fallback";
          roomAudioOutput.releaseRoomAudioSession();
        }
        runtime.setLocalAudioStream(null, null, null, false);
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

      runtime.setMediaPlaybackEnabled(true);

      const expectedSourcePeerId = roomPlayback?.status === "playing" ? sourcePeerId : null;
      const listenerBindingKey = `listener:${expectedSourcePeerId ?? "none"}`;
      if (localMediaBindingRef.current !== listenerBindingKey) {
        localMediaBindingRef.current = listenerBindingKey;
      }
      // Keep the media peer alive across pause/resume, but only let the
      // lifecycle manager treat missing RTP as a failure after this browser
      // has actually reached audible playback.
      runtime.setLocalAudioStream(
        null,
        expectedSourcePeerId,
        null,
        roomPlayback?.status === "playing" && runtime.audibleRef.current === true
      );
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
        remoteAudioTimelineKeyRef.current = null;
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
        remoteAudioTimelineKeyRef.current = null;
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
        const health = receiverAudioHealthRef.current;
        // Some browsers keep firing `playing` while the MediaStream clock is
        // frozen. Poll the clock as well as listening for media events so a
        // connected-but-silent receiver cannot stay falsely healthy forever.
        recordReceiverAudioProgress({
          health,
          event: "progress",
          currentTime: audio.currentTime,
          nowMs: now
        });
        health.hasStarted = health.hasStarted || !audio.paused;
        const mediaClockStalled = health.hasStarted &&
          now - health.lastProgressAtMs >= receiverBufferingGraceMs;
        // Only clear the one-shot recovery latch after the media clock is
        // moving again. A live track with a frozen clock must remain eligible
        // for recovery instead of resetting the latch every poll.
        if (remote.receiverRtpActive && !mediaClockStalled) {
          mediaEnsureKeyRef.current = null;
          lastMediaEnsureAtRef.current = 0;
        }
        const mediaElementStalled = audio.paused ||
          audio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
          mediaClockStalled;
        if (roomPlayback?.status === "playing" && !remote.receiverRtpActive && mediaElementStalled) {
          missingMediaSinceRef.current ??= now;
        } else if (!mediaClockStalled) {
          missingMediaSinceRef.current = null;
          mediaEnsureKeyRef.current = null;
        }
        if (audio.srcObject !== remote.remoteStream) {
          audio.srcObject = remote.remoteStream;
          health.boundAtMs = Date.now();
          health.lastProgressAtMs = health.boundAtMs;
          health.lastCurrentTime = null;
          health.hasStarted = false;
          health.waitingSinceMs = null;
        }
        if (
          runtime.loudnessGainDb !== 0 ||
          roomAudioOutput.hasLocalAudioElementSource(audio)
        ) {
          roomAudioOutput.bindLocalAudioElement(audio, {
            broadcast: false,
            loudnessGainDb: runtime.loudnessGainDb,
            volume: runtime.volume
          });
        }
        roomAudioOutput.applyVolume({
          localAudio: audio,
          volume: runtime.volume,
          loudnessGainDb: runtime.loudnessGainDb
        });
        boundMediaKeyRef.current = remoteTrackId;
        const remoteTimelineKey = roomPlayback
          ? resolveRemoteAudioTimelineKey(roomPlayback)
          : null;
        const timelineChanged = remoteTimelineKey !== null &&
          remoteAudioTimelineKeyRef.current !== null &&
          remoteAudioTimelineKeyRef.current !== remoteTimelineKey;
        if (remoteTimelineKey !== null) {
          // A seek/resume changes the room clock without replacing the RTP
          // track. Remember it once so the media element gets one controlled
          // play() nudge instead of entering the connection recovery path.
          remoteAudioTimelineKeyRef.current = remoteTimelineKey;
        }
        // A remote MediaStream is played directly by the media element. It
        // must not be blocked by the shared AudioContext unlock flag, which is
        // required by local Web Audio graphs but is not part of this path.
        const waitingTooLong = health.waitingSinceMs !== null &&
          now - health.waitingSinceMs >= 1_500 &&
          mediaElementStalled;
        const progressStalled = shouldRecoverStalledReceiverAudio({
          boundAtMs: health.boundAtMs,
          hasStarted: health.hasStarted,
          lastProgressAtMs: health.lastProgressAtMs,
          nowMs: now,
          receiverRtpActive: remote.receiverRtpActive,
          audioPaused: audio.paused
        });
        const shouldNudge = timelineChanged || waitingTooLong || progressStalled;
        if (shouldNudge && now - health.lastRecoveryAtMs >= 10_000) {
          health.lastRecoveryAtMs = now;
          health.waitingSinceMs = null;
          health.recoveryCount += 1;
          // Keep the same MediaStream binding. Replacing srcObject here
          // destroys the browser jitter buffer and is a common source of
          // repeated silence during short packet-loss bursts.
          if (progressStalled && sourcePeerId && roomPlayback?.currentTrackId) {
            ensureListenerMediaConnection({
              runtime,
              sourcePeerId,
              trackId: roomPlayback.currentTrackId,
              mediaEpoch: roomPlayback.mediaEpoch,
              forceRecovery: true
            });
          }
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
        if (cancelled) return;
        if (!cancelled) {
          setMediaPlayback({
            state: resolveReceiverPlaybackState({
              receiverRtpActive: remote?.receiverRtpActive,
              hasStarted: health.hasStarted,
              lastProgressAtMs: health.lastProgressAtMs,
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
      runtimeInputRef.current.setLocalAudioStream(null, null, null, false);
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
      remoteAudioTimelineKeyRef.current = null;
      mediaEnsureKeyRef.current = null;
      lastMediaEnsureAtRef.current = 0;
      localMediaBindingRef.current = null;
    };
  }, [
    audioRef,
    clearLocalAudioSource,
    markLocalAudioUnavailable,
    setAudioUnlocked,
    setMediaPlayback,
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
      volume: input.volume,
      loudnessGainDb
    });
  }, [audioRef, input.volume, isCurrentSource, localAudioResolution.status, loudnessGainDb]);

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
      usesSegmentedPlayback &&
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
    setStatusMessage,
    usesSegmentedPlayback
  ]);

  useEffect(() => {
    if (visiblePlayback.lastError && visiblePlayback.lastError !== lastReportedErrorRef.current) {
      lastReportedErrorRef.current = visiblePlayback.lastError;
      setLastSourceStartError(visiblePlayback.lastError);
      setStatusMessage(`媒体播放正在自动恢复：${visiblePlayback.lastError}`);
      return;
    }
    if (!visiblePlayback.lastError && lastReportedErrorRef.current && visiblePlayback.state === "live") {
      lastReportedErrorRef.current = null;
      setLastSourceStartError(null);
      setStatusMessage("分段播放已自动恢复。");
    }
  }, [setLastSourceStartError, setStatusMessage, visiblePlayback.lastError, visiblePlayback.state]);

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
    if (visiblePlayback.state === "live") {
      setSourceStartState("live");
      setMediaConnectionState(
        input.isCurrentSource && visiblePlayback.sourceHealth === "source-silent"
          ? "reconnecting"
          : "live"
      );
      setLastSourceStartError(null);
      return;
    }
    if (visiblePlayback.state === "buffering") {
      setSourceStartState("starting");
      setMediaConnectionState("buffering");
      if (visiblePlayback.lastError) {
        setLastSourceStartError(visiblePlayback.lastError);
      }
      return;
    }
    if (visiblePlayback.state === "awaiting-unlock") {
      setSourceStartState("awaiting-unlock");
      setMediaConnectionState("connecting");
      return;
    }
    if (visiblePlayback.state === "ended") {
      setSourceStartState("live");
      setMediaConnectionState("live");
      return;
    }
    if (visiblePlayback.state === "unavailable") {
      setSourceStartState("failed");
      setMediaConnectionState("failed");
      setLastSourceStartError(visiblePlayback.lastError ?? "当前播放源媒体轨道不可用。");
      return;
    }
    setSourceStartState("idle");
    setMediaConnectionState("idle");
  }, [
    input.isCurrentSource,
    setLastSourceStartError,
    setMediaConnectionState,
    setSourceStartState,
    visiblePlayback.lastError,
    visiblePlayback.sourceHealth,
    visiblePlayback.state
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

  const audioPath = resolveRoomAudioPath({
    isCurrentSource: input.isCurrentSource,
    nativeLocalAudio: usesNativeLocalAudio,
    localFallback: !!offlineFallbackAsset
  });
  const effectivePlayback = visiblePlayback;
  return useMemo(
    () => ({ ...effectivePlayback, audioPath, playbackBarrier }),
    [
      audioPath,
      effectivePlayback,
      playbackBarrier
    ]
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
  lastProgressAtMs?: number;
  missingMediaSinceMs: number | null;
  nowMs: number;
  graceMs?: number;
}): "buffering" | "live" {
  const hasRecentProgress = typeof input.lastProgressAtMs === "number" &&
    input.nowMs - input.lastProgressAtMs < 1_500;
  if (!input.hasStarted) {
    return "buffering";
  }
  if (input.receiverRtpActive === true && hasRecentProgress) {
    return "live";
  }
  // When progress telemetry is available, a live RTP track without a moving
  // media clock is not audible. Keep a short grace window for jitter, then
  // expose buffering so the UI does not claim that the member is speaking.
  if (typeof input.lastProgressAtMs === "number" && !hasRecentProgress) {
    const staleSince = input.missingMediaSinceMs ?? input.lastProgressAtMs;
    if (input.nowMs - staleSince >= (input.graceMs ?? receiverBufferingGraceMs)) {
      return "buffering";
    }
    return "live";
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

export function resolvePlaybackBarrierState(input: {
  playback: PlaybackSnapshot | null;
  activeMembers: RoomSnapshot["room"]["members"];
  readiness: RoomPlaybackReadinessPayload[];
  cacheEnabled: boolean;
  nowMs: number;
}) {
  const playback = input.playback;
  if (!input.cacheEnabled || !playback?.currentTrackId || playback.status !== "playing") {
    return {
      blocked: false,
      resumeAtMs: null as number | null,
      holdPositionMs: null as number | null
    } satisfies RoomPlaybackBarrierClock;
  }
  const current = input.readiness.filter((item) =>
    item.trackId === playback.currentTrackId && item.mediaEpoch === playback.mediaEpoch
  );
  const latestBySession = new Map<string, RoomPlaybackReadinessPayload>();
  for (const item of current) {
    const previous = latestBySession.get(item.sessionId);
    if (!previous || item.updatedAt > previous.updatedAt) {
      latestBySession.set(item.sessionId, item);
    }
  }
  const activeMembers = input.activeMembers.filter(
    (member) => member.presenceState === "online" && !!member.peerId
  );
  // A room's normal stream must not be held by members who did not opt into
  // fully-cached playback. Only online cache participants share this gate.
  const relevant = activeMembers
    .map((member) => latestBySession.get(member.id) ?? null)
    .filter((item): item is RoomPlaybackReadinessPayload => !!item?.cacheEnabled);
  // There is no synchronization problem with one cache participant. Do not
  // pause a solo room while waiting for the readiness event to round-trip.
  if (relevant.length < 2) {
    return {
      blocked: false,
      resumeAtMs: null as number | null,
      holdPositionMs: null as number | null
    } satisfies RoomPlaybackBarrierClock;
  }
  const holdPositionMs = relevant.reduce<number | null>((hold, item) => {
    if (hold !== null) return hold;
    return typeof item.holdPositionMs === "number" && Number.isFinite(item.holdPositionMs)
      ? item.holdPositionMs
      : null;
  }, null);
  const allReady = relevant.every(
    (item) => item.state !== "waiting" && item.barrier === "open"
  );
  if (allReady) {
    const resumeAtMs = relevant.reduce<number | null>((latestResume, item) => {
      const parsed = item?.resumeAt ? Date.parse(item.resumeAt) : null;
      if (parsed === null || !Number.isFinite(parsed)) return latestResume;
      return latestResume === null ? parsed : Math.max(latestResume, parsed);
    }, null);
    return {
      blocked: resumeAtMs !== null && input.nowMs < resumeAtMs,
      resumeAtMs: Number.isFinite(resumeAtMs) ? resumeAtMs : null,
      holdPositionMs
    };
  }
  return {
    blocked: true,
    resumeAtMs: null,
    holdPositionMs
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
