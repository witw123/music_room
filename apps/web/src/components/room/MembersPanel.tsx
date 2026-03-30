"use client";

import type { RoomMember } from "@music-room/shared";
import { getOnlineMemberCount } from "@/lib/music-room-ui";

type MembersPanelProps = {
  members: RoomMember[];
};

export function MembersPanel({ members }: MembersPanelProps) {
  return (
    <section className="flex flex-col gap-6 w-full">
      <div className="flex items-end justify-between border-b border-white/5 pb-4">
        <div>
          <p className="text-[10px] font-bold tracking-[0.2em] text-foreground-muted uppercase mb-1">Members</p>
          <h2 className="text-lg font-bold text-foreground">当前房间成员</h2>
        </div>
        <span className="text-xs font-semibold text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-md">
          {getOnlineMemberCount(members)} 人在线
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {members.length > 0 ? (
          members.map((member) => (
            <div key={member.id} className="flex items-center justify-between p-3 rounded-xl bg-surface/30 border border-surface-border">
              <div className="flex flex-col gap-0.5">
                <strong className="text-sm font-semibold text-foreground">{member.nickname}</strong>
                <span className={`text-[10px] ${member.role === "host" ? "text-accent font-bold" : "text-foreground-muted"}`}>
                  {member.role === "host" ? "房主" : "成员"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${member.peerId ? "bg-green-500 animate-pulse" : "bg-neutral-600"}`} />
                <em className={`text-xs not-italic ${member.peerId ? "text-green-400" : "text-foreground-muted"}`}>
                  {member.peerId ? "在线" : "离线"}
                </em>
              </div>
            </div>
          ))
        ) : (
          <div className="py-6 px-4 text-center border-2 border-dashed border-surface-border rounded-xl">
             <p className="text-xs text-foreground-muted/70">当前还没有成员进入房间。</p>
          </div>
        )}
      </div>
    </section>
  );
}
