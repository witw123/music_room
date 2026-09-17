const NOISE_TAGS = [
  "4k", "8k", "60帧", "60fps", "1080p", "720p", "超清", "高清", "无损", "高音质", "音质",
  "完整版", "完整", "官方", "mv", "official", "live", "现场", "现场版", "翻唱", "cover", "翻唱版",
  "动态歌词", "附歌词", "双语字幕", "中文字幕", "中字", "熟肉", "生肉", "纯享", "纯享版",
  "杜比", "全景声", "hi-res", "hires", "hifi", "flac", "remix", "重低音", "超重低音", "伴奏",
  "instrumental", "inst", "自制", "搬运", "压制", "首发", "新歌", "单曲", "精选", "歌词版",
  "万人大合唱", "合唱", "剪辑", "混剪", "循环", "单曲循环", "cd", "无杂音", "修复",
  "后台播放", "华语流行音乐", "车载音乐", "车载", "自用收藏", "自用", "黑胶", "沉浸式",
  "耳机福利", "福利", "神级", "收藏级", "立体声", "环绕声", "双声道", "空间音频", "最叼", "才是最叼的", "付费"
];

// 括号类模式匹配
const BRACKET_PATTERN = /【([^】]+)】|\[([^\]]+)\]|\(([^)]+)\)|（([^）]+)）/g;

// 常见序号前缀（如 01., 001., P1, P01-, 1、, 01 等）
const TRACK_INDEX_REGEX = /^(?:(?:P|p)?\d{1,4}|[0-9]{1,4}|[一二三四五六七八九十]{1,3})[\s._\-、:：/|]+/g;

// 中文噪词集中过滤正则
const CN_NOISE_REGEX = /(?:4K|8K|60帧|60FPS|1080P|720P|超清|高清|无损|高音质|音质|HIFI|Hi-Res|hires|黑胶|立体声|环绕声|双声道|空间音频|超重低音|重低音|母带|杜比|全景声|修复|无杂音|CD|完整版|完整|官方|Official|MV|Live|现场版|现场|纯享版|纯享|精选|歌词版|动态歌词|附歌词|新歌|首发|伴奏|instrumental|inst|翻唱版|翻唱|Cover|Remix|万人大合唱|合唱|剪辑|混剪|单曲循环|循环|后台播放|华语流行音乐|车载音乐|车载|自用收藏|自用|自制|搬运|压制|沉浸式|耳机福利|福利|神级|收藏级|最叼|才是最叼的|付费|双语字幕|中文字幕|中字|熟肉|生肉)/gi;

export type CleanedTitleInfo = {
  songTitle: string;
  artist: string;
  fullQuery: string;
};

function stripTrackIndex(text: string): string {
  let result = text.trim();
  let prev = "";
  while (result !== prev) {
    prev = result;
    result = result.replace(TRACK_INDEX_REGEX, "").trim();
  }
  return result;
}

function stripNoiseTags(text: string): string {
  let result = text;

  // 1. 去除括号中的噪词标签，如果整个括号内容含噪词则直接剔除
  result = result.replace(BRACKET_PATTERN, (match, p1, p2, p3, p4) => {
    const inside = (p1 || p2 || p3 || p4 || "").trim().toLowerCase();
    const isNoise = NOISE_TAGS.some((noise) => inside.includes(noise));
    return isNoise ? " " : match;
  });

  // 2. 独立单词匹配
  for (const noise of NOISE_TAGS) {
    const regex = new RegExp(`\\b${noise}\\b`, "gi");
    result = result.replace(regex, " ");
  }

  // 3. 中文无边界噪词匹配
  result = result.replace(CN_NOISE_REGEX, " ");

  // 4. 去除多余括号及空白
  result = result
    .replace(/[【】()[\]（）]/g, " ")
    .replace(/[/|\\:：_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return result;
}

export function cleanBilibiliTitle(rawTitle: string, rawUploaderName = ""): CleanedTitleInfo {
  let title = (rawTitle || "").trim();

  // 1. 去除 HTML 标签 (如 <em class="keyword">...</em>)
  title = title.replace(/<[^>]+>/g, "");

  // 2. 清洗 UP 主 / 歌手名称（去除编号前缀、官方标签等）
  let uploader = (rawUploaderName || "").trim();
  uploader = stripTrackIndex(uploader);
  uploader = uploader
    .replace(/官方|Official|工作室|Channel|频道/gi, "")
    .trim();

  // 3. 剥离标题开头的音轨序号（例如 "01 晴天", "001.周杰伦"）
  title = stripTrackIndex(title);

  // 4. 检查是否有书名号 《...》
  const bookMatch = title.match(/《([^》]+)》/);
  let bookTitle: string | null = null;
  if (bookMatch && bookMatch[1]?.trim()) {
    bookTitle = bookMatch[1].trim();
  }

  // 5. 噪词清洗
  title = stripNoiseTags(title);
  title = stripTrackIndex(title);

  // 6. 如果识别出了书名号中的歌名
  if (bookTitle) {
    const cleanedBookTitle = stripTrackIndex(stripNoiseTags(bookTitle));
    let remainder = title.replace(bookTitle, " ").replace(/[《》]/g, " ");
    remainder = stripNoiseTags(remainder);
    remainder = stripTrackIndex(remainder);
    remainder = remainder.replace(/^[-—/|:：]+|[-—/|:：]+$/g, "").trim();

    const artist = remainder || uploader || "";
    const effectiveSongTitle = cleanedBookTitle || bookTitle;
    return {
      songTitle: effectiveSongTitle,
      artist,
      fullQuery: artist ? `${artist} ${effectiveSongTitle}` : effectiveSongTitle
    };
  }

  // 7. 检查常见分隔符："歌手 - 歌名" 或 "歌名 - 歌手"
  const separatorMatch = title.match(/^(.+?)\s*[-—|]\s*(.+)$/);
  if (separatorMatch) {
    let part1 = stripTrackIndex(stripNoiseTags(separatorMatch[1]!));
    let part2 = stripTrackIndex(stripNoiseTags(separatorMatch[2]!));

    if (uploader && part2.toLowerCase().includes(uploader.toLowerCase())) {
      // part2 是歌手，part1 是歌名
      return {
        songTitle: part1,
        artist: part2,
        fullQuery: `${part2} ${part1}`
      };
    }

    // 通常 part1 是歌手，part2 是歌名
    return {
      songTitle: part2,
      artist: part1,
      fullQuery: `${part1} ${part2}`
    };
  }

  // 8. 兜底逻辑
  let finalTitle = stripTrackIndex(title);
  finalTitle = finalTitle.replace(/^[-—/|:：]+|[-—/|:：]+$/g, "").trim();
  if (!finalTitle) {
    finalTitle = rawTitle.replace(/<[^>]+>/g, "").trim();
  }

  const artist = uploader;
  return {
    songTitle: finalTitle,
    artist,
    fullQuery: artist && !finalTitle.includes(artist) ? `${artist} ${finalTitle}` : finalTitle
  };
}
