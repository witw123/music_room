"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type {
  AuthSession,
  MetingTrackCandidate,
  NeteaseTrackCandidate
} from "@music-room/shared";

const NeteaseSourcePanel = dynamic(
  () => import("./NeteaseSourcePanel").then((mod) => mod.NeteaseSourcePanel),
  { loading: () => <PanelLoading label="正在加载网易云…" /> }
);

const MetingSourcePanel = dynamic(
  () => import("./MetingSourcePanel").then((mod) => mod.MetingSourcePanel),
  { loading: () => <PanelLoading label="正在加载国内音乐平台…" /> }
);

type ThirdPartySourcePanelProps = {
  activeSession: AuthSession | null;
  onImportNeteaseTrack: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportMetingTrack: (track: MetingTrackCandidate) => Promise<void>;
};

export function ThirdPartySourcePanel({
  activeSession,
  onImportNeteaseTrack,
  onImportMetingTrack
}: ThirdPartySourcePanelProps) {
  const [source, setSource] = useState<"netease" | "meting">(
    process.env.NEXT_PUBLIC_NETEASE_ENABLED === "true" ? "netease" : "meting"
  );
  const metingEnabled = [
    process.env.NEXT_PUBLIC_QQMUSIC_ENABLED,
    process.env.NEXT_PUBLIC_KUGOU_ENABLED,
    process.env.NEXT_PUBLIC_KUWO_ENABLED,
    process.env.NEXT_PUBLIC_BAIDU_ENABLED,
    process.env.NEXT_PUBLIC_TAIHE_ENABLED,
    process.env.NEXT_PUBLIC_MIGU_ENABLED
  ].some((value) => value === "true");

  return (
    <div className="flex w-full flex-col gap-4">
      <div aria-label="第三方音乐平台" className="flex gap-1 rounded-lg bg-background/70 p-1" role="tablist">
        {process.env.NEXT_PUBLIC_NETEASE_ENABLED === "true" ? (
          <button
            aria-selected={source === "netease"}
            className={source === "netease" ? activeTabClass : inactiveTabClass}
            onClick={() => setSource("netease")}
            role="tab"
            type="button"
          >
            网易云
          </button>
        ) : null}
        {metingEnabled ? (
          <button
            aria-selected={source === "meting"}
            className={source === "meting" ? activeTabClass : inactiveTabClass}
            onClick={() => setSource("meting")}
            role="tab"
            type="button"
          >
            QQ / 酷狗 / 酷我 / 千千 / 咪咕
          </button>
        ) : null}
      </div>

      {source === "netease" ? (
        <NeteaseSourcePanel activeSession={activeSession} onImportTrack={onImportNeteaseTrack} />
      ) : (
        <MetingSourcePanel activeSession={activeSession} onImportTrack={onImportMetingTrack} />
      )}
    </div>
  );
}

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="animate-fade-in rounded-2xl border border-surface-border bg-surface/30 px-6 py-12 text-center text-sm text-foreground-muted">
      {label}
    </div>
  );
}

const activeTabClass = "flex-1 rounded-md bg-white/10 px-2.5 py-2 text-xs font-semibold text-white";
const inactiveTabClass = "flex-1 rounded-md px-2.5 py-2 text-xs font-semibold text-white/50 hover:bg-white/5 hover:text-white/80";
