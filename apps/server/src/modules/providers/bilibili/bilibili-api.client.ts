import crypto from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type {
  BilibiliSubtitleItem,
  BilibiliSubtitleMeta
} from "./bilibili-subtitle";
import { BilibiliWbiSigner } from "./bilibili-wbi";

const BILIBILI_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const BILIBILI_REFERER = "https://www.bilibili.com/";

const BILIBILI_TV_APPKEY = "4409e200fedc5a43";
const BILIBILI_TV_APPSEC = "59b43e04ad6965f34319062b425580dd";
const BILIBILI_TV_UA = "Bilibili/7.20.0 (Android; 10)";

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
    order: number;
    length: number;
    size: number;
    url: string;
  }>;
};

export type BilibiliSearchItem = {
  id: number;
  type: string;
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
  review: number;
  pubdate: number;
  senddate: number;
  duration: string;
  badgepay: boolean;
  hit_columns?: string[];
  view_type?: string;
  is_pay?: number;
  is_union_video?: number;
  like?: number;
  upic?: string;
  corner?: string;
  cover?: string;
  desc?: string;
  url?: string;
  danmaku?: number;
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
   * 免登录获取完整访客 Cookie（b_nut, buvid3, buvid4 等），满足 B 站 WAF 反爬校验
   */
  async getGuestCookies(): Promise<string> {
    const now = Date.now();
    if (this.cachedCookies && now < this.cookiesExpiresAt) {
      return this.cachedCookies;
    }

    try {
      // 1. 访问主页获取基础会话 cookie（含 b_nut）
      const homeRes = await fetch("https://www.bilibili.com/", {
        headers: {
          "User-Agent": BILIBILI_UA
        }
      });
      const homeCookies: string[] =
        typeof (homeRes.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
          ? (homeRes.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
          : [homeRes.headers.get("set-cookie")].filter((c): c is string => Boolean(c));

      // 2. 获取访客 SPI 凭据（buvid3 / buvid4）
      const spiRes = await fetch("https://api.bilibili.com/x/frontend/finger/spi", {
        headers: {
          "User-Agent": BILIBILI_UA,
          Referer: BILIBILI_REFERER
        }
      });

      const cookieParts: string[] = [];
      for (const raw of homeCookies) {
        if (typeof raw === "string") {
          const item = raw.split(";")[0]?.trim();
          if (item) cookieParts.push(item);
        }
      }

      if (spiRes.ok) {
        const spiJson = (await spiRes.json()) as {
          code: number;
          data?: { b_3?: string; b_4?: string };
        };
        if (spiJson.code === 0 && spiJson.data?.b_3) {
          cookieParts.push(`buvid3=${encodeURIComponent(spiJson.data.b_3)}`);
          cookieParts.push(`buvid4=${encodeURIComponent(spiJson.data.b_4 ?? spiJson.data.b_3)}`);
        }
      }

      cookieParts.push("CURRENT_FNVAL=4048");
      cookieParts.push("_uuid=auto");

      // 按 key 去重合并
      const map = new Map<string, string>();
      for (const part of cookieParts) {
        const [k, ...v] = part.split("=");
        if (k && v.length > 0) {
          map.set(k.trim(), v.join("=").trim());
        }
      }
      const combined = Array.from(map.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");

      this.cachedCookies = combined || "buvid3=auto; buvid4=auto; CURRENT_FNVAL=4048;";
      // 缓存 6 小时
      this.cookiesExpiresAt = now + 6 * 3600 * 1000;
      return this.cachedCookies;
    } catch (err) {
      this.logger.warn(`Failed to fetch guest SPI cookie: ${err instanceof Error ? err.message : String(err)}`);
    }

    return "buvid3=auto; buvid4=auto; CURRENT_FNVAL=4048;";
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

  /**
   * 获取视频播放流：三级容灾架构
   * 1. 优先使用 Web 端 WBI 签名 playurl 接口（带 Origin 与完整视频 Referer）；
   * 2. 次选 Web 端普通 playurl 接口；
   * 3. 终极兜底：TV 端 UGC playurl 接口（官方客户端 appkey 签名，免登录无 412 风控）。
   */
  async getPlayUrl(bvid: string, cid: number, aid?: number): Promise<BilibiliPlayUrlData> {
    const cookie = await this.getGuestCookies();

    // 1. 尝试 Web WBI 接口
    try {
      const signedQuery = await BilibiliWbiSigner.sign(
        {
          bvid,
          cid,
          qn: 64,
          fnval: 4048,
          fnver: 0,
          fourk: 1
        },
        cookie
      );
      const url = `https://api.bilibili.com/x/player/wbi/playurl?${signedQuery}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": BILIBILI_UA,
          Referer: `https://www.bilibili.com/video/${bvid}`,
          Origin: "https://www.bilibili.com",
          Cookie: cookie
        }
      });
      if (res.ok) {
        const json = (await res.json()) as { code: number; message: string; data?: BilibiliPlayUrlData };
        if (json.code === 0 && json.data) {
          return json.data;
        }
        this.logger.warn(`Bilibili WBI playurl returned code ${json.code} (${json.message}), trying fallback.`);
      } else {
        this.logger.warn(`Bilibili WBI playurl HTTP ${res.status}, trying fallback.`);
      }
    } catch (err) {
      this.logger.warn(`Bilibili WBI playurl error: ${err instanceof Error ? err.message : String(err)}, trying fallback.`);
    }

    // 2. 尝试普通 Web playurl 接口
    try {
      const plainUrl = `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&qn=64&fnval=4048&fnver=0&fourk=1`;
      const res = await fetch(plainUrl, {
        headers: {
          "User-Agent": BILIBILI_UA,
          Referer: `https://www.bilibili.com/video/${bvid}`,
          Origin: "https://www.bilibili.com",
          Cookie: cookie
        }
      });
      if (res.ok) {
        const json = (await res.json()) as { code: number; message: string; data?: BilibiliPlayUrlData };
        if (json.code === 0 && json.data) {
          return json.data;
        }
      }
    } catch (err) {
      this.logger.warn(`Bilibili plain playurl fallback failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 3. 终极兜底：TV 端 UGC playurl 接口
    try {
      let targetAid = aid;
      if (!targetAid) {
        const view = await this.getVideoView(bvid);
        targetAid = Number(view.aid);
      }
      if (targetAid) {
        const tvData = await this.getTvPlayUrl(targetAid, cid);
        if (tvData) {
          return tvData;
        }
      }
    } catch (err) {
      this.logger.warn(`Bilibili TV playurl fallback failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    throw new Error(`未能获取 B 站视频播放流: ${bvid} (cid: ${cid})`);
  }

  private async getTvPlayUrl(aid: number, cid: number): Promise<BilibiliPlayUrlData | null> {
    const params: Record<string, string | number> = {
      appkey: BILIBILI_TV_APPKEY,
      avid: aid,
      cid,
      fnval: 16,
      fnver: 0,
      fourk: 1,
      otype: "json",
      platform: "android",
      qn: 64,
      ts: Math.floor(Date.now() / 1000)
    };
    const sortedKeys = Object.keys(params).sort();
    const queryStr = sortedKeys.map((k) => `${k}=${encodeURIComponent(params[k]!)}`).join("&");
    const sign = crypto.createHash("md5").update(queryStr + BILIBILI_TV_APPSEC).digest("hex");
    const tvUrl = `https://api.bilibili.com/x/tv/ugc/playurl?${queryStr}&sign=${sign}`;

    const res = await fetch(tvUrl, {
      headers: {
        "User-Agent": BILIBILI_TV_UA
      }
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { code: number; message: string; durl?: Array<{ url: string; size: number; length: number }> };
    if (json.code === 0 && json.durl && json.durl.length > 0) {
      return {
        dash: undefined,
        durl: json.durl.map((d, i) => ({
          order: i + 1,
          length: d.length,
          size: d.size,
          url: d.url
        }))
      };
    }
    return null;
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
   * 支持多 CDN URL 顺序尝试容灾，并在 403/节点受限时自动适配 TV 端请求头
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

    const defaultHeaders: Record<string, string> = {
      "User-Agent": BILIBILI_UA,
      Referer: BILIBILI_REFERER
    };
    if (range) {
      defaultHeaders.Range = range;
    }

    const tvHeaders: Record<string, string> = {
      "User-Agent": BILIBILI_TV_UA
    };
    if (range) {
      tvHeaders.Range = range;
    }

    let lastError: unknown = null;
    let lastResponse: Response | null = null;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]!;

      // 1. 尝试默认 Web 请求头
      try {
        const res = await fetch(url, { headers: defaultHeaders });
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

        // 若返回 403，尝试 TV 端请求头（TV 流针对空 Referer + TV UA 开放）
        if (res.status === 403) {
          const tvRes = await fetch(url, { headers: tvHeaders });
          if (tvRes.status === 200 || tvRes.status === 206) {
            const responseHeaders: Record<string, string> = {};
            for (const [key, value] of tvRes.headers.entries()) {
              responseHeaders[key.toLowerCase()] = value;
            }
            return {
              status: tvRes.status,
              headers: responseHeaders,
              body: tvRes.body
            };
          }
        }

        this.logger.warn(`Bilibili audio stream URL [${i + 1}/${urls.length}] returned HTTP ${res.status}, trying next fallback CDN.`);
        lastResponse = res;
      } catch (err) {
        // 网络异常时也尝试 TV 请求头
        try {
          const tvRes = await fetch(url, { headers: tvHeaders });
          if (tvRes.status === 200 || tvRes.status === 206) {
            const responseHeaders: Record<string, string> = {};
            for (const [key, value] of tvRes.headers.entries()) {
              responseHeaders[key.toLowerCase()] = value;
            }
            return {
              status: tvRes.status,
              headers: responseHeaders,
              body: tvRes.body
            };
          }
        } catch {
          // ignore
        }
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
