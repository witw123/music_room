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

export function parseRoomLyrics(value: string | null | undefined): RoomLyricLine[] {
  if (!value?.trim()) return [];

  const lines: RoomLyricLine[] = [];
  normalizeLyricsSource(value).split(/\r?\n/).forEach((rawLine, lineIndex) => {
    const line = rawLine.trim();
    if (!line || metadataPattern.test(line)) return;

    const yrcLine = line.match(yrcLinePattern);
    if (yrcLine) {
      const words = parseTimedWords(yrcLine[3] ?? "");
      const text = words.map((word) => word.text).join("").trim();
      if (text) lines.push({ id: `${lineIndex}:yrc`, text, timeMs: Number(yrcLine[1]), words });
      return;
    }

    const timestamps = [...line.matchAll(timestampPattern)];
    const content = line.replace(timestampPattern, "").trim();
    const words = parseTimedWords(content);
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

export function hasWordSyncedRoomLyrics(value: string | null | undefined) {
  return parseRoomLyrics(value).some((line) => line.words.length > 0);
}

export function selectRoomLyrics(input: {
  localLyrics?: string | null;
  wordSyncedLyric?: string | null;
  plainLyric?: string | null;
}) {
  const localLyrics = input.localLyrics?.trim() || null;
  if (hasWordSyncedRoomLyrics(localLyrics)) {
    return localLyrics;
  }

  const wordSyncedLyric = input.wordSyncedLyric?.trim() || null;
  if (hasWordSyncedRoomLyrics(wordSyncedLyric)) {
    return wordSyncedLyric;
  }

  return localLyrics || wordSyncedLyric || input.plainLyric?.trim() || null;
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
