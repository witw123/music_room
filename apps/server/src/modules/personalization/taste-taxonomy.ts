import type { PersonalizationTasteGroup, PersonalizationTasteGroupId, PersonalizationTasteTagSource, TasteEntityKind } from "@music-room/shared";

export type TasteEvidence = {
  dimension: Extract<TasteEntityKind, "genre" | "language" | "region" | "scene" | "era">;
  label: string;
  source: PersonalizationTasteTagSource;
  confidence: number;
};

export type TasteEvidenceInput = {
  title: string | null;
  artist?: string | null;
  album: string | null;
  releaseTime?: string | null;
  playlistMetadata?: readonly string[];
  providerTags?: readonly string[];
};

export type TasteEntityForGroup = {
  entityKind: string;
  entityKey: string;
  title: string | null;
  positiveScore: number;
  negativeScore: number;
  confidence: number;
  updatedAt: Date;
  lastOccurredAt: Date | null;
};

type TasteRule = {
  dimension: TasteEvidence["dimension"];
  label: string;
  pattern: RegExp;
};

// 标签与 Web 端「调整偏好」分类目录（components/discovery/taste-taxonomy.ts）一一对应：
// 相同的 label 既是用户可勾选的分类，也是召回时的 provider 搜索词。
// 命中顺序无关紧要（所有规则都会尝试），但模式写法要避免近义规则互相误伤
// （摇滚不吞金属/朋克、爵士不吞蓝调、轻音乐不吞 Lo-Fi）。
const tasteRules: TasteRule[] = [
  { dimension: "genre", label: "流行", pattern: /(?:\bpop\b|流行|主打|金曲)/iu },
  { dimension: "genre", label: "R&B", pattern: /(?:r\s*&\s*b|rnb|rhythm\s*and\s*blues|\bsoul\b|灵魂乐)/iu },
  { dimension: "genre", label: "说唱", pattern: /(?:\brap\b|hip[\s-]?hop|嘻哈|说唱|trap)/iu },
  { dimension: "genre", label: "摇滚", pattern: /(?:\brock\b|摇滚|乐队)/iu },
  { dimension: "genre", label: "金属", pattern: /(?:\bmetal\b|金属|金属核|死亡金属|黑金属|哥特金属)/iu },
  { dimension: "genre", label: "朋克", pattern: /(?:\bpunk\b|朋克|硬核)/iu },
  { dimension: "genre", label: "民谣", pattern: /(?:\bfolk\b|民谣|\bacoustic\b|不插电|木吉他)/iu },
  { dimension: "genre", label: "电子", pattern: /(?:\belectronic\b|\bedm\b|\bhouse\b|\btechno\b|\btrance\b|\bdubstep\b|电音|电子|synth)/iu },
  { dimension: "genre", label: "爵士", pattern: /(?:\bjazz\b|爵士|scat)/iu },
  { dimension: "genre", label: "蓝调", pattern: /(?:\bblues\b|蓝调|布鲁斯)/iu },
  { dimension: "genre", label: "古典", pattern: /(?:\bclassical\b|古典|交响|协奏|奏鸣|钢琴曲)/iu },
  { dimension: "genre", label: "轻音乐", pattern: /(?:\bambient\b|\bchill(?:out)?\b|轻音乐|纯音乐|氛围音乐|白噪音|轻音乐)/iu },
  { dimension: "genre", label: "Lo-Fi", pattern: /(?:lo[\s-]?fi|chillhop)/iu },
  { dimension: "genre", label: "后摇", pattern: /(?:post[\s-]?rock|后摇滚|后摇)/iu },
  { dimension: "genre", label: "独立", pattern: /(?:\bindie\b|\balternative\b|独立音乐|独立流行|独立乐队)/iu },
  { dimension: "genre", label: "ACG", pattern: /(?:acg|anime|二次元|动漫|动画|vocaloid|游戏原声)/iu },
  { dimension: "genre", label: "国风", pattern: /(?:国风|古风|仙侠|戏腔|新中式|武侠)/iu },
  { dimension: "genre", label: "City Pop", pattern: /(?:city[\s-]?pop|城市流行)/iu },
  { dimension: "genre", label: "蒸汽波", pattern: /(?:vaporwave|蒸汽波|future\s*funk)/iu },
  { dimension: "genre", label: "K-Pop", pattern: /(?:k[\s-]?pop|韩国流行|韩流)/iu },
  { dimension: "genre", label: "J-Pop", pattern: /(?:j[\s-]?pop|日本流行|日系摇滚)/iu },
  { dimension: "genre", label: "雷鬼", pattern: /(?:\breggae\b|雷鬼|雷盖)/iu },
  { dimension: "genre", label: "乡村", pattern: /(?:\bcountry\b|乡村音乐|美式乡村)/iu },
  { dimension: "genre", label: "拉丁", pattern: /(?:\blatin\b|拉丁|\breggaeton\b|雷鬼顿|桑巴|波萨诺瓦|bossa)/iu },
  { dimension: "genre", label: "舞曲", pattern: /(?:\bdance\b|\bdisco\b|舞曲|迪斯科)/iu },
  { dimension: "genre", label: "原声", pattern: /(?:\bost\b|original\s+soundtrack|\bsoundtrack\b|原声|主题曲|片尾曲|插曲|配乐)/iu },
  { dimension: "language", label: "粤语", pattern: /(?:cantonese|粤语|港乐)/iu },
  { dimension: "language", label: "英语", pattern: /(?:english|英文|英语)/iu },
  { dimension: "language", label: "日语", pattern: /(?:japanese|日语|日文)/iu },
  { dimension: "language", label: "韩语", pattern: /(?:korean|韩语|韩文)/iu },
  { dimension: "language", label: "华语", pattern: /(?:mandarin|国语|华语|中文|国语流行)/iu },
  { dimension: "region", label: "欧美", pattern: /(?:欧美|western|\bamerica\b|us\s*pop|uk\s*pop)/iu },
  { dimension: "region", label: "日本", pattern: /(?:日本|\bjapan\b)/iu },
  { dimension: "region", label: "韩国", pattern: /(?:韩国|\bkorea\b)/iu },
  { dimension: "region", label: "港台", pattern: /(?:港台|香港|台湾|hong\s*kong|taiwan)/iu },
  { dimension: "region", label: "东南亚", pattern: /(?:东南亚|泰国|越南|新加坡|马来|印尼)/iu },
  { dimension: "region", label: "欧洲", pattern: /(?:欧洲|欧陆|法国|chanson|德国|西班牙|意大利|italo)/iu },
  { dimension: "scene", label: "夜听", pattern: /(?:\bnight\b|\bmidnight\b|夜听|深夜|夜晚|晚安|失眠|睡前)/iu },
  { dimension: "scene", label: "专注", pattern: /(?:\bstudy\b|\bfocus\b|学习|专注|工作|自习|coding)/iu },
  { dimension: "scene", label: "运动", pattern: /(?:\bworkout\b|\bgym\b|\brunning?\b|跑步|运动|健身|燃脂)/iu },
  { dimension: "scene", label: "驾车", pattern: /(?:\bdriv(?:e|ing)\b|公路|开车|通勤|旅途|road\s*trip)/iu },
  { dimension: "scene", label: "咖啡", pattern: /(?:coffee|café|cafe|咖啡馆|咖啡厅|拿铁|latte)/iu },
  { dimension: "scene", label: "派对", pattern: /(?:\bparty\b|\bclub\b|派对|聚会|狂欢|嗨歌)/iu },
  { dimension: "scene", label: "冥想", pattern: /(?:\brelax\b|\bcalm\b|疗愈|治愈|冥想|\bmeditation\b|放空)/iu },
  { dimension: "scene", label: "雨天", pattern: /(?:\brain(?:y|ing)?\b|雨天|下雨|雨声)/iu },
  { dimension: "scene", label: "清晨", pattern: /(?:\bmorning\b|清晨|早安|日出|唤醒)/iu },
  { dimension: "scene", label: "周末", pattern: /(?:\bweekend\b|周末|假日|假期)/iu },
  { dimension: "scene", label: "春日", pattern: /(?:\bspring\b|春天|春日|踏青)/iu },
  { dimension: "scene", label: "夏日", pattern: /(?:\bsummer\b|夏天|夏日|海边)/iu },
  { dimension: "scene", label: "秋日", pattern: /(?:\bautumn\b|\bfall\b|秋天|秋日|落叶)/iu },
  { dimension: "scene", label: "冬夜", pattern: /(?:\bwinter\b|冬天|冬日|冬夜|围炉)/iu }
];

