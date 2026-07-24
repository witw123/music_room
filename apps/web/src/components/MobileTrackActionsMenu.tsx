"use client";

import { useId } from "react";
import { AnchoredDialog, type AnchoredDialogAnchor } from "@/components/ui/anchored-dialog";

export type MobileTrackActionIcon =
  | "download"
  | "queue"
  | "play"
  | "plus"
  | "heart"
  | "move"
  | "trash"
  | "up"
  | "down";

export type MobileTrackAction = {
  id: string;
  label: string;
  icon: MobileTrackActionIcon;
  disabled?: boolean;
  destructive?: boolean;
  onSelect: () => void;
};

export function MobileTrackActionsMenu({
  anchor,
  title,
  subtitle,
  items,
  onClose
}: {
  anchor: AnchoredDialogAnchor;
  title: string;
  subtitle?: string;
  items: readonly MobileTrackAction[];
  onClose: () => void;
}) {
  const titleId = useId();

  return (
    <AnchoredDialog anchor={anchor} ariaLabelledBy={titleId} compact onClose={onClose}>
      <div className="px-2 pb-2 pt-1">
        <h2 className="truncate text-sm font-semibold text-foreground" id={titleId}>{title}</h2>
        {subtitle ? <p className="mt-1 truncate text-xs text-foreground-muted">{subtitle}</p> : null}
      </div>
      <div className="border-t border-surface-border pt-1" role="menu">
        {items.map((item) => (
          <button
            aria-label={item.label}
            className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45 ${item.destructive ? "text-red-400 hover:text-red-300" : "text-foreground"}`}
            disabled={item.disabled}
            key={item.id}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            role="menuitem"
            type="button"
          >
            <MenuIcon name={item.icon} />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </AnchoredDialog>
  );
}

function MenuIcon({ name }: { name: MobileTrackActionIcon }) {
  const common = {
    "aria-hidden": true,
    fill: "none",
    height: 16,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
    viewBox: "0 0 24 24",
    width: 16
  };

  if (name === "download") return <svg {...common}><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" /></svg>;
  if (name === "queue") return <svg {...common}><path d="M4 6h11M4 12h11M4 18h6M18 14v7M14.5 17.5h7" /></svg>;
  if (name === "play") return <svg aria-hidden="true" fill="currentColor" height="16" viewBox="0 0 24 24" width="16"><path d="M8 5v14l11-7z" /></svg>;
  if (name === "plus") return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
  if (name === "heart") return <svg {...common}><path d="M20.8 8.7c0 5.2-8.8 10.3-8.8 10.3S3.2 13.9 3.2 8.7A4.7 4.7 0 0 1 12 6.1a4.7 4.7 0 0 1 8.8 2.6Z" /></svg>;
  if (name === "move") return <svg {...common}><path d="M5 7h10M11 3l4 4-4 4M19 17H9m4-4-4 4 4 4" /></svg>;
  if (name === "trash") return <svg {...common}><path d="M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 10v7m4-7v7" /></svg>;
  if (name === "up") return <svg {...common}><path d="m6 14 6-6 6 6" /></svg>;
  return <svg {...common}><path d="m6 10 6 6 6-6" /></svg>;
}
