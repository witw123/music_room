"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction
} from "react";
import type {
  PeerDiagnosticsSnapshot,
  RoomMediaConnectionState,
  RoomSnapshot
} from "@music-room/shared";
import { toUserFacingError } from "@/lib/music-room-ui";
import type { PeerConnectionSupervisorState } from "@/features/p2p";
import {
  withResolvedTransportHealth,
  withSupervisorDiagnosticPatch
} from "./use-room-connection-supervisor";

type PieceTransferSample = {
  timestampMs: number;
  bytes: number;
};

type PieceTransferWindow = {
  downloads: PieceTransferSample[];
  uploads: PieceTransferSample[];
};

type PieceRequestSample = {
  timestampMs: number;
  durationMs: number;
  outcome: "completed" | "timeout";
};

const pieceTransferWindowMs = 12_000;
const listenerMediaSupervisorIntervalMs = 150;

export function formatDiagnosticsTimestamp(timestampMs: number | null) {
  return typeof timestampMs === "number" && Number.isFinite(timestampMs)
    ? new Date(timestampMs).toISOString()
    : null;
}

function prunePieceRequestSamples(samples: PieceRequestSample[], now: number) {
  return samples.filter((sample) => now - sample.timestampMs <= pieceTransferWindowMs);
}

function summarizePieceRequestSamples(samples: PieceRequestSample[], now = Date.now()) {
  const resolved = prunePieceRequestSamples(samples, now);
  const durations = resolved
    .filter((sample) => sample.outcome === "completed")
    .map((sample) => sample.durationMs)
    .sort((left, right) => left - right);
  const timeouts = resolved.filter((sample) => sample.outcome === "timeout").length;
  const total = resolved.length;

  return {
    samples: resolved,
    pieceRttMsP50: percentileFromSorted(durations, 0.5),
    pieceRttMsP95: percentileFromSorted(durations, 0.95),
    pieceTimeoutRate: total > 0 ? Math.round((timeouts / total) * 1000) / 10 : null
  };
}

function percentileFromSorted(values: number[], percentile: number) {
  if (values.length === 0) {
    return null;
  }

  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.floor((values.length - 1) * percentile))
  );
  return values[index] ?? null;
}

function prunePieceTransferSamples(samples: PieceTransferSample[], now: number) {
  return samples.filter((sample) => now - sample.timestampMs <= pieceTransferWindowMs);
}

function calculatePieceTransferRateKbps(samples: PieceTransferSample[]) {
  if (samples.length === 0) {
    return 0;
  }

  const totalBytes = samples.reduce((sum, sample) => sum + sample.bytes, 0);
  const durationMs = pieceTransferWindowMs;
  return Math.round(((totalBytes * 8) / durationMs) * 10) / 10;
}

export function getPieceTransferRates(
  transferWindows: Map<string, PieceTransferWindow>,
  peerId: string,
  now = Date.now()
) {
  const window = transferWindows.get(peerId);
  if (!window) {
    return {
      downloadRateKbps: null,
      uploadRateKbps: null
    };
  }

  window.downloads = prunePieceTransferSamples(window.downloads, now);
  window.uploads = prunePieceTransferSamples(window.uploads, now);

  return {
    downloadRateKbps: calculatePieceTransferRateKbps(window.downloads),
    uploadRateKbps: calculatePieceTransferRateKbps(window.uploads)
  };
}

