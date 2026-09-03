import Link from "next/link";
import type { Route } from "next";

import { TopBar } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { buildAppEntryHref } from "@/lib/domain/client-shell";
import {
  SparklesIcon,
  RadioIcon,
  ZapIcon,
  ShieldCheckIcon,
  LaptopIcon,
  MusicIcon
} from "@/components/icons/DiscoverIcons";

const githubRepositoryUrl = "https://github.com/witw123/music_room";

const projectStats = [
  { label: "实时对齐延迟", value: "< 50ms", note: "WebRTC 毫秒级同步", tone: "text-sky-400" },
  { label: "声学链路", value: "RTP Opus", note: "高保真音频编码", tone: "text-emerald-400" },
  { label: "隐私模型", value: "Local-First", note: "本地文件零上云", tone: "text-fuchsia-400" },
  { label: "运行平台", value: "Browser 优先", note: "免安装多端互通", tone: "text-amber-400" }
];

const capabilities = [
  {
    index: "01",
    eyebrow: "Spatial Co-listening Room",
    title: "一站式全景音乐空间，随时开启协作派对",
    body: "在同一个现代化声学工作台中自由探索。支持互动点歌、DJ 电台广播与专属点播策展。房间码一键直达，全员共享同一条实时低延迟播放流与互动打 Call。",
    points: ["沉浸式黑胶主舞台", "一键邀请加入", "房间实时打 Call 互动", "流光逐字歌词"]
  },
  {
    index: "02",
    eyebrow: "Ultra-Low Latency Engine",
    title: "毫秒级 WebRTC 状态对齐与无损音频链路",
    body: "基于先进的 WebRTC 点对点通信与 RTP Opus 流传输机制。播放、暂停、进度微调全员实时瞬时响应，自适应弱网抖动补偿，绝非简单的单机播放器加文字聊天室。",
    points: ["全员状态毫秒级对齐", "48kHz 高保真 Opus 流", "智能断线静默重连"]
  },
  {
    index: "03",
    eyebrow: "Local-First Privacy Architecture",
    title: "本地音乐库，全球好友无缝共享",
    body: "无需将本地珍藏的 FLAC/无损音频上传至第三方云端服务器。音频资产全程保留在您的浏览器本地目录中，由曲目拥有者通过 P2P 链路直接向房间成员广播播放。",
    points: ["本地文件零云端留存", "端到端媒体流传输", "网易云/QQ音乐多源互通"]
  }
];

const architectureItems = [
  {
    icon: LaptopIcon,
    title: "现代前端声学体验",
    body: "基于 Next.js 与顶级现代设计系统，提供极致流畅的 120 FPS 视觉、物理黑胶转盘与声学交互。"
  },
  {
    icon: RadioIcon,
    title: "高可靠房间信令网",
    body: "基于 Socket.IO 的全双工信令总线，负责毫秒级状态同步、成员在线感知与 WebRTC 自动协商。"
  },
  {
    icon: ZapIcon,
    title: "WebRTC 媒体流传输",
    body: "点对点 RTP Opus 高保真音频通道，确保声音在跨网络传输中保持极低抖动与纯净音质。"
  },
  {
    icon: ShieldCheckIcon,
    title: "Local-First 隐私防线",
    body: "浏览器端本地存储沙盒与 File System Access API，保护用户私有曲库免受任何第三方泄露。"
  }
];

