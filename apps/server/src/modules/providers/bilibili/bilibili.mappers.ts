import type { BilibiliTrackCandidate } from "@music-room/shared";
import type { BilibiliFavoriteItem, BilibiliRankingItem, BilibiliSearchItem } from "./bilibili-api.client";
import { cleanBilibiliTitle } from "./bilibili-title-cleaner";

/** 搜索结果条目 → 曲库候选（含分 P 数量智能推断）。 */
export function mapSearchItemToCandidate(item: BilibiliSearchItem): BilibiliTrackCandidate {
  const cleanTitle = (item.title || "").replace(/<[^>]+>/g, "").trim();
  const cleanAuthor = (item.author || "").replace(/<[^>]+>/g, "").trim();
  const durationMs = parseDurationToMs(item.duration);
  const pic = item.pic ? (item.pic.startsWith("//") ? `https:${item.pic}` : item.pic) : null;

  const cleaned = cleanBilibiliTitle(cleanTitle, cleanAuthor);
  const title = cleaned.songTitle || cleanTitle;
  const artist = cleaned.artist || cleanAuthor || "未知UP主";

  // 智能推断分 P 数量
  let inferredPageCount: number | undefined;
  const pMatch = cleanTitle.match(/(?:全|\s)?(\d+)\s*[pP篇首集]/i);
  if (pMatch && pMatch[1]) {
    const parsed = parseInt(pMatch[1], 10);
    if (parsed > 1 && parsed < 1000) inferredPageCount = parsed;
  } else if (durationMs > 600000 || /合集|精选|收录|教学/i.test(cleanTitle)) {
    inferredPageCount = 2;
  }

  return {
    provider: "bilibili",
    providerTrackId: item.bvid,
    bvid: item.bvid,
    title,
    artist,
    album: null,
    durationMs,
    artworkUrl: pic,
    access: "free",
    quality: "exhigh",
    pageCount: inferredPageCount
  };
}

export function mapFavoriteItemToCandidate(item: BilibiliFavoriteItem): BilibiliTrackCandidate {
  const pic = item.cover ? (item.cover.startsWith("//") ? `https:${item.cover}` : item.cover) : null;
  return {
    provider: "bilibili",
    providerTrackId: item.bvid,
    bvid: item.bvid,
    title: item.title,
    artist: item.upper?.name || "未知UP主",
    album: null,
    durationMs: item.duration * 1000,
    artworkUrl: pic,
    access: "free",
    quality: "exhigh"
  };
}

export function mapRankingItemToCandidate(item: BilibiliRankingItem): BilibiliTrackCandidate {
  const pic = item.pic ? (item.pic.startsWith("//") ? `https:${item.pic}` : item.pic) : null;
  return {
    provider: "bilibili",
    providerTrackId: item.bvid,
    bvid: item.bvid,
    title: item.title,
    artist: item.owner?.name || "未知UP主",
    album: null,
    durationMs: item.duration * 1000,
    artworkUrl: pic,
    access: "free",
    quality: "exhigh"
  };
}

function parseDurationToMs(durationStr: string): number {
  if (!durationStr) return 0;
  const parts = durationStr.split(":").map((p) => parseInt(p, 10));
  if (parts.length === 2 && !isNaN(parts[0]!) && !isNaN(parts[1]!)) {
    return (parts[0]! * 60 + parts[1]!) * 1000;
  }
  if (parts.length === 3 && !isNaN(parts[0]!) && !isNaN(parts[1]!) && !isNaN(parts[2]!)) {
    return (parts[0]! * 3600 + parts[1]! * 60 + parts[2]!) * 1000;
  }
  return 0;
}