const artistTasteMap: ReadonlyArray<{ pattern: RegExp; labels: ReadonlyArray<{ label: string; dimension: TasteEvidence["dimension"] }> }> = [
  { pattern: /(?:the\s+weeknd|frank\s+ocean|sza|bruno\s+mars|方大同|陶喆)/iu, labels: [{ dimension: "genre", label: "R&B" }, { dimension: "genre", label: "流行" }] },
  { pattern: /(?:linkin\s+park|coldplay|beyond|五月天|草东没有派对|万能青年旅店|oasis|nirvana)/iu, labels: [{ dimension: "genre", label: "摇滚" }] },
  { pattern: /(?:avicii|calvin\s+harris|alan\s+walker|zedd|marshmello|kygo)/iu, labels: [{ dimension: "genre", label: "电子" }] },
  { pattern: /(?:宇多田ヒカル|米津玄師|米津玄师|yoasobi|aimer|radwimps|zutomayo|泽野弘之|ado\b)/iu, labels: [{ dimension: "genre", label: "J-Pop" }, { dimension: "genre", label: "ACG" }, { dimension: "language", label: "日语" }] },
  { pattern: /(?:bts|blackpink|newjeans|aespa|ive\b|stray\s*kids)/iu, labels: [{ dimension: "genre", label: "K-Pop" }, { dimension: "language", label: "韩语" }] },
  { pattern: /(?:周杰伦|林俊杰|王力宏|孙燕姿|薛之谦|邓紫棋|汪苏泷)/iu, labels: [{ dimension: "genre", label: "流行" }, { dimension: "language", label: "华语" }] },
  { pattern: /(?:陈奕迅|eason\s*chan|张学友|张国荣|容祖儿|杨千嬅)/iu, labels: [{ dimension: "genre", label: "流行" }, { dimension: "language", label: "粤语" }] },
  { pattern: /(?:taylor\s*swift|billie\s*eilish|ariana\s*grande|dua\s*lipa|ed\s*sheeran)/iu, labels: [{ dimension: "genre", label: "流行" }, { dimension: "language", label: "英语" }, { dimension: "region", label: "欧美" }] },
  { pattern: /(?:metallica|megadeth|rammstein|iron\s*maiden)/iu, labels: [{ dimension: "genre", label: "金属" }] },
  { pattern: /(?:norah\s*jones|louis\s*armstrong|miles\s*davis|john\s*coltrane)/iu, labels: [{ dimension: "genre", label: "爵士" }] },
  { pattern: /(?:告五人|deca\s*joins|落日飞车|sunset\s*rollercoat|康士坦的变化球)/iu, labels: [{ dimension: "genre", label: "独立" }] }
];

