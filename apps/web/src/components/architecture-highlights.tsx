const items = [
  ["房间层", "只处理房间生命周期、成员列表与权限。"],
  ["播放器层", "执行播放控制、同步校准和缓冲策略。"],
  ["歌单层", "负责个人歌单、协作歌单与房间队列互转。"],
  ["媒体层", "维护 WebRTC 媒体连接、RTP 音频轨道和实时诊断。"]
];

export function ArchitectureHighlights() {
  return (
    <section className="grid gap-4 md:grid-cols-2">
      {items.map(([title, description]) => (
        <article
          key={title}
          className="rounded-3xl border border-ink/10 bg-white/70 p-6 backdrop-blur"
        >
          <h3 className="text-xl font-semibold">{title}</h3>
          <p className="mt-3 text-sm leading-6 text-ink/75">{description}</p>
        </article>
      ))}
    </section>
  );
}
