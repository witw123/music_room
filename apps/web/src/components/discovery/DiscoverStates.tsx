import React from "react";
import type { Track } from "./discover-types";
import type { AnchoredDialogAnchor } from "@/components/ui/anchored-dialog";
import {
  ProviderPlaylistPickerDialog,
  type ProviderPlaylistPickerOption
} from "@/components/provider-search";
import { CompassIcon as DiscoverCompassIcon } from "@/components/icons/DiscoverIcons";

export function PlaylistPicker({
  track,
  anchor,
  options,
  loading,
  pending,
  onClose,
  onSelect
}: {
  track: Track | null;
  anchor: AnchoredDialogAnchor | null;
  options: ProviderPlaylistPickerOption[];
  loading: boolean;
  pending: string | null;
  onClose: () => void;
  onSelect: (option: ProviderPlaylistPickerOption) => Promise<void>;
}) {
  if (!track || !anchor) return null;
  return (
    <ProviderPlaylistPickerDialog
      anchor={anchor}
      loading={loading}
      options={options}
      pending={pending !== null}
      subjectLabel={`《${track.title}》 · ${track.artist}`}
      onClose={onClose}
      onSelect={(option) => void onSelect(option)}
    />
  );
}

export function Feedback({
  statusMessage,
  errorMessage
}: {
  statusMessage: string | null;
  errorMessage: string | null;
}) {
  return (
    <>
      {statusMessage ? (
        <p className="mt-5 rounded-2xl bg-white/[0.06] border border-white/[0.08] px-4 py-3 text-xs text-white" role="status">
          {statusMessage}
        </p>
      ) : null}
      {errorMessage ? (
        <p className="mt-5 rounded-2xl bg-red-950/30 border border-red-500/20 px-4 py-3 text-xs text-red-300" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </>
  );
}

export function DiscoverEmptyState({
  title,
  description,
  actionHref,
  actionLabel,
  onAction
}: {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel: string;
  onAction?: () => void;
}) {
  return (
    <section className="mt-10 flex min-h-64 flex-col items-center justify-center rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[#12141c]/90 to-[#0c0e15]/95 px-6 py-12 text-center shadow-xl">
      <div className="p-3.5 rounded-2xl bg-accent/15 border border-accent/25 text-accent mb-4">
        <DiscoverCompassIcon className="w-8 h-8" />
      </div>
      <h2 className="text-base font-bold text-white">{title}</h2>
      <p className="mt-1.5 max-w-sm text-xs text-foreground-muted leading-relaxed">{description}</p>
      {actionHref ? (
        <a className="mt-5 rounded-xl bg-accent hover:bg-accent-hover px-6 py-2.5 text-xs font-semibold text-white transition-all shadow-[0_4px_16px_var(--accent-glow)]" href={actionHref}>
          {actionLabel}
        </a>
      ) : (
        <button className="mt-5 rounded-xl bg-accent hover:bg-accent-hover px-6 py-2.5 text-xs font-semibold text-white transition-all shadow-[0_4px_16px_var(--accent-glow)] active:scale-95" onClick={onAction} type="button">
          {actionLabel}
        </button>
      )}
    </section>
  );
}

export function DiscoverSkeleton() {
  return (
    <div aria-label="正在加载个性化发现内容" className="mt-7 grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="animate-pulse p-2.5 rounded-2xl bg-white/[0.03] border border-white/[0.04]" key={index}>
          <div className="aspect-square rounded-xl bg-white/[0.06]" />
          <div className="mt-3 h-3 w-4/5 rounded bg-white/[0.06]" />
          <div className="mt-2 h-2 w-1/2 rounded bg-white/[0.06]" />
        </div>
      ))}
    </div>
  );
}

export function AppPageBackground() {
  return <div aria-hidden="true" className="workspace-page-background" />;
}
