"use client";

import { useState } from "react";
import type {
  AuthSession,
  NeteaseTrackCandidate,
  SpotifyTrackCandidate
} from "@music-room/shared";
import { NeteaseSourcePanel } from "./NeteaseSourcePanel";
import { SpotifySourcePanel } from "./SpotifySourcePanel";

type ProviderTab = "netease" | "spotify";

type ThirdPartySourcePanelProps = {
  activeSession: AuthSession | null;
  onImportNeteaseTrack: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportSpotifyTrack: (track: SpotifyTrackCandidate) => Promise<void>;
};

const hasNetease = process.env.NEXT_PUBLIC_NETEASE_ENABLED === "true";
const hasSpotify = process.env.NEXT_PUBLIC_SPOTIFY_ENABLED === "true";

export function ThirdPartySourcePanel({
  activeSession,
  onImportNeteaseTrack,
  onImportSpotifyTrack
}: ThirdPartySourcePanelProps) {
  const [provider, setProvider] = useState<ProviderTab>(hasNetease ? "netease" : "spotify");

  return (
    <div className="flex flex-col gap-3">
      {hasNetease && hasSpotify ? (
        <div className="flex w-fit rounded-lg border border-surface-border bg-surface/30 p-1" role="tablist">
          <button
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              provider === "netease"
                ? "bg-foreground text-background"
                : "text-foreground-muted hover:text-foreground"
            }`}
            onClick={() => setProvider("netease")}
            role="tab"
            type="button"
          >
            网易云
          </button>
          <button
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              provider === "spotify"
                ? "bg-foreground text-background"
                : "text-foreground-muted hover:text-foreground"
            }`}
            onClick={() => setProvider("spotify")}
            role="tab"
            type="button"
          >
            Spotify
          </button>
        </div>
      ) : null}

      {provider === "netease" && hasNetease ? (
        <NeteaseSourcePanel
          activeSession={activeSession}
          onImportTrack={onImportNeteaseTrack}
        />
      ) : null}
      {provider === "spotify" && hasSpotify ? (
        <SpotifySourcePanel
          activeSession={activeSession}
          onImportTrack={onImportSpotifyTrack}
        />
      ) : null}
    </div>
  );
}
