import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { githubReleasesUrl } from "@/lib/client-shell";

const featureSections = [
  {
    eyebrow: "房间系统",
    title: "每一个房间，都围绕共享队列展开",
    body: "彻底抛弃了聊天框为主的传统房间模式。在这里，所有成员围绕同一套播放序列协作，当前播放与下一首始终是视觉的核心锚点。",
    bullets: ["进入房间即可开始同播", "断线或刷新也能秒速恢复最近连线", "基于邀请码极其克制的加入流程"]
  },
  {
    eyebrow: "实时体验",
    title: "播放状态、进度和房间氛围毫秒级同步",
    body: "通过 WebRTC 与 WebSocket 的混合网状拓扑，当房间开始播放，每个成员看到的进度线和反馈都是一致的。不再有因为时差感带来的“各听各的”错觉。",
    bullets: ["去中心化的共享播放控制权", "播放/暂停进度高度一致的心跳机制", "技术诊断信息默认隐藏，不打扰听歌"]
  },
  {
    eyebrow: "音乐资产",
    title: "带着你的本地高保真图库，重新定义协作连线",
    body: "不需要强绑流媒体平台。通过 File System Access 机制，你可以直接上传本地无损音乐、快速入队，甚至在晚上结束时把大家的队列打包为歌单保留，下次继续连线。",
    bullets: ["浏览器直读本地音频文件", "队列历史与歌单云端持久化备份", "精确追溯是谁点了哪首单曲"]
  }
];

