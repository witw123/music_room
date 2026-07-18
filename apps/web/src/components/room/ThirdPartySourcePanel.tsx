"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { AuthSession, NeteaseTrackCandidate, QqMusicTrackCandidate } from "@music-room/shared";

const NeteaseSourcePanel = dynamic(
  () => import("./NeteaseSourcePanel").then((mod) => mod.NeteaseSourcePanel),
  { loading: () => <PanelLoading label="正在加载网易云…" /> }
);

const QqMusicSourcePanel = dynamic(
  () => import("./QqMusicSourcePanel").then((mod) => mod.QqMusicSourcePanel),
  { loading: () => <PanelLoading label="正在加载 QQ 音乐…" /> }
);

type ThirdPartySourcePanelProps = {
  activeSession: AuthSession | null;
  onImportNeteaseTrack: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportQqMusicTrack: (track: QqMusicTrackCandidate) => Promise<void>;
};

/** @deprecated Room routes no longer render this panel. Kept for compatibility with external imports. */
export function ThirdPartySourcePanel({
  activeSession,
  onImportNeteaseTrack,
  onImportQqMusicTrack
}: ThirdPartySourcePanelProps) {
  const [source, setSource] = useState<"netease" | "qqmusic">(
    process.env.NEXT_PUBLIC_NETEASE_ENABLED === "true" ? "netease" : "qqmusic"
  );
  const qqMusicEnabled = process.env.NEXT_PUBLIC_QQMUSIC_ENABLED === "true";

  return (
    <div className="flex w-full flex-col gap-4">
      <div aria-label="第三方音乐平台" className="flex gap-1 rounded-lg bg-background/70 p-1" role="tablist">
        {process.env.NEXT_PUBLIC_NETEASE_ENABLED === "true" ? (
          <button aria-selected={source === "netease"} className={source === "netease" ? activeTabClass : inactiveTabClass} onClick={() => setSource("netease")} role="tab" type="button">网易云</button>
        ) : null}
        {qqMusicEnabled ? (
          <button aria-selected={source === "qqmusic"} className={source === "qqmusic" ? activeTabClass : inactiveTabClass} onClick={() => setSource("qqmusic")} role="tab" type="button">QQ 音乐</button>
        ) : null}
      </div>
      {source === "netease" ? (
        <NeteaseSourcePanel activeSession={activeSession} onImportTrack={onImportNeteaseTrack} />
      ) : (
        <QqMusicSourcePanel activeSession={activeSession} onImportTrack={onImportQqMusicTrack} />
      )}
    </div>
  );
}

function PanelLoading({ label }: { label: string }) {
  return <div className="animate-fade-in rounded-2xl border border-surface-border bg-surface/30 px-6 py-12 text-center text-sm text-foreground-muted">{label}</div>;
}

const activeTabClass = "flex-1 rounded-md bg-white/10 px-2.5 py-2 text-xs font-semibold text-white";
const inactiveTabClass = "flex-1 rounded-md px-2.5 py-2 text-xs font-semibold text-white/50 hover:bg-white/5 hover:text-white/80";
