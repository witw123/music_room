"use client";

import { useEffect, useRef, type Dispatch } from "react";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import { consumeRoomSnapshotHandoff } from "@/lib/room-snapshot-handoff";
import { resolvePlaybackSourceResetReason } from "@/features/room/hooks/room-playback-topology";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";

type PlaybackTopologySnapshot = {
  currentTrackId: string;
  mediaEpoch: number | null;
  sourcePeerId: string | null;
  sourceSessionId: string | null;
} | null;

type UseRoomPlaybackEffectsInput = {
  dispatchRoomStateEvent: Dispatch<RoomStateEvent>;
  initialRoomId: string | null;
  playbackSurfaceKey: string | null;
  playbackTimelineKey: string | null;
  playbackTopologySnapshot: PlaybackTopologySnapshot;
  recordPeerDiagnostic: PeerDiagnosticRecorder;
};

export function useRoomPlaybackEffects({
  dispatchRoomStateEvent,
  initialRoomId,
  playbackSurfaceKey,
  playbackTimelineKey,
  playbackTopologySnapshot,
  recordPeerDiagnostic
}: UseRoomPlaybackEffectsInput) {
  useEffect(() => {
    if (!initialRoomId) {
      return;
    }

    const handoffSnapshot = consumeRoomSnapshotHandoff(initialRoomId);
    if (!handoffSnapshot) {
      return;
    }

    dispatchRoomStateEvent({
      type: "bootstrap-handoff",
      snapshot: handoffSnapshot
    });
  }, [dispatchRoomStateEvent, initialRoomId]);

  const previousPlaybackRef = useRef(playbackTopologySnapshot);

  useEffect(() => {
    const previousPlayback = previousPlaybackRef.current;
    const nextPlayback = playbackTopologySnapshot;
    const sourceResetReason = resolvePlaybackSourceResetReason({
      previousPlayback,
      nextPlayback
    });
    previousPlaybackRef.current = nextPlayback;

    recordPeerDiagnostic({
      peerId: "system",
      channelKind: "system",
      direction: "local",
      event: "playback-surface-state",
      summary: playbackSurfaceKey
        ? `播放面 ${playbackSurfaceKey}`
        : "当前没有活跃播放面",
      recordEvent: false,
      update: (snapshot) => ({
        ...snapshot,
        progressivePlaybackStatus: {
          ...(
            snapshot.progressivePlaybackStatus ??
            createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
          ),
          playbackSurfaceKey,
          playbackTimelineKey,
          sourceResetReason
        }
      })
    });
  }, [
    playbackSurfaceKey,
    playbackTimelineKey,
    recordPeerDiagnostic,
    playbackTopologySnapshot
  ]);
}
