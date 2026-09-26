import { Injectable, Logger, Optional } from "@nestjs/common";
import { NeteaseApiClient } from "../netease/netease-api.client";
import { QqMusicApiClient } from "../qqmusic/qqmusic-api.client";

export type CrossPlatformLyrics = {
  plainLyric: string | null;
  wordSyncedLyric: string | null;
  translatedLyric: string | null;
  romanizedLyric: string | null;
};

export type LyricCandidateSong = {
  provider: "netease" | "qqmusic";
  trackId: string;
  name: string;
  artistName?: string;
  durationMs: number;
};

/**
 * B 站视频标题 → 专业音乐平台歌词的跨平台匹配引擎。
 *
 * 各平台版权目录不同（如周杰伦原版已从网易云下架、正版只在 QQ 音乐），
 * 因此两平台并发搜索、合并候选、全局打分，避免“网易云只剩翻唱也照单全收”。
 */
@Injectable()
export class CrossPlatformLyricMatcher {
  private readonly logger = new Logger(CrossPlatformLyricMatcher.name);

  constructor(
    @Optional() private readonly neteaseApiClient?: NeteaseApiClient,
    @Optional() private readonly qqmusicApiClient?: QqMusicApiClient
  ) {}

  async match(
    query: string,
    durationSeconds?: number,
    targetSongTitle?: string,
    targetArtist?: string
  ): Promise<CrossPlatformLyrics | null> {
    const durationMs = durationSeconds ? durationSeconds * 1000 : 0;

    const searchUnified = async (keywords: string): Promise<LyricCandidateSong[]> => {
      const [neteaseCandidates, qqCandidates] = await Promise.all([
        this.searchNeteaseLyricCandidates(keywords),
        this.searchQqLyricCandidates(keywords)
      ]);
      return [
        ...neteaseCandidates.map((song) => ({ ...song, provider: "netease" as const })),
        ...qqCandidates.map((song) => ({ ...song, provider: "qqmusic" as const }))
      ];
    };

    const rankUnified = (candidates: LyricCandidateSong[]) =>
      candidates
        .map((song) => ({
          song,
          score: this.scoreLyricMatchOrientation(
            song.name,
            song.artistName,
            song.durationMs,
            targetSongTitle,
            targetArtist,
            durationMs
          )
        }))
        .sort((a, b) => b.score - a.score);

    try {
      let ranked = rankUnified(await searchUnified(query));
      let best = ranked[0];

      // 首查结果不自信（B站标题常带宣传语，污染搜索词；精确歌名+时长也可能命中
      // 同名假封面）时，改用清洗出的纯歌名补搜一轮。90 分 ≈ 歌名精确命中 + 歌手/时长佐证。
      if ((!best || best.score < 90) && targetSongTitle && targetSongTitle.trim() !== query.trim()) {
        const retryCandidates = await searchUnified(targetSongTitle);
        if (retryCandidates.length > 0) {
          const merged = new Map<string, LyricCandidateSong>();
          // netease 候选在前，同分时稳定排序优先网易云（其可能携带逐字 YRC 与译文）
          for (const song of [...ranked.map((entry) => entry.song), ...retryCandidates]) {
            const key = `${song.provider}:${song.trackId}`;
            if (!merged.has(key)) merged.set(key, song);
          }
          ranked = rankUnified([...merged.values()]);
          best = ranked[0];
        }
      }

      if (best && best.score >= 0) {
        if (best.song.provider === "netease") {
          const lyricsData = await this.neteaseApiClient?.getLyrics({
            trackId: best.song.trackId,
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
        } else {
          const lyricsBody = await this.qqmusicApiClient?.getLyrics({
            trackId: best.song.trackId,
            cookie: ""
          });
          const plain = lyricsBody?.lyric?.trim() || null;
          const trans = lyricsBody?.trans?.trim() || null;
          const roma = lyricsBody?.roma?.trim() || null;
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
      this.logger.debug(`Cross-platform lyric match error: ${err instanceof Error ? err.message : String(err)}`);
    }

    return null;
  }

  /**
   * 搜索网易云候选歌曲。旧版 search 接口返回 duration（毫秒），cloudsearch 才返回 dt，
   * 两者兼容读取，避免时长校验被静默跳过。
   */
  private async searchNeteaseLyricCandidates(keywords: string): Promise<Omit<LyricCandidateSong, "provider">[]> {
    if (!this.neteaseApiClient || !keywords.trim()) return [];
    try {
      const searchResult = await this.neteaseApiClient.searchTracks({
        keywords: keywords.trim(),
        limit: 8,
        offset: 0,
        cookie: ""
      });
      const songs = (searchResult?.result as {
        songs?: Array<{
          id: number;
          name?: string;
          dt?: number;
          duration?: number;
          artists?: Array<{ name: string }>;
          ar?: Array<{ name: string }>;
        }>;
      })?.songs ?? [];
      return songs
        .filter((song) => typeof song?.id === "number")
        .map((song) => ({
          trackId: String(song.id),
          name: song.name ?? "",
          artistName: song.artists?.[0]?.name ?? song.ar?.[0]?.name,
          durationMs: Number(song.dt ?? song.duration ?? 0) || 0
        }));
    } catch (err) {
      this.logger.debug(`Netease lyric candidate search failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  /** 搜索 QQ 音乐候选歌曲（interval 为秒）。 */
  private async searchQqLyricCandidates(keywords: string): Promise<Omit<LyricCandidateSong, "provider">[]> {
    if (!this.qqmusicApiClient || !keywords.trim()) return [];
    try {
      const searchRecords = await this.qqmusicApiClient.searchTracks({
        keywords: keywords.trim(),
        limit: 8,
        offset: 0,
        cookie: "",
        kind: "song"
      });
      const list = (searchRecords as Array<{
        songmid?: string;
        mid?: string;
        songname?: string;
        name?: string;
        singer?: Array<{ name: string }> | string;
        interval?: number;
      }>) ?? [];
      return list
        .map((item) => ({
          trackId: item.songmid || item.mid || "",
          name: item.songname || item.name || "",
          artistName: Array.isArray(item.singer)
            ? item.singer.map((singer) => singer.name).join("/")
            : typeof item.singer === "string"
              ? item.singer
              : undefined,
          durationMs: (item.interval ?? 0) * 1000
        }))
        .filter((song) => song.trackId && song.name);
    } catch (err) {
      this.logger.debug(`QQ music lyric candidate search failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  /**
   * 对候选打分排序。B站标题“歌名 - 歌手”与“歌手 - 歌名”两种顺序都常见，
   * 清洗器无法 100% 区分，因此对两种目标朝向都打分并取较高者。
   */
  private scoreLyricMatchOrientation(
    candidateName: string,
    candidateArtist: string | undefined,
    candidateDurationMs: number,
    targetSongTitle?: string,
    targetArtist?: string,
    targetDurationMs = 0
  ): number {
    const forward = this.scoreLyricCandidate(
      candidateName,
      candidateArtist,
      candidateDurationMs,
      targetSongTitle,
      targetArtist,
      targetDurationMs
    );
    if (!targetSongTitle || !targetArtist) return forward;
    const reversed = this.scoreLyricCandidate(
      candidateName,
      candidateArtist,
      candidateDurationMs,
      targetArtist,
      targetSongTitle,
      targetDurationMs
    );
    return Math.max(forward, reversed);
  }

  private scoreLyricCandidate(
    candidateName: string,
    candidateArtist: string | undefined,
    candidateDurationMs: number,
    targetSongTitle?: string,
    targetArtist?: string,
    targetDurationMs = 0
  ): number {
    let score = 0;
    const candNameNorm = (candidateName || "").toLowerCase().replace(/\s+/g, "");
    const targetTitleNorm = (targetSongTitle || "").toLowerCase().replace(/\s+/g, "");

    // 1. 歌名匹配权重
    if (targetTitleNorm) {
      if (candNameNorm === targetTitleNorm) {
        score += 50;
      } else if (candNameNorm.includes(targetTitleNorm) || targetTitleNorm.includes(candNameNorm)) {
        score += 30;
      } else {
        score -= 40;
      }
    } else {
      score += 10;
    }

    // 2. 歌手匹配权重
    if (targetArtist && candidateArtist) {
      const candArtistNorm = candidateArtist.toLowerCase().replace(/\s+/g, "");
      const targetArtistNorm = targetArtist.toLowerCase().replace(/\s+/g, "");
      if (candArtistNorm.includes(targetArtistNorm) || targetArtistNorm.includes(candArtistNorm)) {
        score += 30;
      }
    }

    // 3. 时长贴合度权重（考虑视频片头片尾留白，容差扩展至 25 秒）
    if (targetDurationMs > 0 && candidateDurationMs > 0) {
      const diff = Math.abs(candidateDurationMs - targetDurationMs);
      if (diff <= 5000) {
        score += 30;
      } else if (diff <= 15000) {
        score += 20;
      } else if (diff <= 25000) {
        score += 10;
      } else if (diff > 90000) {
        score -= 30;
      }
    }

    return score;
  }
}
