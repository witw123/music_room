import type { PersonalizationTasteGroup, PersonalizationTasteGroupId, PersonalizationTasteTagSource, TasteEntityKind } from "@music-room/shared";

export type TasteEvidence = {
  dimension: Extract<TasteEntityKind, "genre" | "language" | "region" | "scene" | "era">;
  label: string;
  source: Exclude<PersonalizationTasteTagSource, "derived-behavior">;
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

const tasteRules: TasteRule[] = [
  { dimension: "genre", label: "流行", pattern: /(?:\bpop\b|流行)/iu },
  { dimension: "genre", label: "R&B", pattern: /(?:r\s*&\s*b|rnb|rhythm\s*and\s*blues|\bsoul\b)/iu },
  { dimension: "genre", label: "说唱", pattern: /(?:\brap\b|hip[\s-]?hop|嘻哈|说唱)/iu },
  { dimension: "genre", label: "摇滚", pattern: /(?:\brock\b|朋克|金属|\bmetal\b)/iu },
  { dimension: "genre", label: "民谣", pattern: /(?:\bfolk\b|民谣|\bacoustic\b|不插电)/iu },
  { dimension: "genre", label: "电子", pattern: /(?:\belectronic\b|\bedm\b|\bhouse\b|\btechno\b|\btrance\b|\bdubstep\b|电音|电子)/iu },
  { dimension: "genre", label: "爵士", pattern: /(?:\bjazz\b|\bblues\b|爵士|蓝调)/iu },
  { dimension: "genre", label: "古典", pattern: /(?:\bclassical\b|古典|交响|协奏|奏鸣)/iu },
  { dimension: "genre", label: "独立音乐", pattern: /(?:\balternative\b|\bindie\b|独立音乐)/iu },
  { dimension: "genre", label: "轻音乐", pattern: /(?:\bambient\b|\bchill(?:out)?\b|lo[\s-]?fi|轻音乐|纯音乐|氛围音乐)/iu },
  { dimension: "genre", label: "舞曲", pattern: /(?:\bdance\b|\bdisco\b|舞曲)/iu },
  { dimension: "genre", label: "影视原声", pattern: /(?:\bost\b|original\s+soundtrack|\bsoundtrack\b|原声|主题曲|片尾曲)/iu },
  { dimension: "genre", label: "K-pop", pattern: /(?:k[\s-]?pop|韩国流行)/iu },
  { dimension: "genre", label: "J-pop", pattern: /(?:j[\s-]?pop|日本流行)/iu },
  { dimension: "language", label: "粤语", pattern: /(?:cantonese|粤语|粤语歌)/iu },
  { dimension: "language", label: "英语", pattern: /(?:english|英文|英语)/iu },
  { dimension: "language", label: "日语", pattern: /(?:japanese|日语|日文)/iu },
  { dimension: "language", label: "韩语", pattern: /(?:korean|韩语|韩文)/iu },
  { dimension: "language", label: "华语", pattern: /(?:mandarin|国语|华语|中文)/iu },
  { dimension: "region", label: "欧美", pattern: /(?:欧美|western|\beurope\b|\bamerica\b)/iu },
  { dimension: "region", label: "日本", pattern: /(?:日本|\bjapan\b)/iu },
  { dimension: "region", label: "韩国", pattern: /(?:韩国|\bkorea\b)/iu },
  { dimension: "region", label: "华语地区", pattern: /(?:华语|港台|台湾|香港|大陆|内地)/iu },
  { dimension: "scene", label: "夜听", pattern: /(?:\bnight\b|\bmidnight\b|夜听|深夜|夜晚|晚安|失眠)/iu },
  { dimension: "scene", label: "通勤", pattern: /(?:\bcommute\b|\bdriv(?:e|ing)\b|公路|开车|通勤)/iu },
  { dimension: "scene", label: "学习", pattern: /(?:\bstudy\b|\bfocus\b|学习|专注|工作)/iu },
  { dimension: "scene", label: "运动", pattern: /(?:\bworkout\b|\bgym\b|\brunning?\b|跑步|运动|健身)/iu },
  { dimension: "scene", label: "放松", pattern: /(?:\brelax\b|\bcalm\b|疗愈|治愈|冥想|\bmeditation\b)/iu },
  { dimension: "scene", label: "现场氛围", pattern: /(?:\blive\b|现场)/iu }
];

const artistTasteMap: ReadonlyArray<{ pattern: RegExp; labels: ReadonlyArray<{ label: string; dimension: TasteEvidence["dimension"] }> }> = [
  { pattern: /(?:the\s+weeknd|frank\s+ocean|sza|bruno\s+mars)/iu, labels: [{ dimension: "genre", label: "R&B" }] },
  { pattern: /(?:linkin\s+park|coldplay|beyond|五月天)/iu, labels: [{ dimension: "genre", label: "摇滚" }] },
  { pattern: /(?:avicii|calvin\s+harris|alan\s+walker|zedd)/iu, labels: [{ dimension: "genre", label: "电子" }] },
  { pattern: /(?:宇多田ヒカル|米津玄師|yoasobi)/iu, labels: [{ dimension: "genre", label: "J-pop" }, { dimension: "language", label: "日语" }] },
  { pattern: /(?:bts|blackpink|iu\b|newjeans)/iu, labels: [{ dimension: "genre", label: "K-pop" }, { dimension: "language", label: "韩语" }] }
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
  return [];
}

function detectEra(releaseTime: string | null | undefined) {
  const match = releaseTime?.match(/(?:19|20)\d{2}/u);
  if (!match) return [];
  const year = Number(match[0]);
  if (year < 1950 || year > new Date().getUTCFullYear() + 1) return [];
  const label = year < 2000 ? "经典老歌" : `${Math.floor(year / 10) * 10}年代`;
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
    .slice(0, 4)
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
  return candidate === "provider-tags" || candidate === "album-text" || candidate === "playlist-text" || candidate === "artist-map" || candidate === "track-text"
    ? candidate
    : "track-text";
}
