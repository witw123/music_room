import { Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import type { BilibiliSearchResponse, BilibiliTrackCandidate, BilibiliVideoDetail, ProviderLyrics } from "@music-room/shared";
import { NeteaseApiClient } from "../netease/netease-api.client";
import { QqMusicApiClient } from "../qqmusic/qqmusic-api.client";
import { BilibiliApiClient, sortBilibiliAudioUrls, type BilibiliFavoriteItem, type BilibiliRankingItem, type BilibiliSearchItem } from "./bilibili-api.client";
import { selectBestSubtitle, convertBilibiliSubtitlesToLrc } from "./bilibili-subtitle";
import { cleanBilibiliTitle } from "./bilibili-title-cleaner";

export function extractBilibiliMediaId(input: string): string {
  const trimmed = input.trim();
  const mlMatch = trimmed.match(/ml(\d+)/i);
  if (mlMatch && mlMatch[1]) return mlMatch[1];

  const fidMatch = trimmed.match(/fid=(\d+)/i);
  if (fidMatch && fidMatch[1]) return fidMatch[1];

  const numMatch = trimmed.match(/^\d+$/);
  if (numMatch) return numMatch[0];

  return trimmed;
}

@Injectable()
export class BilibiliService {
  private readonly logger = new Logger(BilibiliService.name);

  constructor(
    private readonly client: BilibiliApiClient,
    @Optional() private readonly neteaseApiClient?: NeteaseApiClient,
    @Optional() private readonly qqmusicApiClient?: QqMusicApiClient
  ) {}

  async getVideoDetail(bvid: string): Promise<BilibiliVideoDetail> {
    const data = await this.client.getVideoView(bvid);
    return {
      bvid: data.bvid,
      title: data.title,
      pic: data.pic ? (data.pic.startsWith("//") ? `https:${data.pic}` : data.pic) : null,
      ownerName: data.owner?.name ?? "未知UP主",
      ownerFace: data.owner?.face ? (data.owner.face.startsWith("//") ? `https:${data.owner.face}` : data.owner.face) : null,
      duration: data.duration,
      pages: (data.pages ?? []).map((page) => ({
        cid: page.cid,
        page: page.page,
        part: page.part,
        duration: page.duration
      }))
    };
  }

  async resolveTrack(bvid: string, cid?: number): Promise<BilibiliTrackCandidate> {
    const detail = await this.getVideoDetail(bvid);
    const targetPage = cid
      ? detail.pages.find((p) => p.cid === cid) ?? detail.pages[0]
      : detail.pages[0];

    if (!targetPage) {
      throw new NotFoundException(`Bilibili 视频分P未找到: ${bvid}`);
    }

    const title = detail.pages.length > 1
      ? `${detail.title} (${targetPage.part})`
      : detail.title;

    const providerTrackId = `${bvid}:${targetPage.cid}`;

    return {
      provider: "bilibili",
      providerTrackId,
      bvid,
      cid: targetPage.cid,
      title,
      artist: detail.ownerName,
      album: null,
      durationMs: targetPage.duration * 1000,
      artworkUrl: detail.pic,
      access: "free",
      quality: "exhigh"
    };
  }

  async resolveAudio(
    bvid: string,
    cid?: number,
    _quality?: "standard" | "high" | "exhigh"
  ): Promise<{
    url: string;
    urls: string[];
    mimeType: string;
    fileType: string;
    bvid: string;
    cid: number;
  }> {
    const resolvedCid = cid ?? (await this.resolveFirstCid(bvid));
    const playData = await this.client.getPlayUrl(bvid, resolvedCid);

    const audioStreams = playData.dash?.audio ?? [];
    if (audioStreams.length > 0) {
      // 按照 bandwidth 降序排序，取最高音质
      const bestAudio = [...audioStreams].sort((a, b) => b.bandwidth - a.bandwidth)[0]!;
      // 对 CDN 备选节点进行打分优选与去重排序
      const candidateUrls = sortBilibiliAudioUrls(bestAudio.baseUrl, bestAudio.backupUrl);
      const primaryUrl = candidateUrls[0] || bestAudio.baseUrl || "";
      if (!primaryUrl) {
        throw new NotFoundException(`未能解析到 B 站音频流直链: ${bvid}`);
      }
      return {
        url: primaryUrl,
        urls: candidateUrls.length > 0 ? candidateUrls : [primaryUrl],
        mimeType: "audio/mp4",
        fileType: "m4a",
        bvid,
        cid: resolvedCid
      };
    }

    // Fallback: durl 流
    const durl = playData.durl?.[0]?.url;
    if (durl) {
      return {
        url: durl,
        urls: [durl],
        mimeType: "video/mp4",
        fileType: "mp4",
        bvid,
        cid: resolvedCid
      };
    }

    throw new NotFoundException(`Bilibili 视频无可用播放流: ${bvid}`);
  }

  async openAudioStream(
    bvid: string,
    cid?: number,
    quality?: "standard" | "high" | "exhigh",
    range?: string
  ) {
    const resolved = await this.resolveAudio(bvid, cid, quality);
    return this.client.fetchAudioStream(resolved.urls, range);
  }

  async getLyrics(bvid: string, cid?: number): Promise<ProviderLyrics> {
    const resolvedCid = cid ?? (await this.resolveFirstCid(bvid));
    const providerTrackId = `${bvid}:${resolvedCid}`;

    // 1. 尝试提取 B 站原生 CC 字幕转 LRC
    try {
      const subtitles = await this.client.getVideoSubtitles(bvid, resolvedCid);
      const bestSubtitle = selectBestSubtitle(subtitles);
      if (bestSubtitle) {
        const items = await this.client.fetchSubtitleContent(bestSubtitle.subtitle_url);
        const lrc = convertBilibiliSubtitlesToLrc(items);
        if (lrc.trim().length > 0) {
          return {
            provider: "bilibili",
            providerTrackId,
            plainLyric: lrc,
            wordSyncedLyric: null,
            translatedLyric: null,
            romanizedLyric: null
          };
        }
      }
    } catch (err) {
      this.logger.warn(`Bilibili native subtitle lookup failed for ${providerTrackId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 2. 标题降噪与跨平台（网易云 / QQ音乐）静默匹配
    try {
      const videoDetail = await this.getVideoDetail(bvid);
      const targetPage = videoDetail.pages.find((p) => p.cid === resolvedCid) ?? videoDetail.pages[0];
      const pageTitle = (targetPage && videoDetail.pages.length > 1 && targetPage.part) ? targetPage.part : videoDetail.title;
      const cleaned = cleanBilibiliTitle(pageTitle, videoDetail.ownerName);

      const matchedLyrics = await this.matchCrossPlatformLyrics(cleaned.fullQuery, targetPage?.duration ?? videoDetail.duration);
      if (matchedLyrics) {
        return {
          provider: "bilibili",
          providerTrackId,
          plainLyric: matchedLyrics.plainLyric,
          wordSyncedLyric: matchedLyrics.wordSyncedLyric,
          translatedLyric: matchedLyrics.translatedLyric,
          romanizedLyric: matchedLyrics.romanizedLyric
        };
      }
    } catch (err) {
      this.logger.warn(`Cross-platform lyric fallback failed for ${providerTrackId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      provider: "bilibili",
      providerTrackId,
      plainLyric: null,
      wordSyncedLyric: null,
      translatedLyric: null,
      romanizedLyric: null
    };
  }

  async search(keyword: string, page = 1, pageSize = 20, tid?: number): Promise<BilibiliSearchResponse> {
    const { items } = await this.client.searchVideo(keyword, page, pageSize, tid);
    const candidates = items.map((item) => this.mapSearchItemToCandidate(item));
    return {
      items: candidates,
      limit: pageSize,
      offset: (page - 1) * pageSize
    };
  }

  async importFavorite(
    urlOrId: string,
    page = 1,
    pageSize = 30
  ): Promise<{
    title: string;
    items: BilibiliTrackCandidate[];
    total: number;
    hasMore: boolean;
  }> {
    const mediaId = extractBilibiliMediaId(urlOrId);
    if (!mediaId) {
      throw new NotFoundException("未提取到有效的 B 站收藏夹 ID");
    }

    const res = await this.client.getFavoriteResources(mediaId, page, pageSize);
    const validItems = (res.items || [])
      .filter((item) => item.bvid && item.title !== "已失效视频" && item.attr === 0)
      .map((item) => this.mapFavoriteItemToCandidate(item));

    return {
      title: res.title || "B 站导入歌单",
      items: validItems,
      total: res.total,
      hasMore: res.hasMore
    };
  }

  async getRanking(subType = "3"): Promise<BilibiliTrackCandidate[]> {
    const list = await this.client.getMusicRanking(subType);
    return (list || []).map((item) => this.mapRankingItemToCandidate(item));
  }

  private async resolveFirstCid(bvid: string): Promise<number> {
    const detail = await this.getVideoDetail(bvid);
    const firstCid = detail.pages[0]?.cid;
    if (!firstCid) {
      throw new NotFoundException(`Bilibili 视频不存在有效分P: ${bvid}`);
    }
    return firstCid;
  }

  private async matchCrossPlatformLyrics(
    query: string,
    durationSeconds?: number
  ): Promise<{
    plainLyric: string | null;
    wordSyncedLyric: string | null;
    translatedLyric: string | null;
    romanizedLyric: string | null;
  } | null> {
    const durationMs = durationSeconds ? durationSeconds * 1000 : 0;

    // 优先尝试网易云音乐
    if (this.neteaseApiClient) {
      try {
        const searchResult = await this.neteaseApiClient.searchTracks({
          keywords: query,
          limit: 5,
          offset: 0,
          cookie: ""
        });
        const songs = (searchResult.result as { songs?: Array<{ id: number; dt: number; name: string }> })?.songs ?? [];
        if (songs.length > 0) {
          const matchedSong = (durationMs > 0
            ? songs.find((s) => Math.abs(s.dt - durationMs) <= 8000)
            : null) ?? songs[0]!;

          const lyricsData = await this.neteaseApiClient.getLyrics({
            trackId: String(matchedSong.id),
            cookie: ""
          });

          const plain = (lyricsData?.lrc as { lyric?: string })?.lyric?.trim() || null;
          const wordSynced = (lyricsData?.yrc as { lyric?: string })?.lyric?.trim() || null;
          const trans = (lyricsData?.tlyric as { lyric?: string })?.lyric?.trim() || null;
          const roma = (lyricsData?.romalrc as { lyric?: string })?.lyric?.trim() || null;

          if (plain || wordSynced) {
            return {
              plainLyric: plain,
              wordSyncedLyric: wordSynced,
              translatedLyric: trans,
              romanizedLyric: roma
            };
          }
        }
      } catch (err) {
        this.logger.debug(`Netease lyric match error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 兜底尝试 QQ 音乐
    if (this.qqmusicApiClient) {
      try {
        const searchRecords = await this.qqmusicApiClient.searchTracks({
          keywords: query,
          limit: 5,
          offset: 0,
          cookie: "",
          kind: "song"
        });
        const list = searchRecords as Array<{ songmid?: string; mid?: string; interval?: number }>;
        if (list.length > 0) {
          const matched = (durationMs > 0
            ? list.find((s) => Math.abs((s.interval ?? 0) * 1000 - durationMs) <= 8000)
            : null) ?? list[0]!;

          const songMid = matched.songmid || matched.mid;
          if (songMid) {
            const lyricsBody = await this.qqmusicApiClient.getLyrics({
              trackId: songMid,
              cookie: ""
            });
            const plain = lyricsBody.lyric?.trim() || null;
            const trans = lyricsBody.trans?.trim() || null;
            const roma = lyricsBody.roma?.trim() || null;
            if (plain) {
              return {
                plainLyric: plain,
                wordSyncedLyric: null,
                translatedLyric: trans,
                romanizedLyric: roma
              };
            }
          }
        }
      } catch (err) {
        this.logger.debug(`QQ music lyric match error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return null;
  }

  private mapSearchItemToCandidate(item: BilibiliSearchItem): BilibiliTrackCandidate {
    const cleanTitle = (item.title || "").replace(/<[^>]+>/g, "").trim();
    const cleanAuthor = (item.author || "").replace(/<[^>]+>/g, "").trim();
    const durationMs = this.parseDurationToMs(item.duration);
    const pic = item.pic ? (item.pic.startsWith("//") ? `https:${item.pic}` : item.pic) : null;

    return {
      provider: "bilibili",
      providerTrackId: item.bvid,
      bvid: item.bvid,
      title: cleanTitle,
      artist: cleanAuthor || "未知UP主",
      album: null,
      durationMs,
      artworkUrl: pic,
      access: "free",
      quality: "exhigh"
    };
  }

  private mapFavoriteItemToCandidate(item: BilibiliFavoriteItem): BilibiliTrackCandidate {
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

  private mapRankingItemToCandidate(item: BilibiliRankingItem): BilibiliTrackCandidate {
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

  private parseDurationToMs(durationStr: string): number {
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
}
