/**
 * Room audio path resolution for the segmented playback runtime.
 *
 * These helpers decide which audio source a member should play (local file,
 * local segmented source, broadcast stream, or remote listener stream) and how
 * the room clock maps to the local audio timeline, including provider-cache
 * transitions and the shared AudioContext requirements of the source.
 */

import type {
  PlaybackSnapshot,
  RoomPlaybackReadinessInputPayload,
  TrackLoudness,
  TrackMeta
} from "@music-room/shared";
import {
  getRoomPlaybackClockNowMs,
  resolveRoomPlaybackPositionMs,
  type RoomPlaybackBarrierClock
} from "@/features/playback/room-playback-clock";
import type { PlaybackAudioPath } from "@/features/playback/use-segmented-opus-playback";
import { resolveProviderTrackSource } from "@/features/library/provider-track-identity";

export const localAudioSeekToleranceSeconds = 0.35;
const localAudioMetadataTimeoutMs = 8_000;

export type LocalAudioResolutionStatus = "idle" | "checking" | "available" | "missing";

export type LocalAudioResolution = {
  key: string | null;
  status: LocalAudioResolutionStatus;
  file: Blob | null;
  loudness?: TrackLoudness;
  error: string | null;
};

export type LocalAudioObjectUrl = {
  key: string;
  url: string;
};

export function resolveRoomAudioPositionMs(
  playback: Pick<PlaybackSnapshot, "status" | "positionMs" | "startedAt" | "startAt">,
  nowMs = getRoomPlaybackClockNowMs(),
  barrier?: Pick<RoomPlaybackBarrierClock, "holdPositionMs" | "resumeAtMs"> | null
) {
  return resolveRoomPlaybackPositionMs(playback, 0, nowMs, barrier);
}

export function resolveLocalAudioTrackKey(
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

export function isProviderTrack(track: TrackMeta | null | undefined) {
  return !!resolveProviderTrackSource(track);
}

export function resolveLocalAudioTimelineKey(
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

export function isAudioPlaybackBlockedError(error: string | null) {
  return !!error && /notallowed|autoplay|user gesture|blocked/i.test(error);
}

export function isRecoverableLocalAudioError(error: string | null) {
  return !!error && /abort|interrupted|cancelled|canceled|pause\(\)|playing request/i.test(error);
}

export function waitForLocalAudioMetadata(audio: HTMLAudioElement) {
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
