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
  value.split(/\r?\n/).forEach((rawLine, lineIndex) => {
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
