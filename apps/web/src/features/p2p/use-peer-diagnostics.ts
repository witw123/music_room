"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PeerDiagnosticsSnapshot, PeerRecentEvent } from "@music-room/shared";
import { createEmptyDiagnosticsState, recordDiagnosticsEvent } from "./diagnostics";

export type PeerDiagnosticInput = Parameters<typeof recordDiagnosticsEvent>[1];
export type PeerDiagnosticRecorder = (input: PeerDiagnosticInput) => void;

export function usePeerDiagnostics(flushDelayMs = 120) {
  const queuedDiagnosticsRef = useRef<PeerDiagnosticInput[]>([]);
  const diagnosticsFlushTimerRef = useRef<number | null>(null);
  const [diagnosticsState, setDiagnosticsState] = useState(createEmptyDiagnosticsState);

  const peerDiagnostics = useMemo<PeerDiagnosticsSnapshot[]>(
    () =>
      Object.values(diagnosticsState.peers).sort((left, right) =>
        left.peerId.localeCompare(right.peerId)
      ),
    [diagnosticsState.peers]
  );
  const peerRecentEvents = diagnosticsState.recentEvents as PeerRecentEvent[];

  const flushQueuedDiagnostics = useCallback(() => {
    if (diagnosticsFlushTimerRef.current !== null) {
      window.clearTimeout(diagnosticsFlushTimerRef.current);
      diagnosticsFlushTimerRef.current = null;
    }

    if (queuedDiagnosticsRef.current.length === 0) {
      return;
    }

    const queued = queuedDiagnosticsRef.current.splice(0, queuedDiagnosticsRef.current.length);
    setDiagnosticsState((current) =>
      queued.reduce((state, input) => recordDiagnosticsEvent(state, input), current)
    );
  }, []);

  const recordPeerDiagnostic = useCallback(
    (input: PeerDiagnosticInput) => {
      queuedDiagnosticsRef.current.push(input);
      if (diagnosticsFlushTimerRef.current !== null) {
        return;
      }

      diagnosticsFlushTimerRef.current = window.setTimeout(() => {
        flushQueuedDiagnostics();
      }, flushDelayMs);
    },
    [flushDelayMs, flushQueuedDiagnostics]
  );

  useEffect(() => {
    return () => {
      if (diagnosticsFlushTimerRef.current !== null) {
        window.clearTimeout(diagnosticsFlushTimerRef.current);
      }
    };
  }, []);

  return {
    diagnosticsState,
    peerDiagnostics,
    peerRecentEvents,
    recordPeerDiagnostic
  };
}
