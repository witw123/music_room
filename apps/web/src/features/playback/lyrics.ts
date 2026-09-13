import type { ProviderLyrics } from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";

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

    if (line.startsWith("{")) {
      try {
        const parsed = JSON.parse(line) as {
          t?: number;
          c?: Array<{ tx?: string; t?: number; d?: number; dur?: number }>;
        };
        if (typeof parsed === "object" && parsed !== null && Array.isArray(parsed.c)) {
          const lineTimeMs = typeof parsed.t === "number" ? parsed.t : 0;
          const timedWords: RoomLyricWord[] = [];
          for (const item of parsed.c) {
            if (typeof item?.tx === "string" && item.tx) {
              const wordTime = typeof item.t === "number" ? item.t : lineTimeMs;
              const wordDur = typeof item.d === "number" ? item.d : (typeof item.dur === "number" ? item.dur : 0);
              timedWords.push({ text: item.tx, timeMs: wordTime, durationMs: wordDur });
            }
          }
          const text = parsed.c.map((item) => item?.tx ?? "").join("").trim();
          if (text) {
            const words = timedWords.some((w) => w.durationMs > 0)
              ? expandTimedWords(timedWords, lineTimeMs)
              : [];
            lines.push({ id: `${lineIndex}:yrc-json`, text, timeMs: lineTimeMs, words });
          }
          return;
        }
      } catch {
        // Not valid JSON
      }
      // Never allow unparsed JSON to leak into plain lyrics display
      return;
    }

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

    if (matchIndex < 0 || (primary.timeMs !== null && bestDistance > 1_500)) {
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

const enhancedLrcWordPattern = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>([^<]*)/g;
const yrcPrefixWordPattern = /\((\d+),(\d+)(?:,\d+)?\)([^()]*)/g;
const qrcSuffixWordPattern = /([^()]+)\((\d+),(\d+)(?:,\d+)?\)/g;

function parseTimedWords(value: string): RoomLyricWord[] {
  if (!value?.trim()) return [];

  // 1. Enhanced LRC: <00:01.20>word<00:01.60>...
  if (value.includes("<")) {
    const matches = [...value.matchAll(enhancedLrcWordPattern)];
    if (matches.length > 0) {
      const words: RoomLyricWord[] = [];
      for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const minutes = Number(match[1]);
        const seconds = Number(match[2]);
        const fraction = match[3] ?? "0";
        const fractionMs = fraction.length === 1
          ? Number(fraction) * 100
          : fraction.length === 2
            ? Number(fraction) * 10
            : Number(fraction.slice(0, 3));
        const startTimeMs = (minutes * 60 + seconds) * 1000 + fractionMs;
        const text = match[4] ?? "";

        let durationMs = 300;
        if (i + 1 < matches.length) {
          const nextMatch = matches[i + 1];
          const nextMin = Number(nextMatch[1]);
          const nextSec = Number(nextMatch[2]);
          const nextFrac = nextMatch[3] ?? "0";
          const nextFracMs = nextFrac.length === 1
            ? Number(nextFrac) * 100
            : nextFrac.length === 2
              ? Number(nextFrac) * 10
              : Number(nextFrac.slice(0, 3));
          const nextTimeMs = (nextMin * 60 + nextSec) * 1000 + nextFracMs;
          durationMs = Math.max(0, nextTimeMs - startTimeMs);
        }
        if (text) {
          words.push({ text, timeMs: startTimeMs, durationMs });
        }
      }
      if (words.length > 0) return words;
    }
  }

  // 2. QRC Suffix: text(start,dur) or text(start,dur,0)
  const trimmed = value.trim();
  if (trimmed && !trimmed.startsWith("(")) {
    const suffixMatches = [...trimmed.matchAll(qrcSuffixWordPattern)];
    if (suffixMatches.length > 0) {
      return suffixMatches
        .map((match) => ({
          text: match[1],
          timeMs: Number(match[2]),
          durationMs: Number(match[3])
        }))
        .filter((w) => Number.isFinite(w.timeMs) && Number.isFinite(w.durationMs) && w.text.length > 0);
    }
  }

  // 3. YRC Prefix: (start,dur)text or (start,dur,0)text
  const prefixMatches = [...value.matchAll(yrcPrefixWordPattern)];
  if (prefixMatches.length > 0) {
    return prefixMatches
      .map((match) => ({
        timeMs: Number(match[1]),
        durationMs: Number(match[2]),
        text: match[3] ?? ""
      }))
      .filter((w) => Number.isFinite(w.timeMs) && Number.isFinite(w.durationMs) && w.text.length > 0);
  }

  return [];
}

const segmentPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\s]+(?:\s+)?|\s+/gu;

function splitLyricSegments(value: string): string[] {
  if (!value) return [];
  const matches = value.match(segmentPattern);
  if (!matches || matches.length === 0) {
    return [...lyricCharacterSegmenter.segment(value)].map((s) => s.segment);
  }
  return matches;
}

function expandTimedWords(words: RoomLyricWord[], lineTimeMs: number) {
  if (words.length === 0) return [];

  // Determine whether this line's words are relative offsets or absolute timestamps.
  // In QRC, relative offsets start from 0 (or close to 0) while lineTimeMs is positive.
  // In YRC / absolute timing, words have timestamps close to lineTimeMs (even with anticipatory singing).
  const firstWordTime = words[0]?.timeMs ?? 0;
  const isRelative = lineTimeMs > 0 && (
    firstWordTime === 0 ||
    (firstWordTime < lineTimeMs && (lineTimeMs - firstWordTime > 1500 || firstWordTime < lineTimeMs * 0.5))
  );

  return words.flatMap((word) => {
    const segments = splitLyricSegments(word.text);
    if (segments.length === 0) return [];

    const timeMs = isRelative ? lineTimeMs + word.timeMs : word.timeMs;
    const durationMs = Math.max(0, word.durationMs);
    if (segments.length === 1) {
      return [{ text: segments[0], timeMs, durationMs }];
    }
    return segments.map((text, index) => ({
      text,
      timeMs: timeMs + (durationMs * index) / segments.length,
      durationMs: durationMs / segments.length
    }));
  });
}

export function getRoomLyricDisplayWords(lines: RoomLyricLine[], lineIndex: number): RoomLyricWord[] {
  const line = lines[lineIndex];
  if (!line || line.words.length === 0) return [];
  return line.words;
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

const providerLyricsCache = new Map<string, Promise<ProviderLyrics>>();

export function fetchProviderLyricsCached(
  provider: "netease" | "qqmusic",
  trackId: string
): Promise<ProviderLyrics> {
  const cacheKey = `${provider}:${trackId}`;
  const cached = providerLyricsCache.get(cacheKey);
  if (cached) return cached;
  const promise = (
    provider === "netease"
      ? musicRoomApi.getNeteaseLyrics(trackId)
      : musicRoomApi.getQqMusicLyrics(trackId)
  ).catch((error) => {
    providerLyricsCache.delete(cacheKey);
    throw error;
  });
  providerLyricsCache.set(cacheKey, promise);
  return promise;
}

export function clearProviderLyricsCache() {
  providerLyricsCache.clear();
}


