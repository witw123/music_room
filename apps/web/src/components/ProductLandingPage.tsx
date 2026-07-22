import Link from "next/link";
import type { Route } from "next";

import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { buildAppEntryHref } from "@/lib/client-shell";

const githubRepositoryUrl = "https://example.test/music-room";

const projectStats = [
  { label: "Latency", value: "< 50ms Sync" },
  { label: "Audio Path", value: "Segmented Opus" },
  { label: "Platform", value: "Browser First" },
  { label: "Privacy", value: "Local-First" }
];

const capabilities = [
  {
    eyebrow: "Seamless Collaboration",
    title: "一站式协作控制台，掌控派对全局",
    body: "在同一个现代化工作台中管理房间、队列和成员状态。无论是公开派对还是私密分享，房间码一键直达，所有人共享同一条实时播放队列。",
    points: ["沉浸式界面", "一键邀请加入", "多人队列协作"]
  },
  {
    eyebrow: "Ultra-Low Latency",
    title: "极低延迟的毫秒级状态同步",
    body: "基于先进的 WebRTC 实时通信技术。播放、暂停、进度调节全员实时响应，智能应对弱网环境，绝非简单的单机播放器加聊天室。",
    points: ["全员状态对齐", "RTP Opus 音频", "智能断线恢复"]
  },
  {
    eyebrow: "Privacy & Performance",
    title: "本地曲库，全球无缝共享",
    body: "无需把本地音频长期上传到云端。文件和播放资产保留在您的浏览器中，由当前曲目拥有者通过 WebRTC RTP Opus 向房间成员发布实时音频。",
    points: ["本地上传资源", "RTP Opus 媒体流", "隐私数据保护"]
  }
];

const architectureItems = [
  {
    title: "Modern Web Experience",
    body: "现代化的沉浸式 Web 界面，提供极致流畅的视觉与交互体验。"
  },
  {
    title: "Reliable Room Signaling",
    body: "基于 Socket.IO 的房间信令服务，负责状态同步、成员 presence 和 WebRTC 协商。"
  },
  {
    title: "Stable Media Transport",
    body: "稳定的实时状态广播机制，结合单一的 WebRTC RTP Opus 音频链路。"
  },
  {
    title: "Responsive Web Platform",
    body: "无需安装客户端，使用现代浏览器即可在桌面和移动设备进入同一套协作体验。"
  }
];