const groupDefinitions: ReadonlyArray<{ id: PersonalizationTasteGroupId; label: string; dimensions: readonly string[] }> = [
  { id: "genre", label: "曲风", dimensions: ["genre"] },
  { id: "language-region", label: "语种与地区", dimensions: ["language", "region"] },
  { id: "scene", label: "聆听场景", dimensions: ["scene"] },
  { id: "era", label: "年代", dimensions: ["era"] },
  { id: "behavior", label: "听歌习惯", dimensions: ["behavior"] }
];

export function extractTasteEvidence(input: TasteEvidenceInput): TasteEvidence[] {
  const evidence = [
    ...matchText(input.providerTags ?? [], "provider-tags", 1),
    ...matchText([input.album], "album-text", 0.8),
    ...matchText(input.playlistMetadata ?? [], "playlist-text", 0.8),
    ...matchArtist(input.artist),
    ...matchText([input.title], "track-text", 0.45),
    ...detectScriptLanguage([input.title, input.album].filter((value): value is string => Boolean(value?.trim()))),
    ...detectEra(input.releaseTime)
  ];
  return dedupeEvidence(evidence);
}

/**
 * 从收听行为本身推断场景画像：深夜时段 → 夜听，周末 → 周末。
 * occurredAt 是 UTC 时刻，timezoneOffsetMinutes 是客户端上报的
 * `Date#getTimezoneOffset()` 值（UTC − 本地，分钟），用它还原本地时钟。
 */
export function inferBehavioralSceneEvidence(occurredAt: Date, timezoneOffsetMinutes = 0): TasteEvidence[] {
  const local = new Date(occurredAt.getTime() - timezoneOffsetMinutes * 60_000);
  const hour = local.getUTCHours();
  const weekday = local.getUTCDay();
  const evidence: TasteEvidence[] = [];
  if (hour >= 23 || hour < 5) {
    evidence.push({ dimension: "scene", label: "夜听", source: "derived-behavior", confidence: 0.55 });
  }
  if (weekday === 0 || weekday === 6) {
    evidence.push({ dimension: "scene", label: "周末", source: "derived-behavior", confidence: 0.45 });
  }
  return evidence;
}

