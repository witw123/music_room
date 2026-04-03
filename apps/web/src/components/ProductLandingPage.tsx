import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { githubReleasesUrl } from "@/lib/client-shell";

const featureSections = [
  {
    eyebrow: "房间系统",
    title: "每一个房间都与众不同",
    body: "所有成员将在同一播放序列，一起协作，构建音乐舞台。",
    bullets: ["无限制创建房间", "可开放可私密的房间机制", "邀请码加入房间，一键直达"]
  },
  {
    eyebrow: "实时同步",
    title: "歌曲状态始终保持一致",
    body: "通过 WebRTC 与 WebSocket 的混合拓扑，房间开始播放后，每个成员看到的进度线和反馈都尽量保持一致。",
    bullets: ["共享播放控制权", "播放 / 暂停 / 进度实时同步","重传机制实时保证体验"]
  },
  {
    eyebrow: "本地音乐",
    title: "带着你的本地曲库，无惧流媒体",
    body: "你可以导入本地音频、快速入队，并把多人协作后的队列继续沉淀为歌单。",
    bullets: ["支持导入本地音频文件", "队列与歌单可持续复用", "多人一同提交和管理"]
  }
];

export function ProductLandingPage() {
  return (
    <main className="relative flex min-h-screen flex-col bg-[#000000] pb-20 font-sans selection:bg-accent/30 selection:text-white">
      <TopBar activeSession={null} />

      <div className="fixed inset-0 -z-10 overflow-hidden bg-[#000000] pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
      </div>

      <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col items-center px-6 pt-24 md:pt-36">
        <section className="relative z-10 mb-20 flex w-full max-w-4xl animate-fade-in flex-col items-center text-center md:mb-32">
          <div className="mb-8 inline-flex items-center justify-center rounded-full border border-accent/20 bg-accent/10 px-4 py-1.5 backdrop-blur-sm">
            <span className="cursor-default font-mono text-xs font-bold tracking-widest text-accent">MUSIC ROOM 1.0</span>
          </div>

          <h1 className="mb-8 text-4xl font-extrabold leading-[1.1] tracking-tight text-white md:text-6xl lg:text-7xl">
            让协作与本地音乐，
            <br className="hidden md:block" />
            重新回到<span className="text-accent">同频</span>的房间。
          </h1>

          <p className="max-w-2xl text-base leading-relaxed text-white/50 md:text-xl">
            Music Room 专为对听歌协同有执念的用户而生。没有杂乱的聊天面板和冗余功能，所有设计都聚焦在音乐本身。
          </p>

          <p className="mt-6 hidden select-none font-mono text-xs text-white/30 md:block">
            Requires modern browser. Peer-to-peer technology empowered.
          </p>
        </section>

        <div className="relative mb-40 w-full max-w-6xl animate-slide-up select-none pointer-events-none">
          <div className="absolute -inset-0.5 rounded-[1.6rem] bg-accent/20 blur opacity-30 transition duration-1000" />
          <div className="relative flex aspect-video flex-col overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#050505] shadow-2xl">
            <div className="flex h-12 items-center gap-2 border-b border-white/5 bg-[#0a0a0a] px-4">
              <div className="flex gap-1.5">
                <div className="h-3 w-3 rounded-full bg-white/10" />
                <div className="h-3 w-3 rounded-full bg-white/10" />
                <div className="h-3 w-3 rounded-full bg-white/10" />
              </div>
              <div className="mx-auto flex items-center gap-2 rounded-md border border-white/5 bg-[#111] px-10 py-1.5 font-mono text-[10px] text-white/30">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                room.local / wksp
              </div>
            </div>

            <div className="flex flex-1 gap-6 p-5">
              <div className="hidden h-full w-[300px] flex-col gap-2 overflow-hidden rounded-xl border border-white/5 bg-white/[0.02] p-4 lg:flex">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-[10px] font-bold tracking-widest text-white/50">SHARED QUEUE</span>
                  <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] text-white/50">14 TRACKS</span>
                </div>
                {[
                  { title: "Lost in the Echo", artist: "Linkin Park", active: true },
                  { title: "Starboy", artist: "The Weeknd", active: false },
                  { title: "Instant Crush", artist: "Daft Punk", active: false },
                  { title: "Midnight City", artist: "M83", active: false }
                ].map((track, index) => (
                  <div
                    key={track.title}
                    className={`flex w-full items-center justify-between rounded-xl p-3 transition-colors ${
                      track.active ? "border border-accent/30 bg-accent/15" : "border border-transparent bg-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                          track.active ? "bg-accent text-white shadow-lg shadow-accent/20" : "bg-white/5 text-white/40"
                        }`}
                      >
                        {track.active ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        ) : (
                          <span className="font-mono text-xs">{index + 1}</span>
                        )}
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className={`w-32 truncate text-sm font-semibold ${track.active ? "text-white" : "text-white/70"}`}>
                          {track.title}
                        </span>
                        <span className="text-[10px] text-white/40">{track.artist}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="relative flex h-full flex-1 flex-col items-center justify-center overflow-hidden rounded-xl border border-white/5 bg-[radial-gradient(ellipse_at_center,rgba(0,112,243,0.05),transparent_70%)]">
                <div className="absolute right-4 top-4 flex -space-x-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#050505] bg-blue-500/20 text-[10px] font-bold text-blue-400">WK</div>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#050505] bg-purple-500/20 text-[10px] font-bold text-purple-400">AL</div>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#050505] bg-emerald-500/20 text-[10px] font-bold text-emerald-400">BO</div>
                </div>

                <div className="relative mb-8 flex h-48 w-48 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-blue-600/20 to-indigo-600/20 shadow-2xl md:h-64 md:w-64">
                  <div className="absolute inset-0 rounded-2xl bg-blue-500/5 backdrop-blur-3xl" />
                  <div className="relative z-10 flex h-24 w-24 items-center justify-center rounded-full border border-white/20 bg-black/20">
                    <div className="h-8 w-8 rounded-full bg-white/20" />
                  </div>
                </div>

                <div className="w-full max-w-md px-6 text-center">
                  <h2 className="mb-1 text-2xl font-bold text-white md:text-3xl">Lost in the Echo</h2>
                  <p className="mb-8 text-sm text-white/50 md:text-base">Linkin Park</p>

                  <div className="flex flex-col gap-2">
                    <div className="relative h-1.5 w-full overflow-visible rounded-full bg-white/10">
                      <div className="absolute left-0 top-0 h-full w-[45%] rounded-full bg-accent" />
                    </div>
                    <div className="flex justify-between font-mono text-[11px] tracking-wider text-white/40">
                      <span>01:12</span>
                      <span>03:25</span>
                    </div>
                  </div>

                  <div className="mt-6 flex items-center justify-center gap-8">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/40">
                      <path d="M19 20L9 12l10-8v16zM5 19V5" />
                    </svg>
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-black shadow-lg">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                      </svg>
                    </div>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/40">
                      <path d="M5 4l10 8-10 8V4zM19 5v14" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <section className="mb-40 grid w-full grid-cols-2 gap-8 border-y border-white/5 bg-[#020202] py-12 md:grid-cols-4">
          {[
            { label: "毫秒级同步", val: "< 100ms" },
            { label: "支持格式", val: "FLAC/MP3" },
            { label: "依赖平台", val: "WEB" },
            { label: "网络架构", val: "P2P WebRTC" }
          ].map((stat) => (
            <div key={stat.label} className="flex flex-col items-center justify-center text-center">
              <span className="text-3xl font-extrabold tracking-tight text-white md:text-4xl">{stat.val}</span>
              <span className="mt-2 font-mono text-xs uppercase tracking-widest text-white/40">{stat.label}</span>
            </div>
          ))}
        </section>

        <section className="mb-40 flex w-full flex-col gap-24 md:gap-32">
          <div className="mb-10 flex w-full flex-col items-center text-center">
            <h2 className="mb-6 text-3xl font-bold text-white md:text-4xl">不为功能而功能，只为核心工作流让路</h2>
            <p className="max-w-2xl text-base text-white/50">所有重要界面都围绕房间、队列、同步播放和本地音乐管理展开，不让多余入口分散注意力。</p>
          </div>

          {featureSections.map((section, index) => {
            const isEven = index % 2 === 0;

            return (
              <article
                key={section.title}
                className={`flex flex-col items-center gap-10 lg:gap-20 ${isEven ? "lg:flex-row" : "lg:flex-row-reverse"}`}
              >
                <div className="relative flex aspect-video w-full flex-1 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[#050505] p-2 shadow-xl">
                  <div className="pointer-events-none absolute -inset-10 rounded-[100%] bg-accent/5 blur-[100px]" />
                  <div className="relative z-10 flex h-full max-h-64 w-full max-w-sm items-center justify-center p-6">
                    {index === 0 ? (
                      <div className="flex w-full flex-col gap-3">
                        <div className="flex w-full items-center justify-between rounded-xl border border-accent/20 bg-accent/10 p-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded bg-accent/20">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-accent">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </div>
                            <div>
                              <div className="mb-2 h-2 w-24 rounded bg-white/90" />
                              <div className="h-1.5 w-16 rounded bg-white/50" />
                            </div>
                          </div>
                          <div className="h-6 w-6 rounded-full border border-white/20 bg-white/10" />
                        </div>
                        <div className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/5 p-4 opacity-50">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded bg-white/10" />
                            <div>
                              <div className="mb-2 h-2 w-32 rounded bg-white/60" />
                              <div className="h-1.5 w-20 rounded bg-white/30" />
                            </div>
                          </div>
                          <div className="h-6 w-6 rounded-full border border-white/20 bg-white/10" />
                        </div>
                      </div>
                    ) : null}

                    {index === 1 ? (
                      <div className="flex w-full flex-col items-center gap-6">
                        <div className="mb-4 flex gap-4">
                          {["W1", "YOU", "A2"].map((label, i) => (
                            <div
                              key={label}
                              className={`relative flex h-12 w-12 items-center justify-center rounded-full border ${
                                i === 1
                                  ? "border-accent/50 bg-accent/10 text-accent shadow-[0_0_15px_rgba(0,112,243,0.3)]"
                                  : "border-white/10 bg-[#111] text-white/40"
                              } text-[10px] font-bold`}
                            >
                              <div className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#111] bg-green-500" />
                              {label}
                            </div>
                          ))}
                        </div>
                        <div className="w-full max-w-xs">
                          <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                            <div className="h-full w-[60%] bg-accent" />
                          </div>
                          <div className="flex justify-between">
                            <div className="h-1.5 w-8 rounded bg-accent/50" />
                            <div className="h-1.5 w-8 rounded bg-white/20" />
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {index === 2 ? (
                      <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/10 bg-white/[0.01]">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mb-4 text-white/30">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="17 8 12 3 7 8" />
                          <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        <div className="mb-2 h-2 w-24 rounded bg-white/40" />
                        <div className="h-1 w-16 rounded bg-white/20" />
                        <div className="mt-6 rounded-lg border border-white/5 bg-white/5 px-4 py-2">
                          <div className="flex items-center gap-2 font-mono text-[10px] text-white/50">
                            <div className="h-2 w-2 rounded-full bg-accent" />
                            Audio_Track_Final.flac
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-1 flex-col justify-center">
                  <span className="mb-4 inline-flex items-center gap-3">
                    <span className="font-mono text-xl font-bold text-accent">0{index + 1}</span>
                    <span className="block h-px w-12 bg-white/10" />
                    <span className="text-xs font-bold uppercase tracking-wider text-white/50">{section.eyebrow}</span>
                  </span>

                  <h3 className="mb-6 text-2xl font-bold leading-tight text-white md:text-3xl">{section.title}</h3>
                  <p className="mb-8 text-base leading-relaxed text-white/60">{section.body}</p>

                  <ul className="flex flex-col gap-4">
                    {section.bullets.map((bullet) => (
                      <li key={bullet} className="flex items-center gap-3">
                        <div className="flex h-5 w-5 items-center justify-center rounded-full border border-accent/20 bg-accent/10">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="ml-0.5 text-accent">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        </div>
                        <span className="text-sm font-medium text-white/80">{bullet}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            );
          })}
        </section>

        <section className="relative mt-10 flex w-full flex-col items-center justify-center overflow-hidden rounded-3xl border border-white/5 bg-[#050505] py-20 text-center">
          <div className="absolute top-0 h-px w-full bg-gradient-to-r from-transparent via-accent to-transparent opacity-50" />
          <div className="absolute bottom-0 h-px w-full bg-gradient-to-r from-transparent via-accent/20 to-transparent opacity-50" />

          <p className="mb-6 font-mono text-xs font-bold uppercase tracking-[0.2em] text-accent">Download</p>
          <h2 className="mb-6 text-3xl font-extrabold tracking-tight text-white md:text-5xl">统一下载区</h2>
         

          <div className="grid w-full max-w-4xl gap-4 px-6 sm:grid-cols-2 sm:px-0">
            <a
              href={githubReleasesUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl border border-white/10 bg-white/5 p-6 text-left transition-colors hover:border-accent/40 hover:bg-accent/10"
            >
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.24em] text-accent">Desktop</p>
              <h3 className="mb-2 text-xl font-semibold text-white">Windows / macOS</h3>
              <p className="text-sm leading-relaxed text-white/55">桌面端</p>
            </a>
            <a
              href={githubReleasesUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl border border-white/10 bg-white/5 p-6 text-left transition-colors hover:border-accent/40 hover:bg-accent/10"
            >
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.24em] text-accent">Mobile</p>
              <h3 className="mb-2 text-xl font-semibold text-white">Android</h3>
              <p className="text-sm leading-relaxed text-white/55">移动端</p>
            </a>
          </div>

          <Link href={githubReleasesUrl} target="_blank" rel="noreferrer" className="mt-8">
            <Button size="lg" className="h-14 rounded-xl bg-accent px-10 text-lg text-white transition-all hover:bg-accent-hover shadow-[0_4px_14px_0_rgba(0,112,243,0.39)] hover:shadow-[0_6px_20px_rgba(0,112,243,0.23)]">
              前往 GitHub 支持我们的项目
            </Button>
          </Link>
        </section>
      </div>
    </main>
  );
}
