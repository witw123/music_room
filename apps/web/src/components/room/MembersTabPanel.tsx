"use client";

import { memo } from "react";
import type {
  PeerDiagnosticsSnapshot,
  PeerRecentEvent,
  PlaybackSnapshot,
  RoomMember
} from "@music-room/shared";
import {
  MembersPanel,
  type LocalMemberPanelState
} from "./MembersPanel";
import { MeshStatusPanel } from "./MeshStatusPanel";

type MembersTabPanelProps = {
  members: RoomMember[];
  localMemberState: LocalMemberPanelState | null;
  playbackStatus: PlaybackSnapshot["status"];
  sourcePeerId: string | null;
  peerDiagnostics: PeerDiagnosticsSnapshot[];
  peerRecentEvents: PeerRecentEvent[];
  iceConfigSource: string;
  iceConfigStatus: string;
  onDiagnosticsVisibilityChange?: (open: boolean) => void;
};

function MembersTabPanelBase({
  members,
  localMemberState,
  playbackStatus,
  sourcePeerId,
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
        peerDiagnostics={peerDiagnostics}
        localMemberState={localMemberState}
        playbackStatus={playbackStatus}
        sourcePeerId={sourcePeerId}
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