export function buildTasteGroups(input: {
  entities: readonly TasteEntityForGroup[];
  behavior: readonly PersonalizationTasteGroup["tags"][number][];
  score: (entity: TasteEntityForGroup) => number;
}): PersonalizationTasteGroup[] {
  return groupDefinitions.map((group) => ({
    id: group.id,
    label: group.label,
    tags: group.id === "behavior"
      ? input.behavior.slice(0, 4)
      : rankEntities(input.entities.filter((entity) => group.dimensions.includes(entity.entityKind)), input.score)
  }));
}

function matchText(values: readonly (string | null | undefined)[], source: TasteEvidence["source"], confidence: number) {
  const text = values.filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" ");
  if (!text) return [];
  return tasteRules.filter((rule) => rule.pattern.test(text)).map((rule) => ({ dimension: rule.dimension, label: rule.label, source, confidence }));
}

function matchArtist(artist: string | null | undefined) {
  if (!artist?.trim()) return [];
  return artistTasteMap.flatMap((rule) => rule.pattern.test(artist)
    ? rule.labels.map((label) => ({ ...label, source: "artist-map" as const, confidence: 0.65 }))
    : []);
}

function detectScriptLanguage(values: readonly string[]) {
  const text = values.join(" ");
  if (!text) return [];
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) return [{ dimension: "language" as const, label: "日语", source: "track-text" as const, confidence: 0.9 }];
  if (/\p{Script=Hangul}/u.test(text)) return [{ dimension: "language" as const, label: "韩语", source: "track-text" as const, confidence: 0.9 }];
  if (/\p{Script=Han}/u.test(text)) return [{ dimension: "language" as const, label: "华语", source: "track-text" as const, confidence: 0.9 }];
  // 纯拉丁字母标题（无任何 CJK 文字）计为英语低置信证据，补齐英文歌的语言画像。
  if (/(?:[a-z]{4,}\s+){1,}[a-z]{3,}/iu.test(text)) return [{ dimension: "language" as const, label: "英语", source: "track-text" as const, confidence: 0.55 }];
  return [];
}

function detectEra(releaseTime: string | null | undefined) {
  const match = releaseTime?.match(/(?:19|20)\d{2}/u);
  if (!match) return [];
  const year = Number(match[0]);
  if (year < 1950 || year > new Date().getUTCFullYear() + 1) return [];
  if (year >= new Date().getUTCFullYear() - 4) {
    return [{ dimension: "era" as const, label: "新歌", source: "provider-tags" as const, confidence: 0.9 }];
  }
  if (year < 1980) {
    return [{ dimension: "era" as const, label: "经典老歌", source: "provider-tags" as const, confidence: 0.9 }];
  }
  const label = `${String(Math.floor(year / 10) * 10).slice(-2)}年代`;
  return [{ dimension: "era" as const, label, source: "provider-tags" as const, confidence: 0.9 }];
}

function dedupeEvidence(evidence: readonly TasteEvidence[]) {
  const selected = new Map<string, TasteEvidence>();
  for (const item of evidence) {
    const key = `${item.dimension}:${item.label}`;
    const existing = selected.get(key);
    if (!existing || item.confidence > existing.confidence) selected.set(key, item);
  }
  return [...selected.values()];
}

function rankEntities(entities: readonly TasteEntityForGroup[], scoreEntity: (entity: TasteEntityForGroup) => number) {
  const ranked = entities
    .map((entity) => ({ entity, score: scoreEntity(entity) }))
    .filter(({ entity, score }) => score > 0 && entity.confidence >= 0.45 && entity.title)
    .sort((left, right) => right.score - left.score || right.entity.confidence - left.entity.confidence || String(left.entity.title).localeCompare(String(right.entity.title), "zh-CN"));
  const byLabel = new Map<string, typeof ranked[number]>();
  for (const item of ranked) {
    const key = item.entity.title!.normalize("NFKD").toLocaleLowerCase();
    if (!byLabel.has(key)) byLabel.set(key, item);
  }
  return [...byLabel.values()]
    .slice(0, 6)
    .map(({ entity, score }) => ({
      label: entity.title!,
      score: Number(score.toFixed(3)),
      confidence: Math.min(1, Math.max(0, entity.confidence)),
      source: sourceFromEntityKey(entity.entityKey),
      updatedAt: entity.updatedAt.toISOString()
    }));
}

function sourceFromEntityKey(key: string): PersonalizationTasteTagSource {
  const candidate = key.split(":", 1)[0];
  return candidate === "provider-tags" || candidate === "album-text" || candidate === "playlist-text" || candidate === "artist-map" || candidate === "track-text" || candidate === "derived-behavior"
    ? candidate
    : "track-text";
}
