/**
 * Room-wide playback barrier for the segmented playback runtime.
 *
 * The barrier keeps every online cache participant on the same media clock
 * while a provider track is downloaded locally, excluding participants that
 * waited past the timeout so one stuck download cannot freeze the room at
 * holdPositionMs indefinitely.
 */

import type {
  PlaybackSnapshot,
  RoomPlaybackReadinessPayload,
  RoomSnapshot
} from "@music-room/shared";
import type { RoomPlaybackBarrierClock } from "@/features/playback/room-playback-clock";
import type { SegmentedPlaybackSnapshot } from "@/features/playback/use-segmented-opus-playback";
import { roomAudioOutput } from "@/features/playback/room-audio-output";

// A cache participant that stays in "waiting" for this long is excluded from
// the room-wide playback hold, so a stalled provider download cannot freeze
// the entire room at holdPositionMs.
export const cacheBarrierWaitingTimeoutMs = 30_000;

export function idlePlaybackSnapshot(): SegmentedPlaybackSnapshot {
  return {
    state: "idle",
    bufferedMs: 0,
    ownedUnitCount: 0,
    totalUnitCount: 0,
    audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null,
    lastError: null
  };
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
  nowMs: number;
  // Cache participants that have been waiting past the barrier timeout are
  // excluded from the room-wide hold so one stuck download cannot freeze the
  // whole room at holdPositionMs indefinitely.
  staleWaitingSessionIds?: ReadonlySet<string>;
}) {
  const playback = input.playback;
  if (!playback?.currentTrackId || playback.status !== "playing") {
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
  // Only online cache participants decide whether the room barrier is open.
  // Once it is waiting, however, the hold is room-wide: a streaming member
  // must follow the same clock or its progress bar will run through silence.
  // A participant that exceeded the waiting timeout is treated as absent so
  // its stalled cache preparation cannot hold the room forever.
  const relevant = activeMembers
    .map((member) => latestBySession.get(member.id) ?? null)
    .filter((item): item is RoomPlaybackReadinessPayload =>
      item?.cacheEnabled === true &&
      !(input.staleWaitingSessionIds?.has(item.sessionId) ?? false));
  const latestReadinessUpdatedAtMs = relevant.reduce<number | null>((latest, item) => {
    const updatedAtMs = Date.parse(item.updatedAt);
    if (!Number.isFinite(updatedAtMs)) return latest;
    return latest === null ? updatedAtMs : Math.max(latest, updatedAtMs);
  }, null);
  const playbackStartedAtMs = Date.parse(playback.startedAt ?? playback.startAt ?? "");
  const readinessPredatesTimeline = Number.isFinite(playbackStartedAtMs) &&
    (latestReadinessUpdatedAtMs === null || latestReadinessUpdatedAtMs < playbackStartedAtMs);
  const reportedHoldPositionMs = relevant.reduce<number | null>((hold, item) => {
    if (hold !== null) return hold;
    return typeof item.holdPositionMs === "number" && Number.isFinite(item.holdPositionMs)
      ? item.holdPositionMs
      : null;
  }, null);
  const holdPositionMs = readinessPredatesTimeline
    ? playback.positionMs
    : reportedHoldPositionMs;
  const allReady = relevant.every(
    (item) => item.state !== "waiting" && item.barrier === "open"
  );
  if (allReady) {
    if (readinessPredatesTimeline) {
      return {
        blocked: false,
        resumeAtMs: null,
        holdPositionMs: null
      } satisfies RoomPlaybackBarrierClock;
    }
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
    holdPositionMs: holdPositionMs ?? 0
  };
}

export function toDiagnosticPlaybackState(state: SegmentedPlaybackSnapshot["state"]) {
  if (state === "unavailable") {
    return "failed" as const;
  }
  if (state === "ended") {
    return "paused" as const;
  }
  return state;
}

export function toDiagnosticSourceStartState(state: SegmentedPlaybackSnapshot["state"]) {
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
