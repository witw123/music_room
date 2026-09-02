import React from "react";
import type { Track } from "./discover-types";
import type { DiscoverArtistItem } from "./discover-curation";
import { DiscoverSection } from "./DiscoverSection";
import { Artwork } from "./DiscoverPlaylistRail";
import { MicIcon, PlayIcon } from "@/components/icons/DiscoverIcons";

export function DiscoverArtistRail({
  artists,
  onStartRadio,
  pending
}: {
  artists: DiscoverArtistItem[];
  onStartRadio: (track: Track) => Promise<void>;
  pending: string | null;
}) {
  if (!artists.length) return null;
  return (
    <DiscoverSection
      title="常听歌手与单曲漫游"
      subtitle="基于你的听歌画像，一键开启专属风格电台漫游"
      icon={<MicIcon className="w-5 h-5 text-accent" />}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
        {artists.map((item) => {
          return (
            <button
              key={item.artistName}
              type="button"
              disabled={pending !== null}
              onClick={() => void onStartRadio(item.representativeTrack)}
              className="group flex flex-col items-center text-center p-3 rounded-2xl border border-white/[0.06] bg-gradient-to-b from-[#12141c]/80 to-[#0c0e15]/90 hover:border-white/[0.14] hover:bg-[#181a26]/90 transition-all hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent shadow-sm"
              title={`开启 ${item.artistName} 专属漫游`}
            >
              <div className="relative aspect-square w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden bg-surface-elevated border-2 border-white/10 shadow-md group-hover:border-accent transition-all">
                <Artwork
                  alt={item.artistName}
                  className="h-full w-full object-cover block transition duration-300 group-hover:scale-110"
                  src={item.artworkUrl}
                />
                <span className="absolute inset-0 bg-black/0 transition duration-200 group-hover:bg-black/35" />
                <span className="absolute inset-0 flex items-center justify-center text-white opacity-0 transition group-hover:opacity-100 scale-90 group-hover:scale-100">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-white shadow-[0_2px_10px_var(--accent-glow)]">
                    <PlayIcon className="w-3.5 h-3.5 ml-0.5" />
                  </span>
                </span>
              </div>
              <p className="mt-2.5 truncate w-full text-xs font-semibold text-white group-hover:text-accent transition-colors">
                {item.artistName}
              </p>
              <p className="mt-0.5 truncate w-full text-[10px] text-foreground-muted">
                {item.reason}
              </p>
            </button>
          );
        })}
      </div>
    </DiscoverSection>
  );
}
