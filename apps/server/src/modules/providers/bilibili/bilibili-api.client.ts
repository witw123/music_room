import { Injectable, Logger } from "@nestjs/common";

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

@Injectable()
export class BilibiliApiClient {
  private readonly logger = new Logger(BilibiliApiClient.name);

  async getVideoView(bvid: string): Promise<BilibiliViewData> {
    const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": BILIBILI_UA,
        Referer: BILIBILI_REFERER
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
    const url = `https://api.bilibili.com/x/player/wbi/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&fnval=16`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": BILIBILI_UA,
        Referer: BILIBILI_REFERER
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

  async searchVideo(keyword: string, page = 1, pageSize = 20): Promise<{ items: BilibiliSearchItem[]; total: number }> {
    const cleanKeyword = keyword.trim();
    const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(cleanKeyword)}&page=${page}&page_size=${pageSize}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": BILIBILI_UA,
        Referer: BILIBILI_REFERER,
        Cookie: "buvid3=auto;"
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

  async fetchAudioStream(
    audioUrl: string,
    range?: string
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    body: ReadableStream<Uint8Array> | null;
  }> {
    const headers: Record<string, string> = {
      "User-Agent": BILIBILI_UA,
      Referer: BILIBILI_REFERER
    };
    if (range) {
      headers.Range = range;
    }

    const res = await fetch(audioUrl, { headers });
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
}
