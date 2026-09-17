import { Injectable, Logger } from "@nestjs/common";
import type {
  BilibiliSubtitleItem,
  BilibiliSubtitleMeta
} from "./bilibili-subtitle";
import { BilibiliWbiSigner } from "./bilibili-wbi";

const BILIBILI_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const BILIBILI_REFERER = "https://www.bilibili.com/";

export type BilibiliViewData = {
  bvid: string;
  aid: number;
  title: string;
  pic: string;
  desc: string;
  duration: number;
  owner: {
    mid: number;
    name: string;
    face: string;
  };
  pages: Array<{
    cid: number;
    page: number;
    part: string;
    duration: number;
  }>;
};

export type BilibiliPlayUrlData = {
  dash?: {
    audio?: Array<{
      id: number;
      baseUrl: string;
      backupUrl?: string[];
      bandwidth: number;
      codecs: string;
    }>;
  };
  durl?: Array<{
    url: string;
    size: number;
    length: number;
  }>;
};

export type BilibiliSearchItem = {
  type: string;
  id: number;
  author: string;
  mid: number;
  typeid: string;
  typename: string;
  arcurl: string;
  aid: number;
  bvid: string;
  title: string;
  description: string;
  pic: string;
  play: number;
  video_review: number;
  favorites: number;
  tag: string;
  duration: string; // e.g. "03:45"
};

export type BilibiliFavoriteItem = {
  id: number;
  type: number;
  title: string;
  cover: string;
  intro: string;
  page: number;
  duration: number;
  upper: {
    mid: number;
    name: string;
    face: string;
  };
  attr: number;
  cnt_info: {
    collect: number;
    play: number;
    danmaku: number;
  };
  link: string;
  bvid: string;
};

export type BilibiliRankingItem = {
  aid: string;
  bvid: string;
  title: string;
  pic: string;
  desc: string;
  duration: number;
  owner: {
    mid: number;
    name: string;
    face: string;
  };
};

/**
 * CDN 节点优先级评分：
 * 官方骨干 CDN (如 *.bilivideo.com, *.hdslb.com) -> +10
 * 边缘 P2P MCDN (如 mcdn., szbdyd.com) -> -10 (容易超时或 403)
 */
export function scoreBilibiliCdnUrl(url: string): number {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.includes("mcdn") || host.includes("szbdyd.com") || host.includes("ws.hw.biliapi.net")) {
      return -10;
    }
    if (host.endsWith("bilivideo.com") || host.endsWith("hdslb.com") || host.includes("akamaized.net")) {
      return 10;
    }
  } catch {
    return 0;
  }
  return 0;
}

export function sortBilibiliAudioUrls(baseUrl?: string, backupUrls: string[] = []): string[] {
  const allUrls: string[] = [];
  if (baseUrl) allUrls.push(baseUrl);
  if (Array.isArray(backupUrls)) {
    allUrls.push(...backupUrls);
  }

  // 去重
  const uniqueUrls = Array.from(new Set(allUrls.filter(Boolean)));

  // 按 CDN 得分降序排序（高优先级靠前）
  return uniqueUrls.sort((a, b) => scoreBilibiliCdnUrl(b) - scoreBilibiliCdnUrl(a));
}

@Injectable()
export class BilibiliApiClient {
  private readonly logger = new Logger(BilibiliApiClient.name);

  private cachedCookies: string | null = null;
  private cookiesExpiresAt = 0;

