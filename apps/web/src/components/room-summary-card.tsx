const queueFeatures = [
  "共享播放队列",
  "成员点歌入队",
  "房主管理排序与切换",
  "本地上传资源"
];

export function RoomSummaryCard() {
  return (
    <section className="grid gap-4 rounded-3xl bg-ink p-8 text-sand shadow-[0_20px_80px_rgba(17,17,17,0.18)] md:grid-cols-[1.4fr_1fr]">
      <div className="space-y-4">
        <p className="text-sm uppercase tracking-[0.25em] text-sand/65">
          核心体验
        </p>
        <h2 className="text-3xl font-semibold">
          一间房内完成建房、同播、点歌和协作歌单。
        </h2>
      </div>
      <ul className="grid gap-3 text-sm text-sand/80">
        {queueFeatures.map((feature) => (
          <li
            key={feature}
            className="rounded-2xl border border-sand/15 px-4 py-3"
          >
            {feature}
          </li>
        ))}
      </ul>
    </section>
  );
}
