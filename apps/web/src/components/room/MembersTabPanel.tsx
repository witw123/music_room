"use client";

import { memo } from "react";
import type { PeerDiagnosticsSnapshot, PeerRecentEvent, RoomMember } from "@music-room/shared";
import {
  MembersPanel,
  type LocalMemberPanelState,
  type MemberTransferSummary
} from "./MembersPanel";
import { MeshStatusPanel } from "./MeshStatusPanel";

type MembersTabPanelProps = {
  members: RoomMember[];
  memberTransferSummaries: MemberTransferSummary[];
  localMemberState: LocalMemberPanelState | null;
  connectedPeersCount: number;
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
  connectedPeersCount,
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
        connectedPeersCount={connectedPeersCount}
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