export function ProductLandingPage() {
  return (
    <main className="min-h-screen bg-[#000000] relative flex flex-col font-sans selection:bg-accent/30 selection:text-white pb-20">
      <TopBar />

      {/* Decorative Background Effects - Minimal Grid Only */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10 bg-[#000000]">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
      </div>

      <div className="flex-1 flex flex-col items-center pt-24 md:pt-36 px-6 max-w-[1200px] mx-auto w-full">
        {/* === HERO SECTION === */}
        <section className="flex flex-col items-center text-center w-full animate-fade-in relative z-10 mb-20 md:mb-32 max-w-4xl">
          <div className="inline-flex items-center justify-center px-4 py-1.5 rounded-full bg-accent/10 border border-accent/20 mb-8 backdrop-blur-sm">
            <span className="text-xs font-bold tracking-widest text-accent font-mono cursor-default">MUSIC ROOM 1.0</span>
          </div>
          
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold text-white tracking-tight leading-[1.1] mb-8">
             让协作与本地音乐，<br className="hidden md:block" />
             重新回到<span className="text-accent">同频</span>的房间。
          </h1>
          
          <p className="text-base md:text-xl text-white/50 max-w-2xl leading-relaxed mb-10">
            Music Room 专为对听歌协同有执念的极客而生。没有杂乱的聊天系统面板和沉余的功能拼凑，从第一秒开始，一切的设计都聚焦在音乐本身。
          </p>
          
          <div className="flex flex-col items-center justify-center gap-4 w-full md:w-auto sm:flex-row">
            <Link href={githubReleasesUrl} className="w-full md:w-auto" target="_blank" rel="noreferrer">
              <Button size="lg" className="w-full md:w-auto h-14 px-10 text-base md:text-lg bg-accent hover:bg-accent-hover text-white rounded-xl transition-all border border-transparent font-medium shadow-[0_0_20px_rgba(0,112,243,0.3)] hover:shadow-[0_0_30px_rgba(0,112,243,0.5)]">
                下载应用
              </Button>
            </Link>
            <p className="max-w-md text-sm leading-relaxed text-white/45">
              下载应用，和朋友一起创建房间、共享队列、实时同播你们真正想听的音乐。
            </p>
          </div>
          
          <p className="text-xs text-white/30 mt-6 font-mono hidden md:block select-none">Requires modern browser. Peer-to-peer technology empowered.</p>
        </section>

        {/* === HERO MOCKUP GRAPHIC === */}
        <div className="w-full max-w-6xl relative mb-40 animate-slide-up select-none pointer-events-none">
           <div className="absolute -inset-0.5 bg-accent/20 rounded-[1.6rem] blur opacity-30 transition duration-1000" />
           <div className="relative bg-[#050505] rounded-[1.5rem] border border-white/10 shadow-2xl overflow-hidden aspect-video flex flex-col">
             {/* Mockup Header */}
             <div className="h-12 border-b border-white/5 bg-[#0a0a0a] flex items-center px-4 gap-2">
                 <div className="flex gap-1.5">
                   <div className="w-3 h-3 rounded-full bg-white/10" />
                   <div className="w-3 h-3 rounded-full bg-white/10" />
                   <div className="w-3 h-3 rounded-full bg-white/10" />
                 </div>
                 <div className="mx-auto px-10 py-1.5 rounded-md bg-[#111] border border-white/5 text-[10px] text-white/30 font-mono flex items-center gap-2">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    room.local / wksp
                 </div>
             </div>
             {/* Mockup Body Content - High Fidelity */}
             <div className="flex-1 flex p-5 gap-6">
               {/* Left sidebar / Queue */}
               <div className="hidden lg:flex w-[300px] h-full flex-col gap-2 overflow-hidden bg-white/[0.02] rounded-xl border border-white/5 p-4">
                 <div className="flex justify-between items-center mb-4">
                    <span className="text-[10px] font-bold tracking-widest text-white/50">SHARED QUEUE</span>
                    <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded text-white/50">14 TRACKS</span>
                 </div>
                 {[
                   { title: "Lost in the Echo", artist: "Linkin Park", active: true, user: "wksp" },
                   { title: "Starboy", artist: "The Weeknd", active: false, user: "alice" },
                   { title: "Instant Crush", artist: "Daft Punk", active: false, user: "wksp" },
                   { title: "Midnight City", artist: "M83", active: false, user: "bob" },
                 ].map((track, i) => (
                   <div key={i} className={`w-full p-3 rounded-xl flex items-center justify-between transition-colors ${track.active ? 'bg-accent/15 border border-accent/30' : 'bg-transparent border border-transparent'}`}>
                     <div className="flex items-center gap-3">
                       <div className={`w-10 h-10 rounded-lg shrink-0 flex items-center justify-center ${track.active ? 'bg-accent shadow-lg shadow-accent/20 text-white' : 'bg-white/5 text-white/40'}`}>
                         {track.active ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> : <span className="text-xs font-mono">{i+1}</span>}
                       </div>
                       <div className="flex flex-col gap-0.5">
                         <span className={`text-sm font-semibold truncate w-32 ${track.active ? 'text-white' : 'text-white/70'}`}>{track.title}</span>
                         <span className="text-[10px] text-white/40">{track.artist}</span>
                       </div>
                     </div>
                     <div className="flex flex-col items-end gap-1">
                       {track.active && 
                         <div className="flex gap-[2px] items-end h-3">
                           <div className="w-[2px] h-1.5 bg-accent opacity-80" />
                           <div className="w-[2px] h-3 bg-accent opacity-90" />
                           <div className="w-[2px] h-2 bg-accent opacity-80" />
                         </div>
                       }
                     </div>
                   </div>
                 ))}
               </div>
               {/* Main artwork - Now Playing */}
               <div className="flex-1 h-full rounded-xl flex flex-col items-center justify-center border border-white/5 relative overflow-hidden bg-[radial-gradient(ellipse_at_center,rgba(0,112,243,0.05),transparent_70%)]">
                 <div className="absolute top-4 right-4 flex -space-x-2">
                   <div className="w-8 h-8 rounded-full border-2 border-[#050505] bg-blue-500/20 flex items-center justify-center text-[10px] font-bold text-blue-400">WK</div>
                   <div className="w-8 h-8 rounded-full border-2 border-[#050505] bg-purple-500/20 flex items-center justify-center text-[10px] font-bold text-purple-400">AL</div>
                   <div className="w-8 h-8 rounded-full border-2 border-[#050505] bg-emerald-500/20 flex items-center justify-center text-[10px] font-bold text-emerald-400">BO</div>
                 </div>

                 <div className="w-48 h-48 md:w-64 md:h-64 rounded-2xl bg-gradient-to-br from-blue-600/20 to-indigo-600/20 border border-white/10 shadow-2xl mb-8 flex items-center justify-center relative group">
                   <div className="absolute inset-0 bg-blue-500/5 backdrop-blur-3xl rounded-2xl"></div>
                   <div className="w-24 h-24 rounded-full border border-white/20 flex items-center justify-center relative z-10 bg-black/20">
                      <div className="w-8 h-8 rounded-full bg-white/20"></div>
                   </div>
                 </div>

                 <div className="text-center w-full max-w-md px-6">
                   <h2 className="text-2xl md:text-3xl font-bold text-white mb-1">Lost in the Echo</h2>
                   <p className="text-sm md:text-base text-white/50 mb-8">Linkin Park</p>
                   
                   {/* Progress bar */}
                   <div className="flex flex-col gap-2">
                     <div className="w-full h-1.5 bg-white/10 rounded-full overflow-visible relative group">
                       <div className="absolute left-0 top-0 h-full w-[45%] bg-accent rounded-full">
                          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-md scale-0 group-hover:scale-100 transition-transform"></div>
                       </div>
                     </div>
                     <div className="flex justify-between text-[11px] text-white/40 font-mono tracking-wider">
                       <span>01:12</span>
                       <span>03:25</span>
                     </div>
                   </div>

                   {/* Controls */}
                   <div className="flex items-center justify-center gap-8 mt-6">
                     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40 hover:text-white transition-colors"><path d="M19 20L9 12l10-8v16zM5 19V5"/></svg>
                     <div className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center shadow-lg hover:scale-105 transition-transform cursor-pointer">
                       <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
                     </div>
                     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40 hover:text-white transition-colors"><path d="M5 4l10 8-10 8V4zM19 5v14"/></svg>
                   </div>
                 </div>
               </div>
             </div>
           </div>
        </div>

        {/* === SOCIAL PROOF / VALUE METRICS === */}
        <section className="w-full grid grid-cols-2 md:grid-cols-4 gap-8 mb-40 border-y border-white/5 py-12 bg-[#020202]">
           {[
             { label: "毫秒级同步", val: "< 100ms" },
             { label: "支持格式", val: "FLAC/MP3" },
             { label: "依赖的服务平台", val: "Zero" },
             { label: "网络架构", val: "P2P WebRTC" }
           ].map((stat, i) => (
             <div key={i} className="flex flex-col items-center justify-center text-center">
               <span className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">{stat.val}</span>
               <span className="text-xs uppercase tracking-widest text-white/40 mt-2 font-mono">{stat.label}</span>
             </div>
           ))}
        </section>

        <section className="mb-32 w-full rounded-[32px] border border-white/8 bg-[linear-gradient(135deg,#050505_0%,#0b1020_100%)] px-6 py-10 sm:px-8 lg:px-12">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.28em] text-accent">Download</p>
              <h2 className="mb-4 text-3xl font-bold text-white sm:text-4xl">带上你的设备，随时加入同一间音乐房。</h2>
              <p className="text-sm leading-relaxed text-white/60 sm:text-base">
                无论在桌面端还是移动端，你都可以登录自己的账号，恢复最近的房间，继续共享队列、同步播放和多人协作聆听。
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:min-w-[420px]">
              <a
                href={githubReleasesUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-2xl border border-white/10 bg-white/5 p-5 transition-colors hover:border-accent/40 hover:bg-accent/10"
              >
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.24em] text-accent">Desktop</p>
                <h3 className="mb-2 text-xl font-semibold text-white">Windows / macOS</h3>
                <p className="text-sm leading-relaxed text-white/55">下载桌面版本，在更稳定的环境里管理房间、导入本地音乐并保持长时间同播。</p>
              </a>
              <a
                href={githubReleasesUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-2xl border border-white/10 bg-white/5 p-5 transition-colors hover:border-accent/40 hover:bg-accent/10"
              >
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.24em] text-accent">Mobile</p>
                <h3 className="mb-2 text-xl font-semibold text-white">iOS / Android</h3>
                <p className="text-sm leading-relaxed text-white/55">在移动端快速回到正在进行的房间，让同步播放和共享队列始终跟着你走。</p>
              </a>
            </div>
          </div>
        </section>

        {/* === FEATURE BENTO / ALTERNATING BLOCKS === */}
        <section className="w-full flex flex-col gap-24 md:gap-32 mb-40">
           <div className="text-center mb-10 w-full flex flex-col items-center">
             <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">不为功能而功能，只为核心工作流让路。</h2>
             <p className="text-white/50 max-w-2xl text-base">在这个空间里，除了纯粹的聆听与实时的协作确认，我们剥离了所有会分散注意力的冗余元素。</p>
           </div>

          {featureSections.map((section, idx) => {
            const isEven = idx % 2 === 0;
            return (
              <article key={section.title} className={`flex flex-col gap-10 lg:gap-20 items-center ${isEven ? 'lg:flex-row' : 'lg:flex-row-reverse'}`}>
                {/* Feature Graphic/Bento Panel */}
                <div className="flex-1 w-full bg-[#050505] p-2 rounded-2xl border border-white/10 aspect-video shadow-xl relative overflow-hidden flex flex-col justify-center items-center pointer-events-none select-none">
                  <div className="absolute -inset-10 bg-accent/5 rounded-[100%] blur-[100px] pointer-events-none" />
                  
                  <div className="w-full max-w-sm h-full max-h-64 flex flex-col items-center justify-center relative z-10 p-6">
                    {/* Unique Graphic per index */}
                    {idx === 0 && (
                      <div className="w-full flex flex-col gap-3">
                        <div className="w-full p-4 bg-accent/10 border border-accent/20 rounded-xl flex items-center justify-between">
                           <div className="flex items-center gap-3">
                             <div className="w-10 h-10 rounded bg-accent/20 flex items-center justify-center">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-accent"><path d="M8 5v14l11-7z"/></svg>
                             </div>
                             <div>
                               <div className="w-24 h-2 bg-white/90 rounded mb-2"></div>
                               <div className="w-16 h-1.5 bg-white/50 rounded"></div>
                             </div>
                           </div>
                           <div className="w-6 h-6 rounded-full bg-white/10 border border-white/20"></div>
                        </div>
                        <div className="w-full p-4 bg-white/5 border border-white/5 rounded-xl flex items-center justify-between opacity-50">
                           <div className="flex items-center gap-3">
                             <div className="w-10 h-10 rounded bg-white/10"></div>
                             <div>
                               <div className="w-32 h-2 bg-white/60 rounded mb-2"></div>
                               <div className="w-20 h-1.5 bg-white/30 rounded"></div>
                             </div>
                           </div>
                           <div className="w-6 h-6 rounded-full bg-white/10 border border-white/20"></div>
                        </div>
                      </div>
                    )}

                    {idx === 1 && (
                      <div className="w-full flex flex-col gap-6 items-center">
                         <div className="flex gap-4 mb-4">
                           <div className="w-12 h-12 rounded-full border border-white/10 bg-[#111] flex items-center justify-center shadow-lg relative">
                             <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-[#111]" />
                             <span className="text-white/40 text-[10px] font-bold">W1</span>
                           </div>
                           <div className="w-12 h-12 rounded-full border border-accent/50 bg-accent/10 flex items-center justify-center shadow-[0_0_15px_rgba(0,112,243,0.3)] relative">
                             <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-[#111]" />
                             <span className="text-accent text-[10px] font-bold">YOU</span>
                           </div>
                           <div className="w-12 h-12 rounded-full border border-white/10 bg-[#111] flex items-center justify-center shadow-lg relative">
                             <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-[#111]" />
                             <span className="text-white/40 text-[10px] font-bold">A2</span>
                           </div>
                         </div>
                         <div className="w-full max-w-xs">
                           <div className="w-full h-1.5 bg-white/10 rounded-full mb-3 overflow-hidden">
                             <div className="w-[60%] h-full bg-accent relative">
                               <div className="absolute right-0 top-0 w-1 h-full bg-white blur-[1px]"></div>
                             </div>
                           </div>
                           <div className="flex justify-between w-full">
                             <div className="w-8 h-1.5 bg-accent/50 rounded"></div>
                             <div className="w-8 h-1.5 bg-white/20 rounded"></div>
                           </div>
                         </div>
                      </div>
                    )}

                    {idx === 2 && (
                      <div className="w-full h-full border-2 border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center bg-white/[0.01]">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/30 mb-4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                        <div className="h-2 w-24 bg-white/40 rounded mb-2"></div>
                        <div className="h-1 w-16 bg-white/20 rounded"></div>
                        <div className="mt-6 px-4 py-2 bg-white/5 rounded-lg border border-white/5">
                           <div className="flex gap-2 items-center text-[10px] text-white/50 font-mono">
                             <div className="w-2 h-2 rounded-full bg-accent"></div>
                             Audio_Track_Final.flac
                           </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Feature Content */}
                <div className="flex-1 flex flex-col justify-center">
                  <span className="inline-flex items-center gap-3 mb-4">
                    <span className="text-xl font-bold font-mono text-accent">0{idx + 1}</span>
                    <span className="w-12 h-px bg-white/10 block" />
                    <span className="text-xs font-bold text-white/50 tracking-wider uppercase">{section.eyebrow}</span>
                  </span>
                  
                  <h3 className="text-2xl md:text-3xl font-bold text-white leading-tight mb-6">
                    {section.title}
                  </h3>
                  <p className="text-base text-white/60 leading-relaxed mb-8">
                    {section.body}
                  </p>
                  
                  <ul className="flex flex-col gap-4">
                    {section.bullets.map((bullet) => (
                      <li key={bullet} className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-accent/10 border border-accent/20">
                           <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-accent ml-0.5"><path d="M20 6L9 17l-5-5"/></svg>
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

        {/* === FINAL CTA SECTION === */}
        <section className="w-full relative py-20 bg-[#050505] rounded-3xl border border-white/5 mt-10 text-center flex flex-col items-center justify-center overflow-hidden">
            <div className="absolute top-0 w-full h-px bg-gradient-to-r from-transparent via-accent to-transparent opacity-50" />
            <div className="absolute bottom-0 w-full h-px bg-gradient-to-r from-transparent via-accent/20 to-transparent opacity-50" />
            
            <p className="text-xs uppercase font-bold tracking-[0.2em] text-accent mb-6 font-mono">Start Session</p>
            <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-6 tracking-tight">准备好加入共振节点了吗？</h2>
            <p className="text-base text-white/50 mb-10 max-w-sm">准备好你的播放列表，下载应用，和朋友一起进入同一间房，把一次听歌变成一次真正同步的现场。</p>
            
            <Link href={githubReleasesUrl} target="_blank" rel="noreferrer">
              <Button size="lg" className="h-14 px-10 text-lg rounded-xl bg-accent hover:bg-accent-hover text-white transition-all shadow-[0_4px_14px_0_rgba(0,112,243,0.39)] hover:shadow-[0_6px_20px_rgba(0,112,243,0.23)]">
                前往 GitHub Releases
              </Button>
            </Link>
        </section>
      </div>
    </main>
  );
}
