import Link from "next/link";
import type { Route } from "next";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";

const featureSections = [
  {
    eyebrow: "房间系统",
    title: "每个房间都围绕共享队列展开",
    body:
      "创建公开或私密房间、复制房间码、恢复最近房间。所有成员都围绕同一套播放序列协作，当前播放与下一首始终清晰可见。",
    bullets: ["创建和加入流程短", "最近房间可恢复", "房间页直接进入工作台"]
  },
  {
    eyebrow: "实时同步",
    title: "状态、进度和氛围保持同步",
    body:
      "当房间开始播放，成员看到的是同一首歌、同一条进度线和同一套控制反馈。协作重点放在队列和正在播放。",
    bullets: ["共享播放控制", "进度同步反馈", "房间状态实时刷新"]
  },
  {
    eyebrow: "音乐管理",
    title: "上传音乐，沉淀你的歌单",
    body:
      "本地音频导入、快速入队、从房间创建歌单、再把歌单重新加载回房间，让协作听歌成为连续工作流。",
    bullets: ["本地音频导入", "歌单保存与回放", "添加者与来源信息可追踪"]
  }
];

export function FeaturesPage() {
  return (
    <main className="min-h-screen bg-[#000000] relative flex flex-col font-sans selection:bg-accent/30 selection:text-white pb-32">
      <TopBar />

      <div className="flex-1 flex flex-col px-6 max-w-5xl mx-auto w-full pt-32 animate-fade-in relative z-10">
        
        <section className="flex flex-col text-center mb-20 w-full items-center">
          <div className="inline-flex items-center justify-center px-4 py-1.5 rounded-full bg-accent/10 border border-accent/20 mb-8 backdrop-blur-sm">
            <span className="text-xs font-bold tracking-widest text-accent font-mono z-10">Product Features</span>
          </div>

          <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight mb-6 max-w-3xl">
             重点并非功能堆砌<br/>而是每一步都顺畅自然
          </h1>
          <p className="text-base text-white/50 max-w-2xl leading-relaxed mb-10">
            解释四件事：怎么进房、怎么同步、怎么加歌，以及为什么工作台比普通播放器更适合协作。
          </p>
          <div className="flex items-center gap-4">
            <Link href={"/auth?redirectTo=/rooms" as Route}>
               <Button size="lg" className="rounded-full bg-accent hover:bg-accent-hover text-white px-8 h-12">
                 开始使用
               </Button>
            </Link>
            <Link href={"/" as Route}>
               <Button variant="outline" size="lg" className="rounded-full bg-transparent border border-white/10 text-white hover:bg-white/5 px-8 h-12">
                 返回主页
               </Button>
            </Link>
          </div>
        </section>

        <section className="flex flex-col gap-8 w-full">
          {featureSections.map((section, idx) => (
            <article key={section.title} className="flex flex-col md:flex-row gap-6 items-start bg-transparent p-8 md:p-12 rounded-2xl border border-white/5">
              <div className="md:w-1/3 flex shrink-0 flex-col">
                <span className="text-xs font-bold text-accent tracking-wider mb-2">0{idx + 1} {section.eyebrow}</span>
                <h2 className="text-2xl font-bold text-white/90 leading-tight">{section.title}</h2>
              </div>
              
              <div className="flex-1 flex flex-col gap-4 w-full">
                <p className="text-sm text-white/50 leading-relaxed">{section.body}</p>
                <div className="flex flex-wrap gap-2 pt-2">
                  {section.bullets.map((bullet) => (
                    <span key={bullet} className="px-3 py-1 bg-surface border border-white/5 rounded-full text-xs font-medium text-white/70">
                      {bullet}
                    </span>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </section>

        <section className="w-full mt-32 text-center flex flex-col items-center">
            <h2 className="text-3xl font-bold text-white mb-4">准备好了吗？</h2>
            <p className="text-sm text-white/50 mb-8 max-w-sm">创建新房间、加入房间、恢复最近房间，并直接进入协作模式。</p>
            
            <Link href={"/auth?redirectTo=/rooms" as Route}>
              <Button size="lg" className="h-12 px-10 text-base rounded-full bg-accent hover:bg-accent-hover text-white">
                进入登录 / 注册
              </Button>
            </Link>
        </section>
      </div>
    </main>
  );
}