function ProductRoomPreview() {
  const queue = [
    { title: "Night Drive (Synthwave)", owner: "Host local FLAC", active: true },
    { title: "City Lights & Neon Rain", owner: "Alice · 网易云", active: false },
    { title: "Midnight Horizon", owner: "Ben · QQ 音乐", active: false }
  ];
  const members = [
    { name: "HOST", color: "bg-accent/20 text-accent border-accent/30" },
    { name: "AL", color: "bg-emerald-400/20 text-emerald-300 border-emerald-400/30" },
    { name: "BE", color: "bg-amber-400/20 text-amber-300 border-amber-400/30" }
  ];

  return (
    <div className="relative mx-auto w-full max-w-5xl animate-in fade-in zoom-in-95 duration-500 select-none">
      {/* Ambient Celestial Glow */}
      <div className="absolute -inset-6 rounded-[2.5rem] bg-[radial-gradient(circle_at_35%_20%,rgba(0,112,243,0.25),transparent_40%),radial-gradient(circle_at_80%_45%,rgba(192,38,211,0.18),transparent_35%),radial-gradient(circle_at_50%_90%,rgba(16,185,129,0.15),transparent_30%)] blur-3xl pointer-events-none" />

      {/* Main Console Box */}
      <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-[#07090e]/95 shadow-[0_30px_100px_rgba(0,0,0,0.8)] backdrop-blur-2xl">
        {/* Window Title Bar */}
        <div className="flex h-12 items-center justify-between border-b border-white/[0.06] px-5 bg-white/[0.02]">
          <div className="flex gap-2">
            <span className="h-3 w-3 rounded-full bg-[#fa233b]/70 border border-[#fa233b]/40" />
            <span className="h-3 w-3 rounded-full bg-[#f59e0b]/70 border border-[#f59e0b]/40" />
            <span className="h-3 w-3 rounded-full bg-[#10b981]/70 border border-[#10b981]/40" />
          </div>
          <div className="rounded-full border border-white/[0.06] bg-white/[0.04] px-5 py-1 font-mono text-[11px] text-white/50 shadow-inner flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>music-room / live_stage_27A4</span>
          </div>
          <div className="w-12 text-right">
            <span className="text-[10px] font-mono text-white/30 uppercase">v2.0</span>
          </div>
        </div>

        {/* 3-Column Studio Body */}
        <div className="grid min-h-[440px] gap-5 p-5 md:grid-cols-[250px_1fr_240px]">
          {/* Left: Shared Queue */}
          <aside className="hidden rounded-2xl border border-white/[0.06] bg-[#10121a]/80 p-4 md:flex flex-col justify-between">
            <div>
              <div className="mb-4 flex items-center justify-between">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-white/50">
                  Shared Queue
                </p>
                <span className="rounded-full bg-emerald-400/15 border border-emerald-400/30 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
                  LIVE 3 首
                </span>
              </div>
              <div className="space-y-2">
                {queue.map((track, index) => (
                  <div
                    key={track.title}
                    className={`rounded-xl border p-3 transition-all ${
                      track.active
                        ? "border-accent/40 bg-accent/[0.12] shadow-[0_4px_16px_var(--accent-glow)]"
                        : "border-transparent bg-white/[0.03] hover:bg-white/[0.05]"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-mono text-xs ${
                          track.active ? "bg-accent text-white font-bold" : "bg-white/[0.06] text-white/40"
                        }`}
                      >
                        {track.active ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        ) : (
                          index + 1
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-white">{track.title}</p>
                        <p className="truncate text-[10px] text-foreground-muted mt-0.5">{track.owner}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="pt-3 border-t border-white/[0.06] text-[11px] text-foreground-muted flex items-center justify-between">
              <span>全员队列同步</span>
              <span className="text-emerald-400 font-mono">0ms 偏差</span>
            </div>
          </aside>

          {/* Center: Stage Record */}
          <section className="relative flex min-h-[350px] flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-[#131622]/90 to-[#0b0d14]/95 p-6 shadow-inner">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent font-bold">
                  NOW PLAYING
                </p>
                <h2 className="mt-1 text-2xl font-extrabold text-white md:text-3xl tracking-tight">Night Drive</h2>
                <p className="text-xs text-foreground-muted">Synthwave Collective · Cyber Odyssey</p>
              </div>
              <div className="flex -space-x-2">
                {members.map((member) => (
                  <span
                    key={member.name}
                    className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-[10px] font-bold ${member.color}`}
                  >
                    {member.name}
                  </span>
                ))}
              </div>
            </div>

            {/* Rotating Vinyl Record Mockup */}
            <div className="group relative self-center my-4 flex items-center justify-center">
              <div className="relative flex h-[12rem] w-[12rem] items-center justify-center overflow-hidden rounded-full border border-white/10 bg-gradient-to-tr from-[#050505] via-[#121212] to-[#1c1c1c] shadow-[0_24px_80px_rgba(0,112,243,0.2)] animate-spin-slow sm:h-[14rem] sm:w-[14rem]">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.12),transparent_40%)]" />
                <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg_at_50%_50%,rgba(0,112,243,0.15)_0deg,rgba(0,0,0,0)_90deg,rgba(0,112,243,0.15)_180deg,rgba(0,0,0,0)_270deg,rgba(0,112,243,0.15)_360deg)]" />
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="absolute rounded-full border border-white/[0.03]"
                    style={{ width: `${100 - index * 14}%`, height: `${100 - index * 14}%` }}
                  />
                ))}
                <div className="relative z-10 flex h-[4rem] w-[4rem] items-center justify-center rounded-full border border-white/15 bg-gradient-to-br from-accent/30 to-blue-500/30 shadow-inner">
                  <div className="h-[1.2rem] w-[1.2rem] rounded-full border border-white/10 bg-black shadow-inner" />
                </div>
              </div>

              {/* Tonearm */}
              <div
                className="absolute right-[-1.8rem] top-[0.5rem] flex h-[8.5rem] w-[1.75rem] origin-[14px_14px] rotate-[22deg] flex-col items-center sm:right-[-2.4rem] sm:h-[9.5rem] sm:w-[1.8rem]"
                style={{ zIndex: 30 }}
              >
                <div className="absolute top-0 z-10 flex h-[1.8rem] w-[1.8rem] items-center justify-center rounded-full border-2 border-[#181818] bg-gradient-to-br from-neutral-300 to-neutral-600 shadow-xl">
                  <div className="h-[0.8rem] w-[0.8rem] rounded-full bg-[#111] shadow-inner" />
                </div>
                <div className="h-full w-[0.6rem] bg-gradient-to-r from-neutral-400 via-neutral-200 to-neutral-500 pt-[1.8rem] shadow-lg" />
                <div className="relative ml-[-0.8rem] h-[2.3rem] w-[1.3rem] skew-x-[15deg] rounded-b-md border-b-2 border-accent bg-[#1a1a1a] shadow-2xl">
                  <div className="absolute right-0 top-2 h-2 w-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                </div>
              </div>

              <div className="absolute bottom-[-1.5rem] left-1/2 h-[2.5rem] w-[80%] -translate-x-1/2 bg-accent/20 blur-[50px]" />
            </div>

            {/* Progress & Controls */}
            <div>
              <div className="mb-2.5 flex items-center justify-between font-mono text-[11px] text-white/50">
                <span>01:46</span>
                <span className="text-accent font-semibold">● 实时同步中</span>
                <span>04:12</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-[43%] rounded-full bg-gradient-to-r from-accent to-sky-400" />
              </div>
              <div className="mt-4 flex items-center justify-center gap-6 text-white/50">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 20L9 12l10-8v16zM5 19V5" />
                </svg>
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black shadow-lg">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                </span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 4l10 8-10 8V4zM19 5v14" />
                </svg>
              </div>
            </div>
          </section>

          {/* Right: Telemetry Chips */}
          <aside className="grid gap-3 sm:grid-cols-3 md:grid-cols-1">
            {[
              { label: "Source Host", value: "@主理人", tone: "text-accent" },
              { label: "P2P 传输状态", value: "WebRTC 极速就绪", tone: "text-emerald-400" },
              { label: "音频编码", value: "RTP Opus 48kHz", tone: "text-sky-400" }
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-white/[0.06] bg-[#10121a]/80 p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
                  {item.label}
                </p>
                <p className={`mt-2 text-base font-bold ${item.tone}`}>{item.value}</p>
              </div>
            ))}
            <div className="hidden rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-4 md:block">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
                本地音频保护
              </p>
              <p className="mt-2 truncate text-xs font-semibold text-white">night_drive.flac</p>
              <p className="mt-1 text-[11px] text-foreground-muted">音频源文件全程留在本机，零泄露</p>
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
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#06070a] font-sans selection:bg-accent/30 selection:text-white">
      <TopBar activeSession={null} variant="marketing" />

      {/* Cosmic Background Grid */}
      <div className="fixed inset-0 -z-10 bg-[#06070a]">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4.5rem_4.5rem] [mask-image:radial-gradient(ellipse_70%_55%_at_50%_0%,#000_60%,transparent_100%)]" />
      </div>

      {/* Hero Section */}
      <section id="project" className="mx-auto flex w-full max-w-[1240px] flex-col items-center px-5 pb-20 pt-16 text-center sm:px-6 md:pb-28 md:pt-24">
        <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.24em] text-accent backdrop-blur-md shadow-sm">
          <SparklesIcon className="w-3.5 h-3.5" />
          <span>Next-Generation Spatial Co-listening</span>
        </p>
        <h1 className="max-w-5xl text-5xl font-black leading-[0.95] tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-white via-white/95 to-white/60 sm:text-6xl md:text-8xl">
          Music Room
        </h1>
        <p className="mt-7 max-w-3xl text-base leading-8 text-white/60 md:text-xl font-normal">
          与好友实时同步收听本地高保真音乐。通过房间状态同步和 WebRTC RTP Opus 媒体链路，获得浏览器优先的协作听歌体验。
        </p>
        <div className="mt-9 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
          <Link href={appHref as Route}>
            <Button size="lg" className="h-13 w-full rounded-2xl px-8 text-base font-semibold bg-accent hover:bg-accent-hover text-white shadow-[0_4px_24px_var(--accent-glow)] transition-all sm:w-auto active:scale-95">
              立即开始免费使用
            </Button>
          </Link>

          <Link href="#features">
            <Button
              size="lg"
              variant="ghost"
              className="h-13 w-full rounded-2xl border border-white/[0.08] bg-white/[0.04] px-8 text-base font-medium text-white/80 hover:bg-white/[0.08] hover:text-white sm:w-auto"
            >
              了解核心特性
            </Button>
          </Link>
        </div>

        {/* Hero Interactive Preview */}
        <div className="mt-14 w-full md:mt-18">
          <ProductRoomPreview />
        </div>
      </section>

      {/* 4 Hardcore Metrics Grid */}
      <section className="mx-auto grid w-full max-w-[1120px] grid-cols-2 gap-3 px-5 sm:px-6 md:grid-cols-4">
        {projectStats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-3xl border border-white/[0.06] bg-[#10121a]/80 p-6 text-center backdrop-blur-xl shadow-lg hover:border-white/[0.12] transition-all"
          >
            <p className={`text-2xl font-black ${stat.tone} md:text-3xl tracking-tight`}>{stat.value}</p>
            <p className="mt-2 text-xs font-bold text-white">{stat.label}</p>
            <p className="mt-1 text-[11px] text-foreground-muted">{stat.note}</p>
          </div>
        ))}
      </section>

      {/* Core Capabilities */}
      <section id="features" className="mx-auto w-full max-w-[1120px] px-5 py-24 sm:px-6 md:py-32">
        <div className="mb-14 max-w-2xl">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.24em] text-accent">
            Core Capabilities
          </p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-white md:text-5xl">
            把本地音乐变成一个可协作的实时房间
          </h2>
        </div>

        <div className="grid gap-6">
          {capabilities.map((section) => (
            <article
              key={section.title}
              className="rounded-3xl border border-white/[0.06] bg-gradient-to-b from-[#12141c]/80 to-[#0c0e15]/90 p-8 sm:p-10 shadow-xl backdrop-blur-2xl grid gap-6 md:grid-cols-[0.5fr_1fr]"
            >
              <div>
                <span className="inline-block font-mono text-2xl font-black text-accent mb-2">
                  {section.index}
                </span>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/40">
                  {section.eyebrow}
                </p>
              </div>
              <div>
                <h3 className="text-2xl font-bold leading-tight text-white md:text-3xl tracking-tight">
                  {section.title}
                </h3>
                <p className="mt-4 max-w-3xl text-sm sm:text-base leading-relaxed text-white/60">
                  {section.body}
                </p>
                <div className="mt-6 flex flex-wrap gap-2.5">
                  {section.points.map((point) => (
                    <span
                      key={point}
                      className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-1.5 text-xs font-medium text-white/80"
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

      {/* Architecture Matrix */}
      <section id="architecture" className="mx-auto w-full max-w-[1120px] px-5 pb-24 sm:px-6 md:pb-32">
        <div className="grid gap-10 md:grid-cols-[0.85fr_1.15fr] md:items-start">
          <div className="md:sticky md:top-24">
            <p className="font-mono text-xs font-bold uppercase tracking-[0.24em] text-accent">
              Architecture
            </p>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-white md:text-5xl">
              专为性能与隐私设计的底层架构
            </h2>
            <p className="mt-5 text-sm sm:text-base leading-relaxed text-white/60">
              Music Room 让音频文件留在用户浏览器，通过房间状态同步和 WebRTC RTP Opus 媒体链路，提供稳定、安全、纯粹的协作收听体验。
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {architectureItems.map((item) => {
              const IconComp = item.icon;
              return (
                <div
                  key={item.title}
                  className="rounded-2xl border border-white/[0.06] bg-[#10121a]/80 p-6 backdrop-blur-xl shadow-lg hover:border-white/[0.12] transition-all"
                >
                  <div className="h-10 w-10 rounded-xl bg-accent/15 border border-accent/20 flex items-center justify-center text-accent mb-4">
                    <IconComp className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-bold text-white tracking-tight">{item.title}</h3>
                  <p className="mt-2.5 text-xs sm:text-sm leading-relaxed text-white/50">{item.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Minimalist Footer */}
      <footer className="border-t border-white/[0.06] bg-[#06070a] py-12 sm:py-16">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col items-center justify-between gap-6 px-5 sm:flex-row sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent shadow-[0_0_16px_rgba(0,112,243,0.4)]">
              <MusicIcon className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold tracking-tight text-white text-base">Music Room</span>
          </div>

          <p className="text-xs text-white/40">
            &copy; {new Date().getFullYear()} Music Room. Open Source on GitHub.
          </p>

          <div className="flex items-center gap-6 text-xs font-medium text-white/50">
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
