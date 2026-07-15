"use client";

import { useCallback, useRef } from "react";
import type { RoomSnapshot } from "@music-room/shared";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import type { DataTransportStatsInput } from "./room-runtime-types";

export function formatDiagnosticsTimestamp(timestampMs: number | null) {
  return typeof timestampMs === "number" && Number.isFinite(timestampMs)
    ? new Date(timestampMs).toISOString()
    : null;
}

export function useRoomRuntimeObservability(input: {
  roomSnapshot: RoomSnapshot | null;
  peerId: string;
  recordPeerDiagnostic: PeerDiagnosticRecorder;
}) {
  const { recordPeerDiagnostic } = input;
  const peerBufferedAmountBytesRef = useRef<Map<string, number>>(new Map());

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
        targetAudioBitrateKbps: snapshot.targetAudioBitrateKbps
      })
    });
  });

  const updateMediaTransportStatsRef = useRef((value: DataTransportStatsInput) => {
    recordPeerDiagnostic({
      peerId: value.peerId,
      channelKind: "media",
      direction: "local",
      event: "media-transport-stats",
      summary: "Media RTP stats updated",
      recordEvent: false,
      update: (snapshot) => ({
        ...snapshot,
        ...(value.sample && value.sample.mediaReceiveBitrateKbps !== null &&
        value.sample.mediaReceiveBitrateKbps > 0
          ? {
              lastAudibleProgressAt: new Date().toISOString(),
              lastMediaStatsProgressAt: new Date().toISOString()
            }
          : value.sample && value.sample.mediaSendBitrateKbps !== null &&
              value.sample.mediaSendBitrateKbps > 0
            ? { lastMediaStatsProgressAt: new Date().toISOString() }
            : {}),
        mediaConnectionState: value.sample?.connectionState ?? snapshot.mediaConnectionState,
        mediaIceState: value.sample?.iceConnectionState ?? snapshot.mediaIceState,
        mediaCandidateType: value.sample?.candidateType ?? snapshot.mediaCandidateType,
        mediaProtocol: value.sample?.protocol ?? snapshot.mediaProtocol,
        currentRoundTripTimeMs: value.sample?.currentRoundTripTimeMs ?? snapshot.currentRoundTripTimeMs,
        mediaReceiveBitrateKbps: value.sample?.mediaReceiveBitrateKbps ?? snapshot.mediaReceiveBitrateKbps,
        mediaSendBitrateKbps: value.sample?.mediaSendBitrateKbps ?? snapshot.mediaSendBitrateKbps,
        targetAudioBitrateKbps: value.sample?.targetAudioBitrateKbps ?? snapshot.targetAudioBitrateKbps,
        configuredAudioMaxBitrateKbps:
          value.sample?.configuredAudioMaxBitrateKbps ?? snapshot.configuredAudioMaxBitrateKbps,
        senderAudioMaxBitrateKbps:
          value.sample?.senderAudioMaxBitrateKbps ?? snapshot.senderAudioMaxBitrateKbps,
        opusFmtpLine: value.sample?.opusFmtpLine ?? snapshot.opusFmtpLine,
        senderTrackId: value.sample?.senderTrackId ?? snapshot.senderTrackId,
        receiverTrackId: value.sample?.receiverTrackId ?? snapshot.receiverTrackId,
        senderCodecId: value.sample?.senderCodecId ?? snapshot.senderCodecId,
        receiverCodecId: value.sample?.receiverCodecId ?? snapshot.receiverCodecId,
        opusCodec: value.sample?.opusCodec ?? snapshot.opusCodec,
        mediaTrackEstablishedAt:
          formatDiagnosticsTimestamp(value.sample?.mediaTrackEstablishedAtMs ?? null) ??
          snapshot.mediaTrackEstablishedAt,
        lastMediaPacketAt:
          formatDiagnosticsTimestamp(value.sample?.lastMediaPacketAtMs ?? null) ??
          snapshot.lastMediaPacketAt,
        packetsLost: value.sample?.packetsLost ?? snapshot.packetsLost,
        packetLossRate: value.sample?.packetLossRate ?? snapshot.packetLossRate,
        jitterMs: value.sample?.jitterMs ?? snapshot.jitterMs
      })
    });
  });

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

  const updateSystemSegmentedStatus = useCallback(
    (patch: Record<string, unknown>) => {
      recordPeerDiagnostic({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: "runtime-status",
        summary: "Segmented Opus runtime status updated",
        recordEvent: false,
        update: (snapshot) => ({
          ...snapshot,
          segmentedPlaybackStatus: {
            ...(
              snapshot.segmentedPlaybackStatus ??
              createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).segmentedPlaybackStatus!
            ),
            ...patch
          }
        })
      });
    },
    [recordPeerDiagnostic]
  );

  return {
    peerBufferedAmountBytesRef,
    updateDataTransportStatsRef,
    updateMediaTransportStatsRef,
    reportRealtimeFailureRef,
    updatePeerBufferedAmountRef,
    updateSystemSegmentedStatus
  };
}
