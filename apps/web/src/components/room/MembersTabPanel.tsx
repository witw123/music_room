"use client";

import { memo } from "react";
import type { PeerDiagnosticsSnapshot, PeerRecentEvent, RoomMember } from "@music-room/shared";
import { MembersPanel, type MemberTransferSummary } from "./MembersPanel";
import { MeshStatusPanel, type AvailabilityEntry } from "./MeshStatusPanel";

type MembersTabPanelProps = {
  members: RoomMember[];
  memberTransferSummaries: MemberTransferSummary[];
  availabilitySummary: AvailabilityEntry[];
  connectedPeersCount: number;
  mediaConnectedPeersCount: number;
  cachedTrackCount: number;
  peerDiagnostics: PeerDiagnosticsSnapshot[];
  peerRecentEvents: PeerRecentEvent[];
  iceConfigSource: string;
  iceConfigStatus: string;
};

function MembersTabPanelBase({
  members,
  memberTransferSummaries,
  availabilitySummary,
  connectedPeersCount,
  mediaConnectedPeersCount,
  cachedTrackCount,
  peerDiagnostics,
  peerRecentEvents,
  iceConfigSource,
  iceConfigStatus
}: MembersTabPanelProps) {
  return (
    <div className="animate-fade-in flex w-full flex-col gap-8">
      <MembersPanel
        members={members}
        memberTransferSummaries={memberTransferSummaries}
      />

      <div className="h-px w-full shrink-0 bg-white/5" />

      <MeshStatusPanel
        availabilitySummary={availabilitySummary}
        connectedPeersCount={connectedPeersCount}
        mediaConnectedPeersCount={mediaConnectedPeersCount}
        cachedTrackCount={cachedTrackCount}
        peerDiagnostics={peerDiagnostics}
        recentEvents={peerRecentEvents}
        iceConfigSource={iceConfigSource}
        iceConfigStatus={iceConfigStatus}
      />
    </div>
  );
}

export const MembersTabPanel = memo(MembersTabPanelBase);
