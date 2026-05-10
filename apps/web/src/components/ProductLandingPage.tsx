import Link from "next/link";
import type { Route } from "next";
import { HomeRoomSection } from "@/components/HomeRoomSection";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { buildAppEntryHref, githubReleasesUrl } from "@/lib/client-shell";

const githubRepositoryUrl = "https://github.com/witw123/music_room";

const projectStats = [
  { label: "Realtime stack", value: "WebRTC + WebSocket" },
  { label: "Audio model", value: "Local-first" },
  { label: "Client shells", value: "Web / Desktop / Android" },
  { label: "Distribution", value: "Open source" }
];

const capabilities = [
  {
    eyebrow: "Room workflow",
    title: "房间、队列和成员状态在同一个工作台里完成",
    body: "创建公开或私密房间后，成员用房间码加入，共享同一条播放队列、当前歌曲和在线状态。",
    points: ["公开 / 私密房间", "房间码直达", "队列协作"]
  },
  {
    eyebrow: "Realtime playback",
    title: "低延迟同步播放，而不是单机播放器加聊天",
    body: "播放、暂停、seek、切歌和媒体时钟通过实时链路同步，弱网下保留远端流和本地缓存兜底。",
    points: ["WebSocket 状态同步", "WebRTC 实时音频", "断线恢复策略"]
  },
  {
    eyebrow: "Local music",
    title: "音频本体留在成员设备，本地曲库仍能多人协作",
    body: "导入本地音频后只同步元数据和分片可用性，播放时优先由拥有歌曲的成员提供音频链路。",
    points: ["本地文件导入", "P2P 分片缓存", "不上传音频本体"]
  }
];

const architectureItems = [
  {
    title: "Next.js Web",
    body: "负责网页房间、播放器界面、上传入口和 P2P 调度状态展示。"
  },
  {
    title: "NestJS Server",
    body: "管理认证、房间快照、播放版本、队列和 Socket.IO 信令。"
  },
  {
    title: "Redis Realtime",
    body: "承载 presence、跨实例广播、可用性事件和恢复场景。"
  },
  {
    title: "Tauri / Capacitor",
    body: "桌面和 Android 壳复用同一套 Web 工作台，补齐本地体验。"
  }
];

