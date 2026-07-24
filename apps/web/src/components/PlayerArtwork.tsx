import type { CSSProperties } from "react";

type SquareAlbumCoverProps = {
  artworkUrl: string | null;
  className?: string;
  style?: CSSProperties;
};

export function SquareAlbumCover({ artworkUrl, className = "", style }: SquareAlbumCoverProps) {
  return (
    <div
      aria-hidden="true"
      className={`relative overflow-hidden bg-accent shadow-2xl ${className}`}
      data-testid="square-album-cover"
      style={style}
    >
      {artworkUrl ? (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url("${artworkUrl}")` }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-white">
          <svg aria-hidden="true" fill="none" height="22" viewBox="0 0 24 24" width="22" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6">
            <path d="M9 18V5l10-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="16" cy="16" r="3" />
          </svg>
        </div>
      )}
    </div>
  );
}
