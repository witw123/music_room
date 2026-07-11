"use client";

import { useCallback, useRef } from "react";
import type { RoomSnapshot } from "@music-room/shared";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import type {
  DataTransportStatsInput,
  PieceTransferSample,
  PieceTransferWindow
} from "./room-runtime-types";

const pieceTransferWindowMs = 12_000;

export function formatDiagnosticsTimestamp(timestampMs: number | null) {
  return typeof timestampMs === "number" && Number.isFinite(timestampMs)
    ? new Date(timestampMs).toISOString()
    : null;
}

function prunePieceTransferSamples(samples: PieceTransferSample[], now: number) {
  return samples.filter((sample) => now - sample.timestampMs <= pieceTransferWindowMs);
}

export function calculatePieceTransferRateKbps(samples: PieceTransferSample[]) {
  if (samples.length === 0) {
    return 0;
  }
  const endMs = Math.max(...samples.map((sample) => sample.timestampMs));
  const explicitStarts = samples
    .map((sample) => sample.startedAtMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const startMs = explicitStarts.length > 0
    ? Math.min(...explicitStarts)
    : samples.length > 1
      ? Math.min(...samples.map((sample) => sample.timestampMs))
      : endMs;
  const elapsedMs = endMs - startMs;
  if (elapsedMs <= 0) {
    return 0;
  }
  const measuredSamples = explicitStarts.length > 0 ? samples : samples.slice(1);
  const bytes = measuredSamples.reduce((total, sample) => total + sample.bytes, 0);
  return Math.round((bytes * 8) / elapsedMs);
}

export function getPieceTransferRates(
  windows: Map<string, PieceTransferWindow>,
  peerId: string,
  now = Date.now()
) {
  const window = windows.get(peerId);
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
  peerId: string;
  recordPeerDiagnostic: PeerDiagnosticRecorder;
}) {
  const { recordPeerDiagnostic } = input;
  const pieceTransferRatesRef = useRef<Map<string, PieceTransferWindow>>(new Map());
  const pieceRequestSamplesRef = useRef<Map<string, unknown>>(new Map());
  const peerBufferedAmountBytesRef = useRef<Map<string, number>>(new Map());

  const recordPieceTransferRef = useRef(
    (value: {
      peerId: string;
      direction: "download" | "upload";
      bytes: number;
      durationMs?: number | null;
    }) => {
      const now = Date.now();
      const current =
        pieceTransferRatesRef.current.get(value.peerId) ?? { downloads: [], uploads: [] };
      const samples = value.direction === "download" ? current.downloads : current.uploads;
      samples.push({
        ...(typeof value.durationMs === "number" && Number.isFinite(value.durationMs)
          ? { startedAtMs: now - Math.max(1, value.durationMs) }
          : {}),
        timestampMs: now,
        bytes: value.bytes
      });
      current.downloads = prunePieceTransferSamples(current.downloads, now);
      current.uploads = prunePieceTransferSamples(current.uploads, now);
      pieceTransferRatesRef.current.set(value.peerId, current);

      const rates = getPieceTransferRates(pieceTransferRatesRef.current, value.peerId, now);
      recordPeerDiagnostic({
        peerId: value.peerId,
        channelKind: "data",
        direction: value.direction === "download" ? "received" : "sent",
        event: "piece-transfer",
        summary: `${value.direction} ${value.bytes} bytes`,
        recordEvent: false,
        update: (snapshot) => ({
          ...snapshot,
          pieceDownloadRateKbps: rates.downloadRateKbps,
          pieceUploadRateKbps: rates.uploadRateKbps,
          lastPieceReceivedAt:
            value.direction === "download" ? new Date(now).toISOString() : snapshot.lastPieceReceivedAt
        })
      });
    }
  );

  const recordPieceRequestSampleRef = useRef(
    (value: { peerId: string; outcome: "completed" | "timeout"; durationMs: number }) => {
      pieceRequestSamplesRef.current.set(value.peerId, value);
    }
  );

  const updatePeerBufferedAmountRef = useRef((peerId: string, bufferedAmountBytes: number) => {
    peerBufferedAmountBytesRef.current.set(peerId, bufferedAmountBytes);
    recordPeerDiagnostic({
      peerId,
      channelKind: "data",
      direction: "local",
      event: "data-buffered-amount",
      summary: `Data channel buffered ${bufferedAmountBytes} bytes`,
      recordEvent: false,
      update: (snapshot) => ({
        ...snapshot,
        bufferedAmountBytes
      })
    });
  });

  const updateDataTransportStatsRef = useRef((value: DataTransportStatsInput) => {
    recordPeerDiagnostic({
      peerId: value.peerId,
      channelKind: "data",
      direction: "local",
      event: "data-transport-stats",
      summary: "Data transport stats updated",
      recordEvent: false,
      update: (snapshot) => ({
        ...snapshot,
        dataConnectionState: value.sample?.connectionState ?? snapshot.dataConnectionState,
        dataIceState: value.sample?.iceConnectionState ?? snapshot.dataIceState,
        dataChannelState: value.sample?.dataChannelState ?? snapshot.dataChannelState,
        dataCandidateType: value.sample?.candidateType ?? snapshot.dataCandidateType,
        dataRemoteCandidateType:
          value.sample?.remoteCandidateType ?? snapshot.dataRemoteCandidateType ?? null,
        dataProtocol: value.sample?.protocol ?? snapshot.dataProtocol ?? null,
        dataRelayProtocol: value.sample?.relayProtocol ?? snapshot.dataRelayProtocol ?? null,
        currentRoundTripTimeMs:
          value.sample?.currentRoundTripTimeMs ?? snapshot.currentRoundTripTimeMs,
        availableOutgoingBitrateKbps:
          value.sample?.availableOutgoingBitrateKbps ??
          snapshot.availableOutgoingBitrateKbps,
        transportReceiveBitrateKbps:
          value.sample?.transportReceiveBitrateKbps ?? snapshot.transportReceiveBitrateKbps ?? null,
        transportSendBitrateKbps:
          value.sample?.transportSendBitrateKbps ?? snapshot.transportSendBitrateKbps ?? null,
        packetsLost: value.sample?.packetsLost ?? snapshot.packetsLost,
        jitterMs: value.sample?.jitterMs ?? snapshot.jitterMs,
        packetLossRate: value.sample?.packetLossRate ?? snapshot.packetLossRate,
        mediaReceiveBitrateKbps:
          value.sample?.mediaReceiveBitrateKbps ?? snapshot.mediaReceiveBitrateKbps,
        mediaSendBitrateKbps:
          value.sample?.mediaSendBitrateKbps ?? snapshot.mediaSendBitrateKbps
      })
    });
  });

  const updateMediaTransportStatsRef = useRef(() => undefined);

  const reportRealtimeFailureRef = useRef(
    (value: {
      peerId: string;
      channelKind: "data" | "system";
      event: string;
      summary: string;
      error?: unknown;
    }) => {
      recordPeerDiagnostic({
        peerId: value.peerId,
        channelKind: value.channelKind,
        direction: "local",
        event: value.event,
        summary: value.summary,
        level: "error",
        update: (snapshot) => ({
          ...snapshot,
          lastError: value.error ? String(value.error) : value.summary
        })
      });
    }
  );

  const updateSystemProgressiveStatus = useCallback(
    (patch: Record<string, unknown>) => {
      recordPeerDiagnostic({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: "runtime-status",
        summary: "Pure cache runtime status updated",
        recordEvent: false,
        update: (snapshot) => ({
          ...snapshot,
          progressivePlaybackStatus: {
            ...(
              snapshot.progressivePlaybackStatus ??
              createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
            ),
            ...patch
          }
        })
      });
    },
    [recordPeerDiagnostic]
  );

  return {
    pieceTransferRatesRef,
    pieceRequestSamplesRef,
    peerBufferedAmountBytesRef,
    updateDataTransportStatsRef,
    updateMediaTransportStatsRef,
    reportRealtimeFailureRef,
    recordPieceTransferRef,
    recordPieceRequestSampleRef,
    updatePeerBufferedAmountRef,
    updateSystemProgressiveStatus
  };
}
