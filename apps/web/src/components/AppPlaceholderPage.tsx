"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { AppNavItemId } from "@/components/AppSidebar";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/client-shell";

type AppPlaceholderPageProps = {
  page: Exclude<AppNavItemId, "home">;
  eyebrow: string;
  title: string;
  description: string;
};

export function AppPlaceholderPage({
  page,
  eyebrow,
  title,
  description
}: AppPlaceholderPageProps) {
  const router = useRouter();
  const redirectTo = `/app/${page}`;
  const authEntryHref = buildWorkspaceAuthHref({ redirectTo });
  const { activeSession, hydrated } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });

  useEffect(() => {
    if (hydrated && !activeSession) {
      router.replace(authEntryHref as Route);
    }
  }, [activeSession, authEntryHref, hydrated, router]);

  if (!hydrated || !activeSession) {
    return <div className="min-h-screen bg-black" />;
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-black pb-[calc(12rem+env(safe-area-inset-bottom))] text-foreground selection:bg-accent/30 selection:text-white md:pl-60 lg:pb-28">
      <AppPageBackground />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1200px] flex-col px-4 pb-10 pt-10 sm:px-6 sm:pt-12 md:mx-0 md:max-w-[1400px] md:px-8 md:pt-28">
        <div className="max-w-2xl">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.28em] text-accent">{eyebrow}</p>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">{title}</h1>
          <p className="mt-4 max-w-xl text-sm leading-7 text-foreground-muted sm:text-base">{description}</p>
        </div>

        <section className="glass-panel mt-8 flex min-h-[260px] w-full max-w-2xl flex-col items-center justify-center rounded-[28px] px-6 py-10 text-center sm:mt-12 sm:min-h-[320px] sm:px-10 sm:py-12">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10 text-accent">
            <PlaceholderIcon page={page} />
          </div>
          <h2 className="text-lg font-bold text-foreground">这个页面即将开放</h2>
          <p className="mt-2 text-sm text-foreground-muted">先回到首页创建或加入一个音乐房间吧。</p>
        </section>
      </div>
    </main>
  );
}

function PlaceholderIcon({ page }: { page: Exclude<AppNavItemId, "home"> }) {
  if (page === "playlists") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 5h10" />
        <path d="M4 10h10" />
        <path d="M4 15h6" />
        <path d="M16 15.5V6l4-1v9.5" />
        <circle cx="14" cy="18" r="2" />
        <circle cx="18" cy="16.5" r="2" />
      </svg>
    );
  }

  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

function AppPageBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-black">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4.5rem_4.5rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
      <div className="absolute left-0 top-0 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/20 blur-[120px]" />
      <div className="absolute bottom-0 right-0 h-[600px] w-[600px] translate-x-1/3 translate-y-1/3 rounded-full bg-fuchsia-600/10 blur-[150px]" />
    </div>
  );
}
