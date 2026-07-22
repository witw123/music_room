"use client";

import { memo } from "react";
import type {
  PeerDiagnosticsSnapshot,
  PeerRecentEvent,
  RoomMember,
  RoomMemberPermissions
} from "@music-room/shared";
import { MembersPanel } from "./MembersPanel";
import { MeshStatusPanel } from "./MeshStatusPanel";

type MembersTabPanelProps = {
  members: RoomMember[];
  activeSessionId: string | null;
  isHost: boolean;
  onUpdateMemberPermissions: (memberId: string, permissions: RoomMemberPermissions) => Promise<boolean>;
  onRemoveMember: (memberId: string) => Promise<boolean>;
  peerDiagnostics: PeerDiagnosticsSnapshot[];
  peerRecentEvents: PeerRecentEvent[];
  iceConfigSource: string;
  iceConfigStatus: string;
  onDiagnosticsVisibilityChange?: (open: boolean) => void;
};

function MembersTabPanelBase({
  members,
  activeSessionId,
  isHost,
  onUpdateMemberPermissions,
  onRemoveMember,
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
        activeSessionId={activeSessionId}
        isHost={isHost}
        onUpdateMemberPermissions={onUpdateMemberPermissions}
        onRemoveMember={onRemoveMember}
      />

      <MeshStatusPanel
        members={members}
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
