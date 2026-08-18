export type RoomLyricLine = {
  id: string;
  text: string;
  timeMs: number | null;
  words: RoomLyricWord[];
};

export type RoomLyricWord = {
  text: string;
  timeMs: number;
  durationMs: number;
};

const timestampPattern = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const metadataPattern = /^\[(?:ar|al|ti|by|offset|re|ve):/i;
const yrcLinePattern = /^\[(\d+),(\d+)\](.*)$/;
const wordPattern = /\((\d+),(\d+)(?:,\d+)?\)([^()]*)/g;
const lyricCharacterSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function parseRoomLyrics(value: string | null | undefined): RoomLyricLine[] {
  if (!value?.trim()) return [];

  const lines: RoomLyricLine[] = [];
  normalizeLyricsSource(value).split(/\r?\n/).forEach((rawLine, lineIndex) => {
    const line = rawLine.trim();
    if (!line || metadataPattern.test(line)) return;

    const yrcLine = line.match(yrcLinePattern);
    if (yrcLine) {
      const lineTimeMs = Number(yrcLine[1]);
      const words = expandTimedWords(parseTimedWords(yrcLine[3] ?? ""), lineTimeMs);
      const text = words.map((word) => word.text).join("").trim();
      if (text) lines.push({ id: `${lineIndex}:yrc`, text, timeMs: lineTimeMs, words });
      return;
    }

    const timestamps = [...line.matchAll(timestampPattern)];
    const content = line.replace(timestampPattern, "").trim();
    const parsedWords = parseTimedWords(content);
    const words = expandTimedWords(parsedWords, parsedWords[0]?.timeMs ?? 0);
    const text = (words.length > 0 ? words.map((word) => word.text).join("") : content).trim();
    if (!text) return;

    if (timestamps.length === 0) {
      lines.push({ id: `${lineIndex}:plain`, text, timeMs: words[0]?.timeMs ?? null, words });
      return;
    }

    for (const [timestampIndex, match] of timestamps.entries()) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = match[3] ?? "0";
      const fractionMs = fraction.length === 1
        ? Number(fraction) * 100
        : fraction.length === 2
          ? Number(fraction) * 10
          : Number(fraction.slice(0, 3));
      lines.push({
        id: `${lineIndex}:${timestampIndex}`,
        text,
        timeMs: (minutes * 60 + seconds) * 1000 + fractionMs,
        words
      });
    }
  });

  return lines.sort((left, right) => {
    if (left.timeMs === null) return 1;
    if (right.timeMs === null) return -1;
    return left.timeMs - right.timeMs;
  });
}

/** Match translated or romanized lines to primary lyrics by timestamp. */
export function alignRoomLyricLines(
  primaryLines: readonly RoomLyricLine[],
  auxiliaryLines: readonly RoomLyricLine[]
) {
  const used = new Set<number>();
  return primaryLines.map((primary) => {
    let matchIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < auxiliaryLines.length; index += 1) {
      if (used.has(index)) continue;
      const auxiliary = auxiliaryLines[index];
      if (!auxiliary) continue;
      if (primary.timeMs === null || auxiliary.timeMs === null) {
        if (primary.timeMs === null && auxiliary.timeMs === null && matchIndex < 0) {
          matchIndex = index;
        }
        continue;
      }
      const distance = Math.abs(primary.timeMs - auxiliary.timeMs);
      if (distance < bestDistance) {
        bestDistance = distance;
        matchIndex = index;
      }
    }

    if (matchIndex < 0 || (primary.timeMs !== null && bestDistance > 250)) {
      return null;
    }
    used.add(matchIndex);
    return auxiliaryLines[matchIndex] ?? null;
  });
}

export function hasWordSyncedRoomLyrics(value: string | null | undefined) {
  return parseRoomLyrics(value).some((line) => line.words.length > 0);
}

export function selectRoomLyrics(input: {
  localLyrics?: string | null;
  wordSyncedLyric?: string | null;
  plainLyric?: string | null;
}) {
  const localLyrics = normalizeRoomLyricsText(input.localLyrics);
  if (hasWordSyncedRoomLyrics(localLyrics)) {
    return localLyrics;
  }

  const wordSyncedLyric = normalizeRoomLyricsText(input.wordSyncedLyric);
  if (hasWordSyncedRoomLyrics(wordSyncedLyric)) {
    return wordSyncedLyric;
  }

  return wordSyncedLyric || normalizeRoomLyricsText(input.plainLyric) || localLyrics;
}

