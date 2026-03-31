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
  cachedTrackCount: number;
};

export function MeshStatusPanel({
  availabilitySummary,
  connectedPeersCount,
  cachedTrackCount
}: MeshStatusPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section className="flex flex-col gap-4 w-full">
      <div 
        className="flex items-start justify-between cursor-pointer group"
        onClick={() => setIsOpen((current) => !current)}
      >
        <div>
          <p className="text-[10px] font-bold tracking-[0.2em] text-foreground-muted uppercase mb-1">Diagnostics</p>
          <h2 className="text-sm font-bold text-foreground group-hover:text-accent transition-colors">连接与缓存诊断</h2>
        </div>
        <Button variant="ghost" size="sm" className="h-6 text-xs px-2 text-foreground-muted">
          {isOpen ? "收起" : "展开"}
        </Button>
      </div>

      <div className="flex items-center gap-3 text-[10px] font-mono font-medium text-foreground-muted">
        <span className="bg-surface border border-surface-border px-1.5 py-0.5 rounded">节点: {connectedPeersCount}</span>
        <span className="bg-surface border border-surface-border px-1.5 py-0.5 rounded">缓存: {cachedTrackCount}</span>
        <span className="bg-surface border border-surface-border px-1.5 py-0.5 rounded">曲目: {availabilitySummary.length}</span>
      </div>

      {isOpen ? (
        <div className="flex flex-col gap-2 mt-2 pt-4 border-t border-surface-border">
          {availabilitySummary.length ? (
            availabilitySummary.slice(0, 6).map(({ track, peerCount, localChunkCount, totalChunks, sources }) => (
               <div key={track.id} className="flex flex-col gap-1 p-3 rounded-lg bg-surface/30 border border-surface-border">
                  <strong className="text-xs font-semibold text-foreground truncate">{track.title}</strong>
                  <div className="flex items-center justify-between text-[10px] text-foreground-muted mt-1">
                    <span>本地 {localChunkCount}/{totalChunks || 0}</span>
                    <span>{peerCount} 节点</span>
                  </div>
                  {sources.length ? (
                    <span className="text-[9px] text-foreground-muted/60 truncate mt-0.5">{sources.slice(0, 2).join(" · ")}</span>
                  ) : null}
               </div>
            ))
          ) : (
            <div className="py-4 text-center">
              <p className="text-[10px] text-foreground-muted/70">导入曲目后，显示分片和可见节点信息。</p>
            </div>
          )}
          
          <div className="mt-2 flex items-center justify-between border-t border-surface-border pt-3">
             <span className="text-[10px] text-foreground-muted">产生无用分片时可清理</span>
             <Button
               variant="outline"
               size="sm"
               className="h-7 text-xs px-3 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive hover:border-destructive/50 transition-colors"
               onClick={async () => {
                 if (confirm("确定要彻底清空本设备所有的音乐缓存文件吗？这将释放空间并解决卡流等异常，操作后页面将重新加载。")) {
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
