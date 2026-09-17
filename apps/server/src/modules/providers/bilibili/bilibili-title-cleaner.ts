const NOISE_TAGS = [
  "4k", "8k", "60帧", "60fps", "1080p", "720p", "超清", "高清", "无损", "高音质", "音质",
  "完整版", "完整", "官方", "mv", "official", "live", "现场", "现场版", "翻唱", "cover",
  "动态歌词", "附歌词", "双语字幕", "中文字幕", "中字", "熟肉", "生肉", "纯享", "纯享版",
  "杜比", "全景声", "hi-res", "flac", "remix", "重低音", "伴奏", "自制", "搬运", "压制",
  "首发", "新歌", "单曲", "精选", "歌词版", "万人大合唱", "合唱", "剪辑", "混剪", "循环",
  "cd", "无杂音", "修复"
];

// 括号类模式匹配
const BRACKET_PATTERN = /【([^】]+)】|\[([^\]]+)\]|\(([^)]+)\)|（([^）]+)）/g;

export type CleanedTitleInfo = {
  songTitle: string;
  artist: string;
  fullQuery: string;
};

export function cleanBilibiliTitle(rawTitle: string, uploaderName = ""): CleanedTitleInfo {
  let title = (rawTitle || "").trim();

  // 1. 去除 HTML 标签 (如 <em class="keyword">...</em>)
  title = title.replace(/<[^>]+>/g, "");

  // 2. 检查是否有书名号 《...》
  const bookMatch = title.match(/《([^》]+)》/);
  let bookTitle: string | null = null;
  if (bookMatch && bookMatch[1]?.trim()) {
    bookTitle = bookMatch[1].trim();
  }

  // 3. 去除括号中的噪词标签，如果整个括号内容都是噪音则直接剔除
  title = title.replace(BRACKET_PATTERN, (match, p1, p2, p3, p4) => {
    const inside = (p1 || p2 || p3 || p4 || "").trim().toLowerCase();
    const isNoise = NOISE_TAGS.some((noise) => inside.includes(noise));
    return isNoise ? " " : match;
  });

  // 4. 逐个剔除裸露在外的噪声词 (独立单词或前后有空格/标点)
  for (const noise of NOISE_TAGS) {
    const regex = new RegExp(`\\b${noise}\\b`, "gi");
    title = title.replace(regex, " ");
  }

  // 特殊中文噪词清除
  const cnNoise = /(?:4K|60帧|1080P|超清|无损|现场版|完整版|纯享版|动态歌词|歌词版|官方MV|伴奏|重低音|万人大合唱)/gi;
  title = title.replace(cnNoise, " ");

  // 5. 规范化空白字符与多余符号
  title = title
    .replace(/[【】\[\]()（）]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 6. 如果识别出了书名号中的歌名
  if (bookTitle) {
    // 从 title 中移除书名号歌名，剩下的很可能是歌手名
    let remainder = title.replace(bookTitle, " ").replace(/[《》]/g, " ").replace(/\s+/g, " ").trim();
    // 剔除分隔符
    remainder = remainder.replace(/^[-—/|:]+|[-—/|:]+$/g, "").trim();

    const artist = remainder || uploaderName || "";
    return {
      songTitle: bookTitle,
      artist,
      fullQuery: artist ? `${artist} ${bookTitle}` : bookTitle
    };
  }

  // 7. 检查是否有常见的分隔符："歌手 - 歌名" 或 "歌名 - 歌手"
  const separatorMatch = title.match(/^(.+?)\s*[-—/|]\s*(.+)$/);
  if (separatorMatch) {
    const part1 = separatorMatch[1]!.trim();
    const part2 = separatorMatch[2]!.trim();

    // 通常 part1 是歌手，part2 是歌名；或者 part1 是歌名，part2 是歌手
    return {
      songTitle: part2,
      artist: part1,
      fullQuery: `${part1} ${part2}`
    };
  }

  // 8. 兜底：直接使用过滤后的 title
  const finalTitle = title || rawTitle.trim();
  const artist = uploaderName.replace(/官方|Official|工作室|Channel/gi, "").trim();

  return {
    songTitle: finalTitle,
    artist,
    fullQuery: artist && !finalTitle.includes(artist) ? `${artist} ${finalTitle}` : finalTitle
  };
}
