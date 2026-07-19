export type RoomLyricLine = {
  id: string;
  text: string;
  timeMs: number | null;
};

const timestampPattern = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const metadataPattern = /^\[(?:ar|al|ti|by|offset|re|ve):/i;

export function parseRoomLyrics(value: string | null | undefined): RoomLyricLine[] {
  if (!value?.trim()) return [];

  const lines: RoomLyricLine[] = [];
  value.split(/\r?\n/).forEach((rawLine, lineIndex) => {
    const line = rawLine.trim();
    if (!line || metadataPattern.test(line)) return;

    const timestamps = [...line.matchAll(timestampPattern)];
    const text = line.replace(timestampPattern, "").trim();
    if (!text) return;

    if (timestamps.length === 0) {
      lines.push({ id: `${lineIndex}:plain`, text, timeMs: null });
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
        timeMs: (minutes * 60 + seconds) * 1000 + fractionMs
      });
    }
  });

  return lines.sort((left, right) => {
    if (left.timeMs === null) return 1;
    if (right.timeMs === null) return -1;
    return left.timeMs - right.timeMs;
  });
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