function normalizeRoomLyricsText(value: string | null | undefined) {
  const normalized = value?.trim() || null;
  if (!normalized || normalized === "0") return null;
  const compact = normalized.replace(/\s+/g, "");
  if (compact.length >= 64 && compact.length % 2 === 0 && /^[a-f0-9]+$/i.test(compact)) return null;
  return normalized;
}

function normalizeLyricsSource(value: string) {
  const lyricContent = value.match(/\bLyricContent=(["'])([\s\S]*?)\1/i)?.[2];
  return decodeXmlEntities(lyricContent ?? value).replace(/\\n/g, "\n");
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&#(x?[0-9a-f]+);/gi, (_match, code: string) => {
      const radix = code.toLowerCase().startsWith("x") ? 16 : 10;
      const parsed = Number.parseInt(radix === 16 ? code.slice(1) : code, radix);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : "";
    })
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function parseTimedWords(value: string): RoomLyricWord[] {
  return [...value.matchAll(wordPattern)]
    .map((match) => ({
      timeMs: Number(match[1]),
      durationMs: Number(match[2]),
      text: match[3] ?? ""
    }))
    .filter((word) => Number.isFinite(word.timeMs) && Number.isFinite(word.durationMs) && word.text.length > 0);
}

function expandTimedWords(words: RoomLyricWord[], lineTimeMs: number) {
  return words.flatMap((word) => {
    const characters = splitLyricCharacters(word.text);
    if (characters.length === 0) return [];
    const timeMs = word.timeMs < lineTimeMs ? lineTimeMs + word.timeMs : word.timeMs;
    const durationMs = Math.max(0, word.durationMs);
    return characters.map((text, index) => ({
      text,
      timeMs: timeMs + durationMs * index / characters.length,
      durationMs: durationMs / characters.length
    }));
  });
}

export function getRoomLyricDisplayWords(lines: RoomLyricLine[], lineIndex: number) {
  const line = lines[lineIndex];
  if (!line) return [];
  if (line.words.length > 0) return line.words;
  if (line.timeMs === null) return [];

  const characters = splitLyricCharacters(line.text);
  if (characters.length === 0) return [];
  const nextLine = lines.slice(lineIndex + 1).find((candidate) =>
    candidate.timeMs !== null && candidate.timeMs > line.timeMs!
  );
  const durationMs = nextLine?.timeMs !== null && nextLine?.timeMs !== undefined
    ? nextLine.timeMs - line.timeMs
    : Math.max(1_500, Math.min(8_000, characters.length * 280));

  return characters.map((text, index) => ({
    text,
    timeMs: line.timeMs! + durationMs * index / characters.length,
    durationMs: durationMs / characters.length
  }));
}

function splitLyricCharacters(value: string) {
  return [...lyricCharacterSegmenter.segment(value)].map((segment) => segment.segment);
}

export function getActiveRoomLyricWordIndex(line: RoomLyricLine | undefined, positionMs: number) {
  if (!line) return -1;
  let activeIndex = -1;
  for (let index = 0; index < line.words.length; index += 1) {
    if ((line.words[index]?.timeMs ?? Number.POSITIVE_INFINITY) <= positionMs) activeIndex = index;
  }
  return activeIndex;
}

export function getRoomLyricWordProgress(word: RoomLyricWord, positionMs: number) {
  if (positionMs <= word.timeMs) return 0;
  if (word.durationMs <= 0 || positionMs >= word.timeMs + word.durationMs) return 1;
  return (positionMs - word.timeMs) / word.durationMs;
}

export function getActiveRoomLyricIndex(lines: RoomLyricLine[], positionMs: number) {
  let activeIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const timeMs = lines[index]?.timeMs;
    if (timeMs !== null && timeMs !== undefined && timeMs <= positionMs) {
      activeIndex = index;
    }
  }
  return activeIndex;
}

