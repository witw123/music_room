"use client";

import type { ProviderSearchSuggestion } from "@music-room/shared";

export type SearchSuggestionItem = {
  label: string;
  hint?: string | null;
  provider?: ProviderSearchSuggestion["provider"];
};

export function SearchSuggestions({
  items,
  onSelect
}: {
  items: SearchSuggestionItem[];
  onSelect: (value: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="absolute inset-x-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-surface-border bg-surface/95 p-2 shadow-[0_18px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl" role="listbox">
      {items.map((item) => (
        <button
          className="flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-foreground-muted transition hover:bg-surface-hover hover:text-foreground"
          key={`${item.label}:${item.provider ?? "local"}:${item.hint ?? ""}`}
          onClick={() => onSelect(item.label)}
          onMouseDown={(event) => event.preventDefault()}
          role="option"
          type="button"
        >
          <span className="shrink-0 text-foreground-muted/80"><SearchIcon /></span>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          <span className="flex shrink-0 items-center gap-1.5 text-[10px]">
            {item.provider ? <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-accent">{providerLabel(item.provider)}</span> : null}
            {item.hint ? <span className="text-foreground-muted/80">{item.hint}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

function providerLabel(provider: ProviderSearchSuggestion["provider"]) {
  return provider === "netease" ? "网易云音乐" : "QQ 音乐";
}

function SearchIcon() {
  return <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>;
}