function ProductRoomPreview() {
  const queue = [
    { title: "Night Drive", owner: "Host local FLAC", active: true },
    { title: "City Lights", owner: "Alice upload", active: false },
    { title: "After Hours", owner: "Cached by Ben", active: false }
  ];
  const members = [
    { name: "HOST", color: "bg-accent/20 text-accent" },
    { name: "AL", color: "bg-emerald-400/15 text-emerald-300" },
    { name: "BE", color: "bg-amber-400/15 text-amber-300" }
  ];

  return (
    <div className="relative w-full max-w-5xl animate-slide-up select-none">
      <div className="absolute -inset-6 rounded-[2rem] bg-[radial-gradient(circle_at_35%_20%,rgba(0,112,243,0.22),transparent_34%),radial-gradient(circle_at_80%_45%,rgba(16,185,129,0.12),transparent_28%)] blur-2xl" />
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#05070a] shadow-2xl">
        <div className="flex h-11 items-center border-b border-white/[0.05] px-4">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-white/[0.12]" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/[0.12]" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/[0.12]" />
          </div>
          <div className="mx-auto hidden rounded-md border border-white/[0.05] bg-white/[0.03] px-8 py-1 font-mono text-[10px] text-white/[0.35] sm:block">
            music-room / room_27A4
          </div>
        </div>

        <div className="grid min-h-[420px] gap-5 p-4 md:grid-cols-[240px_1fr_230px] md:p-5">
          <aside className="hidden rounded-xl border border-white/[0.05] bg-white/[0.025] p-4 md:block">
            <div className="mb-4 flex items-center justify-between">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-white/[0.45]">
                Shared queue
              </p>
              <span className="rounded bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-300">
                live
              </span>
            </div>
            <div className="space-y-2">
              {queue.map((track, index) => (
                <div
                  key={track.title}
                  className={`rounded-lg border p-3 ${
                    track.active
                      ? "border-accent/35 bg-accent/[0.12]"
                      : "border-transparent bg-white/[0.025]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                        track.active ? "bg-accent text-white" : "bg-white/[0.06] text-white/[0.45]"
                      }`}
                    >
                      {track.active ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      ) : (
                        <span className="font-mono text-xs">{index + 1}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{track.title}</p>
                      <p className="truncate text-[11px] text-white/40">{track.owner}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          <section className="relative flex min-h-[330px] flex-col justify-between overflow-hidden rounded-xl border border-white/[0.05] bg-[radial-gradient(circle_at_center,rgba(0,112,243,0.12),transparent_60%)] p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/[0.35]">
                  Now playing
                </p>
                <h2 className="mt-2 text-2xl font-bold text-white md:text-3xl">Night Drive</h2>
              </div>
              <div className="flex -space-x-2">
                {members.map((member) => (
                  <span
                    key={member.name}
                    className={`flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#05070a] text-[10px] font-bold ${member.color}`}
                  >
                    {member.name}
                  </span>
                ))}
              </div>
            </div>

            <div className="mx-auto flex h-44 w-44 items-center justify-center rounded-2xl border border-white/[0.06] bg-[linear-gradient(145deg,rgba(0,112,243,0.38),rgba(8,13,29,0.88))] shadow-[0_24px_80px_rgba(0,112,243,0.22)] sm:h-56 sm:w-56">
              <div className="flex h-28 w-28 items-center justify-center rounded-full border border-white/[0.12] bg-black/20">
                <div className="h-8 w-8 rounded-full bg-white/25" />
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between font-mono text-[11px] text-white/40">
                <span>01:46</span>
                <span>04:12</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-[43%] rounded-full bg-accent" />
              </div>
              <div className="mt-5 flex items-center justify-center gap-6 text-white/[0.45]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 20L9 12l10-8v16zM5 19V5" />
                </svg>
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-black">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                </span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 4l10 8-10 8V4zM19 5v14" />
                </svg>
              </div>
            </div>
          </section>

          <aside className="grid gap-3 sm:grid-cols-3 md:grid-cols-1">
            {[
              { label: "Source owner", value: "Host", tone: "text-accent" },
              { label: "Transport", value: "WebRTC ready", tone: "text-emerald-300" },
              { label: "Cache", value: "18 / 24 chunks", tone: "text-amber-300" }
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-white/[0.05] bg-white/[0.025] p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/[0.35]">
                  {item.label}
                </p>
                <p className={`mt-3 text-lg font-semibold ${item.tone}`}>{item.value}</p>
              </div>
            ))}
            <div className="hidden rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-4 md:block">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/[0.35]">
                Local file
              </p>
              <p className="mt-3 truncate text-sm font-semibold text-white">night_drive.flac</p>
              <p className="mt-1 text-xs text-white/40">音频本体保留在设备内</p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

export function ProductLandingPage() {
  const appHref = buildAppEntryHref(null);

  return (
    <main className="relative min-h-screen overflow-hidden bg-black font-sans selection:bg-accent/30 selection:text-white">
      <TopBar activeSession={null} variant="marketing" />

      <div className="fixed inset-0 -z-10 bg-black">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4.5rem_4.5rem] [mask-image:radial-gradient(ellipse_70%_55%_at_50%_0%,#000_60%,transparent_100%)]" />
      </div>

      <section id="project" className="mx-auto flex w-full max-w-[1240px] flex-col items-center px-5 pb-20 pt-16 text-center sm:px-6 md:pb-28 md:pt-24">
        <p className="mb-5 rounded-full border border-accent/25 bg-accent/10 px-4 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.24em] text-accent">
          Open source local music room
        </p>
        <h1 className="max-w-5xl text-5xl font-extrabold leading-[0.95] tracking-tight text-white sm:text-6xl md:text-8xl">
          Music Room
        </h1>
        <p className="mt-7 max-w-3xl text-base leading-8 text-white/[0.58] md:text-xl">
          一个用于多人同步播放本地音乐的开源项目。房间、队列、实时播放、P2P 分片缓存和桌面 / Android 壳都在同一套工作流里。
        </p>
        <div className="mt-9 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
          <Link href={githubRepositoryUrl} target="_blank" rel="noreferrer">
            <Button size="lg" className="h-12 w-full rounded-lg px-7 text-base sm:w-auto">
              查看 GitHub
            </Button>
          </Link>
          <Link href="#download">
            <Button
              size="lg"
              variant="outline"
              className="h-12 w-full rounded-lg border-white/[0.08] bg-white/[0.04] px-7 text-base text-white hover:bg-white/[0.08] sm:w-auto"
            >
              下载客户端
            </Button>
          </Link>
          <Link href={appHref as Route}>
            <Button
              size="lg"
              variant="ghost"
              className="h-12 w-full rounded-lg border border-white/[0.06] px-7 text-base text-white/[0.72] hover:bg-white/[0.06] hover:text-white sm:w-auto"
            >
              在线体验
            </Button>
          </Link>
        </div>

        <div className="mt-12 w-full md:mt-16">
          <ProductRoomPreview />
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-[1120px] grid-cols-2 gap-px border-y border-white/[0.05] bg-white/[0.06] px-5 sm:px-6 md:grid-cols-4">
        {projectStats.map((stat) => (
          <div key={stat.label} className="bg-black px-3 py-7 text-center md:py-9">
            <p className="text-lg font-bold text-white md:text-2xl">{stat.value}</p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/[0.38]">
              {stat.label}
            </p>
          </div>
        ))}
      </section>

      <section id="features" className="mx-auto w-full max-w-[1120px] px-5 py-24 sm:px-6 md:py-32">
        <div className="mb-14 max-w-2xl">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.24em] text-accent">
            What it does
          </p>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-white md:text-5xl">
            把本地音乐变成一个可协作的实时房间
          </h2>
        </div>

        <div className="grid gap-8">
          {capabilities.map((section, index) => (
            <article
              key={section.title}
              className="grid gap-6 border-t border-white/[0.05] pt-8 md:grid-cols-[0.62fr_1fr]"
            >
              <div>
                <p className="font-mono text-sm font-bold text-accent">0{index + 1}</p>
                <p className="mt-3 text-xs font-bold uppercase tracking-[0.2em] text-white/[0.38]">
                  {section.eyebrow}
                </p>
              </div>
              <div>
                <h3 className="text-2xl font-bold leading-tight text-white md:text-3xl">
                  {section.title}
                </h3>
                <p className="mt-4 max-w-3xl text-base leading-7 text-white/[0.56]">
                  {section.body}
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
                  {section.points.map((point) => (
                    <span
                      key={point}
                      className="rounded-full border border-white/[0.07] bg-white/[0.035] px-3 py-1.5 text-sm text-white/[0.72]"
                    >
                      {point}
                    </span>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="architecture" className="mx-auto w-full max-w-[1120px] px-5 pb-24 sm:px-6 md:pb-32">
        <div className="grid gap-10 md:grid-cols-[0.85fr_1.15fr] md:items-start">
          <div className="md:sticky md:top-24">
            <p className="font-mono text-xs font-bold uppercase tracking-[0.24em] text-accent">
              Architecture
            </p>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-white md:text-5xl">
              Web、Server、P2P 和客户端壳拆开治理
            </h2>
            <p className="mt-5 text-base leading-7 text-white/[0.55]">
              项目不是把音频上传到服务端，而是用服务端同步房间状态与信令，让拥有音频的成员提供实时流和分片缓存。
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {architectureItems.map((item) => (
              <div key={item.title} className="rounded-xl border border-white/[0.05] bg-white/[0.025] p-5">
                <h3 className="text-lg font-semibold text-white">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-white/50">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <HomeRoomSection />

      <section id="download" className="mx-auto w-full max-w-[1120px] px-5 pb-24 sm:px-6 md:pb-32">
        <div className="overflow-hidden rounded-2xl border border-white/[0.05] bg-[#05070a]">
          <div className="grid gap-px bg-white/[0.06] md:grid-cols-[1fr_1fr_0.9fr]">
            {[
              { label: "Desktop", title: "Windows / macOS", body: "用于更稳定的本地文件、缓存和桌面播放体验。" },
              { label: "Mobile", title: "Android", body: "通过 Capacitor 复用房间工作台，补充移动端协作入口。" },
              { label: "Source", title: "GitHub", body: "查看代码、发布包和项目进展。" }
            ].map((item) => (
              <a
                key={item.label}
                href={githubReleasesUrl}
                target="_blank"
                rel="noreferrer"
                className="group bg-[#05070a] p-6 transition-colors hover:bg-white/[0.045]"
              >
                <p className="font-mono text-[11px] font-bold uppercase tracking-[0.24em] text-accent">
                  {item.label}
                </p>
                <h3 className="mt-4 text-2xl font-bold text-white">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-white/[0.52]">{item.body}</p>
                <p className="mt-6 text-sm font-semibold text-white/[0.72] group-hover:text-accent">
                  打开发布页
                </p>
              </a>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
