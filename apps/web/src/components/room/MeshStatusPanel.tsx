"use client";

import { useState } from "react";
import type { TrackMeta } from "@music-room/shared";
import { Button } from "@/components/ui/button";

export type AvailabilityEntry = {
  track: TrackMeta;
  peerCount: number;
  localChunkCount: number;
  totalChunks: number;
  sources: string[];
};

type MeshStatusPanelProps = {
  availabilitySummary: AvailabilityEntry[];
  connectedPeersCount: number;
  mediaConnectedPeersCount: number;
  cachedTrackCount: number;
};

export function MeshStatusPanel({
  availabilitySummary,
  connectedPeersCount,
  mediaConnectedPeersCount,
  cachedTrackCount
}: MeshStatusPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section className="flex w-full flex-col gap-4">
      <div
        className="group flex cursor-pointer items-start justify-between"
        onClick={() => setIsOpen((current) => !current)}
      >
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
            Diagnostics
          </p>
          <h2 className="text-sm font-bold text-foreground transition-colors group-hover:text-accent">
            连接与缓存诊断
          </h2>
        </div>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-foreground-muted">
          {isOpen ? "收起" : "展开"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono font-medium text-foreground-muted">
        <span className="rounded border border-surface-border bg-surface px-1.5 py-0.5">
          P2P 节点: {connectedPeersCount}
        </span>
        <span className="rounded border border-surface-border bg-surface px-1.5 py-0.5">
          实时音频: {mediaConnectedPeersCount}
        </span>
        <span className="rounded border border-surface-border bg-surface px-1.5 py-0.5">
          本地缓存: {cachedTrackCount}
        </span>
        <span className="rounded border border-surface-border bg-surface px-1.5 py-0.5">
          曲目统计: {availabilitySummary.length}
        </span>
      </div>

      {isOpen ? (
        <div className="mt-2 flex flex-col gap-2 border-t border-surface-border pt-4">
          {availabilitySummary.length ? (
            availabilitySummary.slice(0, 6).map(
              ({ track, peerCount, localChunkCount, totalChunks, sources }) => (
                <div
                  key={track.id}
                  className="flex flex-col gap-1 rounded-lg border border-surface-border bg-surface/30 p-3"
                >
                  <strong className="truncate text-xs font-semibold text-foreground">
                    {track.title}
                  </strong>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-foreground-muted">
                    <span>本地缓存 {localChunkCount}/{totalChunks || 0}</span>
                    <span>可见节点 {peerCount}</span>
                  </div>
                  {sources.length ? (
                    <span className="mt-0.5 truncate text-[9px] text-foreground-muted/60">
                      {sources.slice(0, 2).join(" 路 ")}
                    </span>
                  ) : null}
                </div>
              )
            )
          ) : (
            <div className="py-4 text-center">
              <p className="text-[10px] text-foreground-muted/70">
                导入曲目后，这里才会显示缓存分片和可见节点信息。
              </p>
            </div>
          )}

          <div className="mt-2 flex items-center justify-between border-t border-surface-border pt-3">
            <span className="text-[10px] text-foreground-muted">缓存异常时可在此清理本地数据</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 border-destructive/30 px-3 text-xs text-destructive transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
              onClick={async () => {
                if (
                  confirm("确定要清空当前设备上的本地音乐缓存吗？操作后页面将重新加载。")
                ) {
                  const { clearAllCachedTracks } = await import("@/lib/indexeddb");
                  await clearAllCachedTracks();
                  window.location.reload();
                }
              }}
            >
              清除本地缓存
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
