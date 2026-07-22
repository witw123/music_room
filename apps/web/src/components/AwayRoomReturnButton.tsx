"use client";

type AwayRoomReturnButtonProps = {
  onClick: () => void;
};

export function AwayRoomReturnButton({ onClick }: AwayRoomReturnButtonProps) {
  return (
    <button
      aria-label="返回房间"
      className="light-overlay-control fixed left-3 top-20 z-[60] flex h-9 w-9 items-center justify-center rounded-xl border border-surface-border bg-surface/80 text-foreground-muted shadow-lg backdrop-blur-xl transition-[background-color,color,box-shadow,transform] duration-200 hover:bg-surface-hover hover:text-accent hover:shadow-accent/10 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:left-[calc(var(--app-sidebar-width)+1rem)] md:top-4"
      data-testid="resume-away-room"
      onClick={onClick}
      title="返回房间"
      type="button"
    >
      <svg
        aria-hidden="true"
        fill="none"
        height="17"
        viewBox="0 0 24 24"
        width="17"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      >
        <path d="M15 5 8 12l7 7" />
        <path d="M8 12h12" />
      </svg>
    </button>
  );
}
