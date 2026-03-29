"use client";

import type { RoomMember } from "@music-room/shared";

type MembersPanelProps = {
  members: RoomMember[];
};

export function MembersPanel({ members }: MembersPanelProps) {
  return (
    <section className="workspace-block room-block room-block-compact">
      <div className="block-heading">
        <div>
          <p className="block-kicker">成员</p>
          <h2>房间里的听众</h2>
        </div>
        <span>{members.length} 人</span>
      </div>
      <div className="member-list">
        {members.length ? (
          members.map((member) => (
            <div key={member.id} className="member-line">
              <div>
                <strong>{member.nickname}</strong>
                <span>{member.role === "host" ? "房主" : "听众"}</span>
              </div>
              <em>{member.peerId ? "在线" : "已连接"}</em>
            </div>
          ))
        ) : (
          <p className="placeholder-copy">暂无成员</p>
        )}
      </div>
    </section>
  );
}
