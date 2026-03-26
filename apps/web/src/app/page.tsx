import { RoomSummaryCard } from "@/components/room-summary-card";
import { ArchitectureHighlights } from "@/components/architecture-highlights";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-sand text-ink">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-6 py-16">
        <div className="max-w-3xl space-y-6">
          <p className="text-sm uppercase tracking-[0.35em] text-pine">
            Music Room
          </p>
          <h1 className="text-5xl font-semibold leading-tight">
            面向多人同播的音乐房骨架，服务端只做连接与状态，媒体分发交给客户端。
          </h1>
          <p className="max-w-2xl text-lg text-ink/75">
            当前仓库已经按房间、播放器、歌单和 P2P 传输拆分模块，可直接进入接口定义与业务实现。
          </p>
        </div>
        <RoomSummaryCard />
        <ArchitectureHighlights />
      </section>
    </main>
  );
}