function ProductRoomPreview() {
  const queue = [
    { title: "Night Drive", owner: "Host local FLAC", active: true },
    { title: "City Lights", owner: "Alice upload", active: false },
    { title: "After Hours", owner: "Ben upload", active: false }
  ];
  const members = [
    { name: "HOST", color: "bg-accent/20 text-accent" },
    { name: "AL", color: "bg-emerald-400/15 text-emerald-300" },
    { name: "BE", color: "bg-amber-400/15 text-amber-300" }
  ];

  return (
    <div className="relative mx-auto w-full max-w-5xl animate-slide-up select-none">
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

            <div className="group relative self-center my-4 flex items-center justify-center">
              <div className="relative flex h-[11rem] w-[11rem] items-center justify-center overflow-hidden rounded-full border border-white/5 bg-gradient-to-tr from-[#020202] via-[#111111] to-[#1a1a1a] shadow-[0_24px_80px_rgba(0,112,243,0.15)] animate-spin-slow sm:h-[13rem] sm:w-[13rem]">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.1),transparent_40%)]" />
                <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg_at_50%_50%,rgba(0,112,243,0.1)_0deg,rgba(0,0,0,0)_90deg,rgba(0,112,243,0.1)_180deg,rgba(0,0,0,0)_270deg,rgba(0,112,243,0.1)_360deg)]" />
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="absolute rounded-full border border-white/[0.02]"
                    style={{ width: `${100 - index * 15}%`, height: `${100 - index * 15}%` }}
                  />
                ))}
                <div className="relative z-10 flex h-[3.5rem] w-[3.5rem] items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-accent/20 to-blue-500/20 shadow-inner sm:h-[4rem] sm:w-[4rem]">
                  <div className="h-[1rem] w-[1rem] rounded-full border border-white/5 bg-black shadow-inner sm:h-[1.1rem] sm:w-[1.1rem]" />
                </div>
              </div>

              <div
                className="absolute right-[-1.5rem] top-[0.5rem] flex h-[7.5rem] w-[1.75rem] origin-[14px_14px] rotate-[20deg] flex-col items-center sm:right-[-2.2rem] sm:h-[9rem] sm:w-[1.8rem]"
                style={{ zIndex: 30 }}
              >
                <div className="absolute top-0 z-10 flex h-[1.75rem] w-[1.75rem] items-center justify-center rounded-full border-2 border-[#111] bg-gradient-to-br from-neutral-300 to-neutral-600 shadow-xl sm:h-[1.8rem] sm:w-[1.8rem]">
                  <div className="h-[0.75rem] w-[0.75rem] rounded-full bg-[#111] shadow-inner sm:h-[0.8rem] sm:w-[0.8rem]" />
                </div>
                <div className="h-full w-[0.6rem] bg-gradient-to-r from-neutral-400 via-neutral-200 to-neutral-500 pt-[1.75rem] shadow-lg sm:w-[0.65rem] sm:pt-[1.8rem]" />
                <div className="relative ml-[-0.75rem] h-[2.25rem] w-[1.25rem] skew-x-[15deg] rounded-b-md border-b-2 border-accent bg-[#222] shadow-2xl sm:ml-[-0.85rem] sm:h-[2.4rem] sm:w-[1.4rem]">
                  <div className="absolute right-0 top-2 h-2 w-2 rounded-full bg-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                </div>
              </div>

              <div className="absolute bottom-[-1.5rem] left-1/2 h-[2rem] w-[80%] -translate-x-1/2 bg-accent/20 blur-[45px] sm:h-[2.5rem]" />
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
              { label: "Audio", value: "RTP Opus", tone: "text-emerald-300" }
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
  const appHref = buildAppEntryHref();

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-black font-sans selection:bg-accent/30 selection:text-white">
      <TopBar activeSession={null} variant="marketing" />

      <div className="fixed inset-0 -z-10 bg-black">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4.5rem_4.5rem] [mask-image:radial-gradient(ellipse_70%_55%_at_50%_0%,#000_60%,transparent_100%)]" />
      </div>

      <section id="project" className="mx-auto flex w-full max-w-[1240px] flex-col items-center px-5 pb-20 pt-16 text-center sm:px-6 md:pb-28 md:pt-24">
        <p className="mb-5 rounded-full border border-accent/25 bg-accent/10 px-4 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.24em] text-accent">
          Next-Generation Co-listening Experience
        </p>
        <h1 className="max-w-5xl text-5xl font-extrabold leading-[0.95] tracking-tight text-white sm:text-6xl md:text-8xl">
          Music Room
        </h1>
        <p className="mt-7 max-w-3xl text-base leading-8 text-white/[0.58] md:text-xl">
          与好友实时同步收听本地高保真音乐。通过房间状态同步和 WebRTC RTP Opus 媒体链路，获得浏览器优先的协作听歌体验。
        </p>
        <div className="mt-9 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
          <Link href={appHref as Route}>
            <Button size="lg" className="h-12 w-full rounded-lg px-7 text-base sm:w-auto">
              立即开始免费使用
            </Button>
          </Link>

          <Link href="#features">
            <Button
              size="lg"
              variant="ghost"
              className="h-12 w-full rounded-lg border border-white/[0.06] px-7 text-base text-white/[0.72] hover:bg-white/[0.06] hover:text-white sm:w-auto"
            >
              了解核心特性
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
              专为性能与隐私设计的底层架构
            </h2>
            <p className="mt-5 text-base leading-7 text-white/[0.55]">
              Music Room 让音频文件留在用户浏览器，通过房间状态同步和 WebRTC RTP Opus 媒体链路，提供稳定、安全、纯粹的协作收听体验。
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

      <footer className="border-t border-white/[0.05] bg-black py-10 sm:py-14">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col items-center justify-between gap-6 px-5 sm:flex-row sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent shadow-[0_0_15px_rgba(0,112,243,0.3)]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>
            <span className="font-bold tracking-tight text-white">Music Room</span>
          </div>

          <p className="text-[13px] text-white/[0.45]">
            &copy; {new Date().getFullYear()} Music Room. Open Source on GitHub.
          </p>

          <div className="flex items-center gap-6 text-[13px] font-medium text-white/[0.45]">
            <Link href={githubRepositoryUrl} target="_blank" rel="noreferrer" className="transition-colors hover:text-white">
              GitHub
            </Link>
            <Link href="#" className="transition-colors hover:text-white">
              Privacy
            </Link>
            <Link href="#" className="transition-colors hover:text-white">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
