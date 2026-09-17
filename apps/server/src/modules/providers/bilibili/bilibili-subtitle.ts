export type BilibiliSubtitleItem = {
  from: number;
  to: number;
  location?: number;
  content: string;
};

export type BilibiliSubtitleBody = {
  body?: BilibiliSubtitleItem[];
};

export type BilibiliSubtitleMeta = {
  id: number;
  lan: string;
  lan_doc: string;
  subtitle_url: string;
};

export function selectBestSubtitle(subtitles: BilibiliSubtitleMeta[]): BilibiliSubtitleMeta | null {
  if (!subtitles || subtitles.length === 0) return null;

  // 优先匹配中文简体 / 官方中文字幕
  const zh = subtitles.find(
    (s) =>
      s.lan === "zh-CN" ||
      s.lan === "zh-Hans" ||
      s.lan === "zh" ||
      s.lan_doc.includes("中")
  );
  if (zh) return zh;

  // 兜底返回第一个字幕
  return subtitles[0] ?? null;
}

export function formatSecondsToLrcTimestamp(secondsFloat: number): string {
  if (isNaN(secondsFloat) || secondsFloat < 0) {
    secondsFloat = 0;
  }
  const totalSeconds = Math.floor(secondsFloat);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  const hundredths = Math.floor((secondsFloat - totalSeconds) * 100);

  const mm = minutes.toString().padStart(2, "0");
  const ss = remainingSeconds.toString().padStart(2, "0");
  const xx = hundredths.toString().padStart(2, "0");

  return `[${mm}:${ss}.${xx}]`;
}

export function convertBilibiliSubtitlesToLrc(items: BilibiliSubtitleItem[]): string {
  if (!Array.isArray(items) || items.length === 0) {
    return "";
  }

  const sorted = [...items].sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
  const lines: string[] = [];

  for (const item of sorted) {
    const text = (item.content ?? "").trim();
    if (!text) continue;
    const timeTag = formatSecondsToLrcTimestamp(item.from ?? 0);
    lines.push(`${timeTag} ${text}`);
  }

  return lines.join("\n");
}
