"use client";

import type { TrackMeta } from "@music-room/shared";

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
  return (
    <section className="workspace-block room-block room-block-compact">
      <div className="block-heading">
        <div>
          <p className="block-kicker">Mesh</p>
          <h2>P2P 缓存状态</h2>
        </div>
        <span>{availabilitySummary.length} 首曲目</span>
      </div>
      <div className="mesh-summary">
        <span>Mesh {connectedPeersCount}</span>
        <span>本地缓存 {cachedTrackCount}</span>
      </div>
      <div className="playlist-list">
        {availabilitySummary.length ? (
          availabilitySummary.slice(0, 6).map(({ track, peerCount, localChunkCount, totalChunks, sources }) => (
            <div key={track.id} className="playlist-line">
              <div>
                <strong>{track.title}</strong>
                <p>
                  本地 {localChunkCount}/{totalChunks || 0} 分片 · {peerCount} 个节点
                </p>
                {sources.length ? (
                  <span className="playlist-sources">
                    {sources.slice(0, 2).join(" · ")}
                  </span>
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <p className="placeholder-copy">导入曲目后，这里会显示每首歌的分片缓存和可见节点。</p>
        )}
      </div>
    </section>
  );
}
