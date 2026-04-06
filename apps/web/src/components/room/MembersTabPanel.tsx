"use client";

import { memo } from "react";
import type { PeerDiagnosticsSnapshot, PeerRecentEvent, RoomMember } from "@music-room/shared";
import {
  MembersPanel,
  type LocalMemberPanelState,
  type MemberTransferSummary
} from "./MembersPanel";
import { MeshStatusPanel, type AvailabilityEntry } from "./MeshStatusPanel";

type MembersTabPanelProps = {
  members: RoomMember[];
  memberTransferSummaries: MemberTransferSummary[];
  localMemberState: LocalMemberPanelState | null;
  availabilitySummary: AvailabilityEntry[];
  connectedPeersCount: number;
  mediaConnectedPeersCount: number;
  cachedTrackCount: number;
  peerDiagnostics: PeerDiagnosticsSnapshot[];
  peerRecentEvents: PeerRecentEvent[];
  iceConfigSource: string;
  iceConfigStatus: string;
  onDiagnosticsVisibilityChange?: (open: boolean) => void;
};

function MembersTabPanelBase({
  members,
  memberTransferSummaries,
  localMemberState,
  availabilitySummary,
  connectedPeersCount,
  mediaConnectedPeersCount,
  cachedTrackCount,
  peerDiagnostics,
  peerRecentEvents,
  iceConfigSource,
  iceConfigStatus,
  onDiagnosticsVisibilityChange
}: MembersTabPanelProps) {
  return (
    <div className="animate-fade-in flex w-full flex-col gap-5">
      <MembersPanel
        members={members}
        memberTransferSummaries={memberTransferSummaries}
        peerDiagnostics={peerDiagnostics}
        localMemberState={localMemberState}
      />

      <MeshStatusPanel
        members={members}
        availabilitySummary={availabilitySummary}
        connectedPeersCount={connectedPeersCount}
        mediaConnectedPeersCount={mediaConnectedPeersCount}
        cachedTrackCount={cachedTrackCount}
        localMemberState={localMemberState}
        peerDiagnostics={peerDiagnostics}
        recentEvents={peerRecentEvents}
        iceConfigSource={iceConfigSource}
        iceConfigStatus={iceConfigStatus}
        onVisibilityChange={onDiagnosticsVisibilityChange}
      />
    </div>
  );
}

export const MembersTabPanel = memo(MembersTabPanelBase);