  /**
   * 免登录获取游客 SPI 凭证（buvid3 / buvid4），降低反爬风控风险
   */
  async getGuestCookies(): Promise<string> {
    const now = Date.now();
    if (this.cachedCookies && now < this.cookiesExpiresAt) {
      return this.cachedCookies;
    }

    try {
      const res = await fetch("https://api.bilibili.com/x/frontend/finger/spi", {
        headers: {
          "User-Agent": BILIBILI_UA,
          Referer: BILIBILI_REFERER
        }
      });
      if (res.ok) {
        const json = (await res.json()) as {
          code: number;
          data?: { b_3?: string; b_4?: string };
        };
        if (json.code === 0 && json.data?.b_3) {
          const cookieStr = `buvid3=${encodeURIComponent(json.data.b_3)}; buvid4=${encodeURIComponent(json.data.b_4 ?? json.data.b_3)};`;
          this.cachedCookies = cookieStr;
          // 缓存 12 小时
          this.cookiesExpiresAt = now + 12 * 3600 * 1000;
          return cookieStr;
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to fetch guest SPI cookie: ${err instanceof Error ? err.message : String(err)}`);
    }

    return "buvid3=auto; buvid4=auto;";
  }

  async getVideoView(bvid: string): Promise<BilibiliViewData> {
    const cookie = await this.getGuestCookies();
    const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": BILIBILI_UA,
        Referer: BILIBILI_REFERER,
        Cookie: cookie
      }
    });
    if (!res.ok) {
      throw new Error(`Bilibili view API error: HTTP ${res.status}`);
    }
    const json = (await res.json()) as { code: number; message: string; data?: BilibiliViewData };
    if (json.code !== 0 || !json.data) {
      throw new Error(`Bilibili video not found: ${json.message || "Unknown error"}`);
    }
    return json.data;
  }

  async getPlayUrl(bvid: string, cid: number): Promise<BilibiliPlayUrlData> {
    const cookie = await this.getGuestCookies();
    const signedQuery = await BilibiliWbiSigner.sign(
      {
        bvid,
        cid,
        fnval: 4048
      },
      cookie
    );
    const url = `https://api.bilibili.com/x/player/wbi/playurl?${signedQuery}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": BILIBILI_UA,
        Referer: BILIBILI_REFERER,
        Cookie: cookie
      }
    });
    if (!res.ok) {
      throw new Error(`Bilibili playurl API error: HTTP ${res.status}`);
    }
    const json = (await res.json()) as { code: number; message: string; data?: BilibiliPlayUrlData };
    if (json.code !== 0 || !json.data) {
      throw new Error(`Bilibili playurl failed: ${json.message || "Unknown error"}`);
    }
    return json.data;
  }

