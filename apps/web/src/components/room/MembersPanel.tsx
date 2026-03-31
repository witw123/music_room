"use client";

import type { RoomMember } from "@music-room/shared";
import { getOnlineMemberCount } from "@/lib/music-room-ui";

export type MemberTransferSummary = {
  memberId: string;
  announcedTrackCount: number;
  totalChunkCount: number;
  currentTrackChunkCount: number;
  currentTrackTotalChunks: number;
  currentTrackSources: string[];
};

type MembersPanelProps = {
  members: RoomMember[];
  memberTransferSummaries?: MemberTransferSummary[];
};

export function MembersPanel({
  members,
  memberTransferSummaries = []
}: MembersPanelProps) {
  const summaryByMemberId = new Map(
    memberTransferSummaries.map((summary) => [summary.memberId, summary])
  );

  return (
    <section className="flex w-full flex-col gap-6">
      <div className="flex items-end justify-between border-b border-white/5 pb-4">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
            Members
          </p>
          <h2 className="text-lg font-bold text-foreground">当前房间成员</h2>
        </div>
        <span className="rounded-md border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-xs font-semibold text-green-400">
          {getOnlineMemberCount(members)} 人在线
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {members.length > 0 ? (
          members.map((member) => {
            const summary = summaryByMemberId.get(member.id);

            return (
              <div
                key={member.id}
                className="flex flex-col gap-3 rounded-xl border border-surface-border bg-surface/30 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <strong className="text-sm font-semibold text-foreground">
                      {member.nickname}
                    </strong>
                    <span
                      className={`text-[10px] ${
                        member.role === "host"
                          ? "font-bold text-accent"
                          : "text-foreground-muted"
                      }`}
                    >
                      {member.role === "host" ? "房主" : "成员"}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <div
                      className={`h-1.5 w-1.5 rounded-full ${
                        member.peerId ? "animate-pulse bg-green-500" : "bg-neutral-600"
                      }`}
                    />
                    <em
                      className={`text-xs not-italic ${
                        member.peerId ? "text-green-400" : "text-foreground-muted"
                      }`}
                    >
                      {member.peerId ? "在线" : "离线"}
                    </em>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="rounded-lg border border-surface-border bg-background/40 px-2 py-1.5">
                    <span className="block text-foreground-muted">当前曲目缓存分片</span>
                    <strong className="mt-0.5 block text-foreground">
                      {summary
                        ? `${summary.currentTrackChunkCount}/${summary.currentTrackTotalChunks || 0}`
                        : "0/0"}
                    </strong>
                  </div>
                  <div className="rounded-lg border border-surface-border bg-background/40 px-2 py-1.5">
                    <span className="block text-foreground-muted">本地缓存曲目</span>
                    <strong className="mt-0.5 block text-foreground">
                      {summary
                        ? `${summary.announcedTrackCount} 首 / ${summary.totalChunkCount} 片`
                        : "0 首 / 0 片"}
                    </strong>
                  </div>
                </div>

                <p className="text-[10px] text-foreground-muted">
                  {summary?.currentTrackSources.length
                    ? `当前分片来源：${summary.currentTrackSources.join("、")}`
                    : member.peerId
                      ? "当前还没有可用于同步的缓存分片。"
                      : "成员离线后不会继续参与缓存分发。"}
                </p>
              </div>
            );
          })
        ) : (
          <div className="rounded-xl border-2 border-dashed border-surface-border px-4 py-6 text-center">
            <p className="text-xs text-foreground-muted/70">当前还没有成员进入房间。</p>
          </div>
        )}
      </div>
    </section>
  );
}