export function useRoomRuntimeObservability(input: {
  roomSnapshot: RoomSnapshot | null;
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  peerId: string;
  remoteAudioRef: RefObject<HTMLAudioElement | null>;
  mediaMeshRef: MutableRefObject<{ setStatsSamplingMode: (mode: "off" | "active" | "steady") => void } | null>;
  meshRef: MutableRefObject<{ setStatsSamplingMode: (mode: "off" | "active" | "steady") => void } | null>;
  recordPeerDiagnostic: (input: any) => void;
  setMediaConnectionState: Dispatch<SetStateAction<RoomMediaConnectionState>>;
  updateConnectionSupervisorTransport: (input: {
    peerId: string;
    channelKind: "data" | "media";
    sample: any;
  }) => PeerConnectionSupervisorState | null;
  updateConnectionSupervisorPlayout: (peerId: string) => PeerConnectionSupervisorState | null;
  resolveCurrentAudibleSource: (now?: number) => PeerDiagnosticsSnapshot["audibleSource"];
  resolveSourceContinuityState: (now?: number) => {
    consecutiveNoProgressMs: number | null;
  };
  listenerMediaLifecycleRef: MutableRefObject<{
    lastPlayoutProgressAt: number | null;
    lastTransportProgressAt: number | null;
    lastObservedRemoteCurrentTimeMs: number | null;
  }>;
  lastDataActivityAtRef: MutableRefObject<number | null>;
  activePlaybackSource: string;
  isCurrentSourceOwner: boolean;
  mediaConnectionState: RoomMediaConnectionState;
  isPageVisible: boolean;
  bufferHealth: "healthy" | "low" | "critical";
}) {
  const pieceTransferRatesRef = useRef<Map<string, PieceTransferWindow>>(new Map());
  const pieceRequestSamplesRef = useRef<Map<string, PieceRequestSample[]>>(new Map());
  const remoteStreamTrackingRef = useRef<{
    trackKey: string | null;
    accumulatedMs: number;
    segmentStartedAt: number | null;
  }>({
    trackKey: null,
    accumulatedMs: 0,
    segmentStartedAt: null
  });

  const updateDataTransportStats = useCallback(
    (transportInput: {
      peerId: string;
      sample: {
        candidateType: string | null;
        protocol: string | null;
        currentRoundTripTimeMs: number | null;
        availableOutgoingBitrateKbps: number | null;
        mediaReceiveBitrateKbps: number | null;
        mediaSendBitrateKbps: number | null;
        packetLossRate?: number | null;
        packetsLost?: number | null;
        jitterMs: number | null;
      };
    }) => {
      const supervisorState = input.updateConnectionSupervisorTransport({
        peerId: transportInput.peerId,
        channelKind: "data",
        sample: transportInput.sample
      });
      const pieceTransferRates = getPieceTransferRates(
        pieceTransferRatesRef.current,
        transportInput.peerId
      );
      const hasRecentDataActivity =
        (typeof pieceTransferRates.downloadRateKbps === "number" &&
          pieceTransferRates.downloadRateKbps > 0) ||
        (typeof pieceTransferRates.uploadRateKbps === "number" &&
          pieceTransferRates.uploadRateKbps > 0);
      if (hasRecentDataActivity) {
        input.lastDataActivityAtRef.current = Date.now();
      }
      input.recordPeerDiagnostic({
        peerId: transportInput.peerId,
        channelKind: "data",
        direction: "local",
        event: "transport-stats",
        summary: "Data transport stats updated",
        recordEvent: false,
        update: (snapshot: any) => ({
          ...withResolvedTransportHealth({
            ...withSupervisorDiagnosticPatch(snapshot, supervisorState),
            dataCandidateType: transportInput.sample.candidateType ?? snapshot.dataCandidateType,
            currentRoundTripTimeMs:
              transportInput.sample.currentRoundTripTimeMs ?? snapshot.currentRoundTripTimeMs,
            availableOutgoingBitrateKbps:
              transportInput.sample.availableOutgoingBitrateKbps ??
              snapshot.availableOutgoingBitrateKbps,
            pieceDownloadRateKbps: pieceTransferRates.downloadRateKbps,
            pieceUploadRateKbps: pieceTransferRates.uploadRateKbps,
            lastDataActivityAt: formatDiagnosticsTimestamp(input.lastDataActivityAtRef.current)
          })
        })
      });
    },
    [input]
  );

  const updateMediaTransportStats = useCallback(
    (transportInput: {
      peerId: string;
      sample: {
        candidateType: string | null;
        protocol: string | null;
        currentRoundTripTimeMs: number | null;
        availableOutgoingBitrateKbps: number | null;
        targetAudioBitrateKbps?: number | null;
        packetLossRate?: number | null;
        receiverJitterTargetMs?: number | null;
        mediaReceiveBitrateKbps: number | null;
        mediaSendBitrateKbps: number | null;
        packetsLost: number | null;
        jitterMs: number | null;
      };
    }) => {
      const now = Date.now();
      const currentPlayback = input.currentRoomRef.current?.room.playback;
      const hasInboundMediaProgress =
        typeof transportInput.sample.mediaReceiveBitrateKbps === "number" &&
        transportInput.sample.mediaReceiveBitrateKbps > 0;
      const hasOutboundMediaProgress =
        typeof transportInput.sample.mediaSendBitrateKbps === "number" &&
        transportInput.sample.mediaSendBitrateKbps > 0;
      if (
        (currentPlayback?.sourcePeerId === transportInput.peerId && hasInboundMediaProgress) ||
        (input.isCurrentSourceOwner && hasOutboundMediaProgress)
      ) {
        input.listenerMediaLifecycleRef.current.lastTransportProgressAt = now;
      }

      const supervisorState = input.updateConnectionSupervisorTransport({
        peerId: transportInput.peerId,
        channelKind: "media",
        sample: transportInput.sample
      });

      input.recordPeerDiagnostic({
        peerId: transportInput.peerId,
        channelKind: "media",
        direction: "local",
        event: "transport-stats",
        summary: "Media transport stats updated",
        recordEvent: false,
        update: (snapshot: any) => ({
          ...withResolvedTransportHealth({
            ...withSupervisorDiagnosticPatch(snapshot, supervisorState),
            mediaCandidateType: transportInput.sample.candidateType ?? snapshot.mediaCandidateType,
            mediaProtocol: transportInput.sample.protocol ?? snapshot.mediaProtocol,
            currentRoundTripTimeMs:
              transportInput.sample.currentRoundTripTimeMs ?? snapshot.currentRoundTripTimeMs,
            availableOutgoingBitrateKbps:
              transportInput.sample.availableOutgoingBitrateKbps ??
              snapshot.availableOutgoingBitrateKbps,
            targetAudioBitrateKbps:
              transportInput.sample.targetAudioBitrateKbps ?? snapshot.targetAudioBitrateKbps,
            packetLossRate: transportInput.sample.packetLossRate ?? snapshot.packetLossRate,
            receiverJitterTargetMs:
              transportInput.sample.receiverJitterTargetMs ?? snapshot.receiverJitterTargetMs,
            mediaReceiveBitrateKbps:
              transportInput.sample.mediaReceiveBitrateKbps ?? snapshot.mediaReceiveBitrateKbps,
            mediaSendBitrateKbps:
              transportInput.sample.mediaSendBitrateKbps ?? snapshot.mediaSendBitrateKbps,
            packetsLost: transportInput.sample.packetsLost ?? snapshot.packetsLost,
            jitterMs: transportInput.sample.jitterMs ?? snapshot.jitterMs,
            lastAudibleProgressAt: formatDiagnosticsTimestamp(
              input.listenerMediaLifecycleRef.current.lastPlayoutProgressAt
            ),
            lastMediaStatsProgressAt: formatDiagnosticsTimestamp(
              input.listenerMediaLifecycleRef.current.lastTransportProgressAt
            ),
            lastDataActivityAt: formatDiagnosticsTimestamp(input.lastDataActivityAtRef.current),
            audibleSource: input.resolveCurrentAudibleSource(now),
            bufferingWhileAudible:
              input.resolveCurrentAudibleSource(now) === "remote-stream" &&
              input.mediaConnectionState === "buffering",
            consecutiveNoProgressMs: input.resolveSourceContinuityState(now).consecutiveNoProgressMs
          })
        })
      });
    },
    [input]
  );

  const recordPieceTransfer = useCallback(
    (pieceInput: {
      peerId: string;
      direction: "download" | "upload";
      bytes: number;
    }) => {
      if (!pieceInput.peerId || pieceInput.bytes <= 0) {
        return;
      }

      input.lastDataActivityAtRef.current = Date.now();

      const window =
        pieceTransferRatesRef.current.get(pieceInput.peerId) ??
        (() => {
          const initial: PieceTransferWindow = {
            downloads: [],
            uploads: []
          };
          pieceTransferRatesRef.current.set(pieceInput.peerId, initial);
          return initial;
        })();
      const bucket = pieceInput.direction === "download" ? window.downloads : window.uploads;
      bucket.push({
        timestampMs: Date.now(),
        bytes: pieceInput.bytes
      });

      const pieceTransferRates = getPieceTransferRates(pieceTransferRatesRef.current, pieceInput.peerId);
      input.recordPeerDiagnostic({
        peerId: pieceInput.peerId,
        channelKind: "data",
        direction: "local",
        event: "piece-transfer-stats",
        summary: "Piece transfer stats updated",
        recordEvent: false,
        update: (snapshot: any) => ({
          ...withResolvedTransportHealth({
            ...snapshot,
            pieceDownloadRateKbps: pieceTransferRates.downloadRateKbps,
            pieceUploadRateKbps: pieceTransferRates.uploadRateKbps,
            lastPieceReceivedAt:
              pieceInput.direction === "download"
                ? new Date().toISOString()
                : snapshot.lastPieceReceivedAt
          })
        })
      });
    },
    [input]
  );

  const recordPieceRequestSample = useCallback(
    (requestInput: {
      peerId: string;
      outcome: "completed" | "timeout";
      durationMs: number;
    }) => {
      if (!requestInput.peerId || requestInput.durationMs < 0) {
        return;
      }

      const samples = pieceRequestSamplesRef.current.get(requestInput.peerId) ?? [];
      samples.push({
        timestampMs: Date.now(),
        durationMs: requestInput.durationMs,
        outcome: requestInput.outcome
      });
      const summary = summarizePieceRequestSamples(samples);
      pieceRequestSamplesRef.current.set(requestInput.peerId, summary.samples);

      input.recordPeerDiagnostic({
        peerId: requestInput.peerId,
        channelKind: "data",
        direction: "local",
        event: "piece-request-stats",
        summary: "Piece request stats updated",
        recordEvent: false,
        update: (snapshot: any) => ({
          ...withResolvedTransportHealth({
            ...snapshot,
            pieceRttMsP50: summary.pieceRttMsP50,
            pieceRttMsP95: summary.pieceRttMsP95,
            pieceTimeoutRate: summary.pieceTimeoutRate
          })
        })
      });
    },
    [input]
  );

  const updatePeerBufferedAmount = useCallback(
    (peerId: string, bufferedAmountBytes: number) => {
      if (!peerId) {
        return;
      }

      input.recordPeerDiagnostic({
        peerId,
        channelKind: "data",
        direction: "local",
        event: "data-buffered-amount",
        summary: "Data buffered amount updated",
        recordEvent: false,
        update: (snapshot: any) => ({
          ...snapshot,
          dataBufferedAmountBytes: bufferedAmountBytes
        })
      });
    },
    [input]
  );

  const updateRemoteStreamTime = useCallback(
    (timeOnRemoteStreamMs: number | null) => {
      input.recordPeerDiagnostic({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: "remote-stream-time",
        summary: "Remote stream time updated",
        recordEvent: false,
        update: (snapshot: any) => ({
          ...snapshot,
          timeOnRemoteStreamMs
        })
      });
    },
    [input]
  );

  const reportRealtimeFailure = useCallback(
    (failureInput: {
      peerId: string;
      channelKind: "data" | "media" | "system";
      event: string;
      summary: string;
      error: unknown;
      mediaConnectionState?: RoomMediaConnectionState;
    }) => {
      const message = toUserFacingError(failureInput.error);
      const nextSummary = `${failureInput.summary}: ${message}`;

      input.recordPeerDiagnostic({
        peerId: failureInput.peerId,
        channelKind: failureInput.channelKind,
        direction: "local",
        event: failureInput.event,
        level: "error",
        summary: nextSummary,
        update: (snapshot: any) => ({
          ...snapshot,
          lastError: nextSummary
        })
      });

      if (failureInput.mediaConnectionState) {
        input.setMediaConnectionState(failureInput.mediaConnectionState);
      }
    },
    [input]
  );

  const updateDataTransportStatsRef = useRef(updateDataTransportStats);
  const updateMediaTransportStatsRef = useRef(updateMediaTransportStats);
  const reportRealtimeFailureRef = useRef(reportRealtimeFailure);
  const recordPieceTransferRef = useRef(recordPieceTransfer);
  const recordPieceRequestSampleRef = useRef(recordPieceRequestSample);
  const updatePeerBufferedAmountRef = useRef(updatePeerBufferedAmount);

  useEffect(() => {
    updateDataTransportStatsRef.current = updateDataTransportStats;
  }, [updateDataTransportStats]);

  useEffect(() => {
    updateMediaTransportStatsRef.current = updateMediaTransportStats;
  }, [updateMediaTransportStats]);

  useEffect(() => {
    reportRealtimeFailureRef.current = reportRealtimeFailure;
  }, [reportRealtimeFailure]);

  useEffect(() => {
    recordPieceTransferRef.current = recordPieceTransfer;
  }, [recordPieceTransfer]);

  useEffect(() => {
    recordPieceRequestSampleRef.current = recordPieceRequestSample;
  }, [recordPieceRequestSample]);

  useEffect(() => {
    updatePeerBufferedAmountRef.current = updatePeerBufferedAmount;
  }, [updatePeerBufferedAmount]);

  useEffect(() => {
    const playback = input.roomSnapshot?.room.playback;
    const hasActiveTrack = !!playback?.currentTrackId;
    const isPlaying = playback?.status === "playing";
    const mediaStatsMode =
      !hasActiveTrack || (!input.isPageVisible && !isPlaying)
        ? "off"
        : input.isCurrentSourceOwner ||
            input.activePlaybackSource !== "remote-stream" ||
            input.bufferHealth !== "healthy"
          ? "active"
          : "steady";
    const dataStatsMode =
      !hasActiveTrack || (!input.isPageVisible && !isPlaying)
        ? "off"
        : input.bufferHealth !== "healthy"
          ? "active"
          : "steady";

    input.mediaMeshRef.current?.setStatsSamplingMode(mediaStatsMode);
    input.meshRef.current?.setStatsSamplingMode(dataStatsMode);
  }, [
    input.activePlaybackSource,
    input.bufferHealth,
    input.isCurrentSourceOwner,
    input.isPageVisible,
    input.mediaMeshRef,
    input.meshRef,
    input.roomSnapshot?.room.playback.currentTrackId,
    input.roomSnapshot?.room.playback.status
  ]);

  useEffect(() => {
    const playback = input.roomSnapshot?.room.playback;
    if (
      input.isCurrentSourceOwner ||
      input.activePlaybackSource !== "remote-stream" ||
      !input.peerId ||
      !input.roomSnapshot?.room.id ||
      playback?.status !== "playing"
    ) {
      input.listenerMediaLifecycleRef.current.lastObservedRemoteCurrentTimeMs = null;
      return;
    }

    const timerId = window.setInterval(() => {
      const remoteAudio = input.remoteAudioRef.current;
      if (!remoteAudio?.srcObject || remoteAudio.paused) {
        return;
      }

      const currentTimeMs =
        Number.isFinite(remoteAudio.currentTime) && remoteAudio.currentTime >= 0
          ? Math.round(remoteAudio.currentTime * 1000)
          : null;
      if (currentTimeMs === null) {
        return;
      }

      const previousTimeMs = input.listenerMediaLifecycleRef.current.lastObservedRemoteCurrentTimeMs;
      input.listenerMediaLifecycleRef.current.lastObservedRemoteCurrentTimeMs = currentTimeMs;
      if (previousTimeMs === null || currentTimeMs > previousTimeMs + 20) {
        input.listenerMediaLifecycleRef.current.lastPlayoutProgressAt = Date.now();
        if (playback?.sourcePeerId) {
          input.updateConnectionSupervisorPlayout(playback.sourcePeerId);
        }
      }
    }, listenerMediaSupervisorIntervalMs);

    return () => {
      window.clearInterval(timerId);
    };
  }, [
    input.activePlaybackSource,
    input.isCurrentSourceOwner,
    input.listenerMediaLifecycleRef,
    input.peerId,
    input.remoteAudioRef,
    input.roomSnapshot?.room.id,
    input.roomSnapshot?.room.playback.status,
    input.updateConnectionSupervisorPlayout
  ]);

  useEffect(() => {
    const currentTrackId = input.roomSnapshot?.room.playback.currentTrackId ?? null;
    const mediaEpoch = input.roomSnapshot?.room.playback.mediaEpoch ?? 0;
    const trackingKey = currentTrackId ? `${currentTrackId}:${mediaEpoch}` : null;
    const tracking = remoteStreamTrackingRef.current;

    if (tracking.trackKey !== trackingKey) {
      tracking.trackKey = trackingKey;
      tracking.accumulatedMs = 0;
      tracking.segmentStartedAt = null;
    }

    if (!currentTrackId) {
      updateRemoteStreamTime(null);
      return;
    }

    const shouldTrackRemoteStream =
      input.roomSnapshot?.room.playback.status === "playing" &&
      input.activePlaybackSource === "remote-stream";

    if (!shouldTrackRemoteStream) {
      if (tracking.segmentStartedAt !== null) {
        tracking.accumulatedMs += Date.now() - tracking.segmentStartedAt;
        tracking.segmentStartedAt = null;
      }
      updateRemoteStreamTime(Math.max(0, Math.round(tracking.accumulatedMs)));
      return;
    }

    if (tracking.segmentStartedAt === null) {
      tracking.segmentStartedAt = Date.now();
    }

    const syncRemoteStreamTime = () => {
      const activeSegmentMs =
        tracking.segmentStartedAt === null ? 0 : Date.now() - tracking.segmentStartedAt;
      updateRemoteStreamTime(Math.max(0, Math.round(tracking.accumulatedMs + activeSegmentMs)));
    };

    syncRemoteStreamTime();
    const timerId = window.setInterval(syncRemoteStreamTime, 1_000);

    return () => {
      window.clearInterval(timerId);
      if (tracking.segmentStartedAt !== null) {
        tracking.accumulatedMs += Date.now() - tracking.segmentStartedAt;
        tracking.segmentStartedAt = null;
      }
      updateRemoteStreamTime(Math.max(0, Math.round(tracking.accumulatedMs)));
    };
  }, [
    input.activePlaybackSource,
    input.roomSnapshot?.room.playback.currentTrackId,
    input.roomSnapshot?.room.playback.mediaEpoch,
    input.roomSnapshot?.room.playback.status,
    updateRemoteStreamTime
  ]);

  return {
    pieceTransferRatesRef,
    pieceRequestSamplesRef,
    updateDataTransportStatsRef,
    updateMediaTransportStatsRef,
    reportRealtimeFailureRef,
    recordPieceTransferRef,
    recordPieceRequestSampleRef,
    updatePeerBufferedAmountRef
  };
}