  async getVideoSubtitles(bvid: string, cid: number): Promise<BilibiliSubtitleMeta[]> {
    const cookie = await this.getGuestCookies();
    const url = `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${cid}`;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": BILIBILI_UA,
          Referer: BILIBILI_REFERER,
          Cookie: cookie
        }
      });
      if (!res.ok) return [];
      const json = (await res.json()) as {
        code: number;
        data?: {
          subtitle?: {
            subtitles?: BilibiliSubtitleMeta[];
          };
        };
      };
      if (json.code === 0 && json.data?.subtitle?.subtitles) {
        return json.data.subtitle.subtitles;
      }
    } catch (err) {
      this.logger.warn(`Failed to fetch subtitles for ${bvid}:${cid} - ${err instanceof Error ? err.message : String(err)}`);
    }
    return [];
  }

  async fetchSubtitleContent(subtitleUrl: string): Promise<BilibiliSubtitleItem[]> {
    let targetUrl = subtitleUrl.trim();
    if (targetUrl.startsWith("//")) {
      targetUrl = `https:${targetUrl}`;
    }
    try {
      const res = await fetch(targetUrl, {
        headers: {
          "User-Agent": BILIBILI_UA,
          Referer: BILIBILI_REFERER
        }
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { body?: BilibiliSubtitleItem[] };
      return json.body ?? [];
    } catch (err) {
      this.logger.warn(`Failed to download subtitle content from ${targetUrl}: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  async searchVideo(
    keyword: string,
    page = 1,
    pageSize = 20,
    tid?: number
  ): Promise<{ items: BilibiliSearchItem[]; total: number }> {
    const cleanKeyword = keyword.trim();
    const cookie = await this.getGuestCookies();
    let url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(cleanKeyword)}&page=${page}&page_size=${pageSize}`;
    if (typeof tid === "number" && tid > 0) {
      url += `&tids=${tid}`;
    }
    const res = await fetch(url, {
      headers: {
        "User-Agent": BILIBILI_UA,
        Referer: BILIBILI_REFERER,
        Cookie: cookie
      }
    });
    if (!res.ok) {
      throw new Error(`Bilibili search API error: HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      code: number;
      data?: {
        result?: BilibiliSearchItem[];
        numResults?: number;
      };
    };
    return {
      items: json.data?.result ?? [],
      total: json.data?.numResults ?? 0
    };
  }

  async getFavoriteResources(
    mediaId: string,
    page = 1,
    pageSize = 20
  ): Promise<{ items: BilibiliFavoriteItem[]; hasMore: boolean; total: number; title?: string }> {
    const cookie = await this.getGuestCookies();
    const cleanId = mediaId.replace(/^ml/i, "").trim();
    const url = `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${encodeURIComponent(cleanId)}&pn=${page}&ps=${pageSize}&platform=web&order=mtime&type=0`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": BILIBILI_UA,
        Referer: BILIBILI_REFERER,
        Cookie: cookie
      }
    });

    if (!res.ok) {
      throw new Error(`Bilibili favorite API error: HTTP ${res.status}`);
    }

    const json = (await res.json()) as {
      code: number;
      message?: string;
      data?: {
        info?: { title?: string; media_count?: number };
        medias?: BilibiliFavoriteItem[];
        has_more?: boolean;
      };
    };

    if (json.code !== 0 || !json.data) {
      throw new Error(`获取 B 站收藏夹失败: ${json.message || "未知错误"}`);
    }

    return {
      items: json.data.medias ?? [],
      hasMore: Boolean(json.data.has_more),
      total: json.data.info?.media_count ?? (json.data.medias ?? []).length,
      title: json.data.info?.title
    };
  }

  async getMusicRanking(subType = "3"): Promise<BilibiliRankingItem[]> {
    const cookie = await this.getGuestCookies();
    const url = `https://api.bilibili.com/x/web-interface/ranking/v2?rid=${encodeURIComponent(subType)}&type=all`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": BILIBILI_UA,
        Referer: BILIBILI_REFERER,
        Cookie: cookie
      }
    });

    if (!res.ok) {
      throw new Error(`Bilibili ranking API error: HTTP ${res.status}`);
    }

    const json = (await res.json()) as {
      code: number;
      message?: string;
      data?: {
        list?: BilibiliRankingItem[];
      };
    };

    return json.data?.list ?? [];
  }

  /**
   * 支持多 CDN URL 顺序尝试容灾，解决单节点 403 / 502 或超时导致的播放中断
   */
  async fetchAudioStream(
    audioUrls: string | string[],
    range?: string
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    body: ReadableStream<Uint8Array> | null;
  }> {
    const urls = Array.isArray(audioUrls) ? audioUrls : [audioUrls];
    if (urls.length === 0) {
      throw new Error("No audio URLs provided to fetchAudioStream");
    }

    const headers: Record<string, string> = {
      "User-Agent": BILIBILI_UA,
      Referer: BILIBILI_REFERER
    };
    if (range) {
      headers.Range = range;
    }

    let lastError: unknown = null;
    let lastResponse: Response | null = null;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]!;
      try {
        const res = await fetch(url, { headers });
        if (res.status === 200 || res.status === 206) {
          const responseHeaders: Record<string, string> = {};
          for (const [key, value] of res.headers.entries()) {
            responseHeaders[key.toLowerCase()] = value;
          }
          return {
            status: res.status,
            headers: responseHeaders,
            body: res.body
          };
        }

        this.logger.warn(`Bilibili audio stream URL [${i + 1}/${urls.length}] returned HTTP ${res.status}, trying next fallback CDN.`);
        lastResponse = res;
      } catch (err) {
        this.logger.warn(`Bilibili audio stream URL [${i + 1}/${urls.length}] failed: ${err instanceof Error ? err.message : String(err)}, trying next CDN.`);
        lastError = err;
      }
    }

    if (lastResponse) {
      const responseHeaders: Record<string, string> = {};
      for (const [key, value] of lastResponse.headers.entries()) {
        responseHeaders[key.toLowerCase()] = value;
      }
      return {
        status: lastResponse.status,
        headers: responseHeaders,
        body: lastResponse.body
      };
    }

    throw lastError || new Error("Failed to connect to all Bilibili audio stream CDNs");
  }
}
