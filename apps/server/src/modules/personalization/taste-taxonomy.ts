export type TasteTagSource = {
  title: string | null;
  album: string | null;
  playlistMetadata?: readonly string[];
  providerTags?: readonly string[];
  score: number;
  confidence: number;
};

export type RankedTasteTag = {
  label: string;
  confidence: number;
};

type TasteRule = { label: string; pattern: RegExp };

const tasteRules: TasteRule[] = [
  { label: "流行", pattern: /(?:\bpop\b|流行)/iu },
  { label: "R&B", pattern: /(?:r\s*&\s*b|rnb|rhythm\s*and\s*blues|\bsoul\b)/iu },
  { label: "说唱", pattern: /(?:\brap\b|hip[\s-]?hop|嘻哈|说唱)/iu },
  { label: "摇滚", pattern: /(?:\brock\b|朋克|金属|\bmetal\b|\bindie\b)/iu },
  { label: "民谣", pattern: /(?:\bfolk\b|民谣|\bacoustic\b|不插电)/iu },
  { label: "电子", pattern: /(?:\belectronic\b|\bedm\b|\bhouse\b|\btechno\b|\btrance\b|\bdubstep\b|电音|电子)/iu },
  { label: "爵士", pattern: /(?:\bjazz\b|\bblues\b|爵士|蓝调)/iu },
  { label: "古典", pattern: /(?:\bclassical\b|古典|交响|协奏|奏鸣)/iu },
  { label: "独立音乐", pattern: /(?:\balternative\b|\bindependent\b|独立音乐)/iu },
  { label: "轻音乐", pattern: /(?:\bambient\b|\bchill(?:out)?\b|lo[\s-]?fi|轻音乐|纯音乐|氛围音乐)/iu },
  { label: "疗愈", pattern: /(?:\bhealing\b|疗愈|治愈|冥想|\bmeditation\b)/iu },
  { label: "舞曲", pattern: /(?:\bdance\b|\bdisco\b|舞曲)/iu },
  { label: "影视原声", pattern: /(?:\bost\b|original\s+soundtrack|\bsoundtrack\b|原声|主题曲|片尾曲)/iu },
  { label: "现场", pattern: /(?:\blive\b|现场)/iu },
  { label: "K-pop", pattern: /(?:k[\s-]?pop|韩国流行)/iu },
  { label: "J-pop", pattern: /(?:j[\s-]?pop|日本流行)/iu },
  { label: "粤语", pattern: /(?:cantonese|粤语|粤语歌)/iu },
  { label: "夜听", pattern: /(?:\bnight\b|\bmidnight\b|深夜|夜晚|晚安|失眠)/iu },
  { label: "通勤", pattern: /(?:\bcommute\b|\bdriv(?:e|ing)\b|公路|开车|通勤)/iu },
  { label: "学习", pattern: /(?:\bstudy\b|\bfocus\b|学习|专注|工作)/iu },
  { label: "运动", pattern: /(?:\bworkout\b|\bgym\b|\brunning?\b|跑步|运动|健身)/iu }
];

export function rankTasteTags(sources: readonly TasteTagSource[], limit = 20): RankedTasteTag[] {
  const scores = new Map<string, { score: number; confidence: number }>();
  for (const source of sources) {
    if (source.score === 0) continue;
    for (const label of extractTasteLabels(source)) {
      const current = scores.get(label) ?? { score: 0, confidence: 0 };
      scores.set(label, {
        score: current.score + source.score,
        confidence: current.confidence + Math.max(0, source.confidence)
      });
    }
  }

  return [...scores.entries()]
    .filter(([, value]) => value.score > 0)
    .sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0], "zh-CN"))
    .slice(0, limit)
    .map(([label, value]) => ({
      label,
      confidence: Math.min(1, Math.max(0, value.confidence / 4))
    }));
}

export function extractTasteLabels(source: Omit<TasteTagSource, "score" | "confidence">) {
  const text = [source.title, source.album, ...(source.playlistMetadata ?? []), ...(source.providerTags ?? [])]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
  if (!text) return [];

  const labels = new Set(tasteRules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.label));
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) labels.add("日语");
  else if (/\p{Script=Hangul}/u.test(text)) labels.add("韩语");
  else if (/\p{Script=Han}/u.test(text)) labels.add("华语");
  return [...labels];
}
