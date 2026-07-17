import { createHash } from "node:crypto";
import type { MetingPlatform, MetingQuality, MetingSearchQuery } from "./meting.types";

const userAgent = "Mozilla/5.0 (compatible; MusicRoom/1.0)";

export class MetingPlatformApiClient {
  private readonly trackCache = new Map<string, { expiresAt: number; record: unknown }>();

  async searchTracks(provider: MetingPlatform, query: MetingSearchQuery) {
    let records: unknown[] | null;
    switch (provider) {
      case "qqmusic":
        records = await this.searchQqMusic(query);
        break;
      case "kugou":
        records = await this.searchKugou(query);
        break;
      case "taihe":
      case "baidu":
        records = await this.searchTaihe(query);
        break;
      case "migu":
        records = await this.searchMigu(query);
        break;
      default:
        records = null;
    }
    if (records) this.cacheTracks(provider, records);
    return records;
  }

  async getTrack(provider: MetingPlatform, trackId: string) {
    const cached = this.getCachedTrack(provider, trackId);
    if (cached) return [cached];

    switch (provider) {
      case "qqmusic":
        return this.getQqMusicTrack(trackId);
      case "kugou":
        return this.getKugouTrack(trackId);
      case "taihe":
      case "baidu":
        return this.getFirstSearchResult(provider, trackId, trackId);
      case "migu":
        return this.getFirstSearchResult(provider, miguCopyrightId(trackId), trackId);
      default:
        return null;
    }
  }

  async getTrackArtwork(provider: MetingPlatform, trackId: string) {
    const track = await this.getTrack(provider, trackId);
    return { url: artworkFromRecord(Array.isArray(track) ? track[0] : track) };
  }

  async getAudioUrl(provider: MetingPlatform, trackId: string, quality: MetingQuality) {
    switch (provider) {
      case "qqmusic":
        return this.getQqMusicAudioUrl(trackId, quality);
      case "kugou":
        return this.getKugouAudioUrl(trackId);
      case "taihe":
      case "baidu":
        return this.getTaiheAudioUrl(trackId);
      case "migu":
        return this.getMiguAudioUrl(trackId, quality);
      default:
        return null;
    }
  }

  private async searchQqMusic(query: MetingSearchQuery) {
    const page = Math.floor(query.offset / query.limit) + 1;
    const url = new URL("https://c.y.qq.com/soso/fcgi-bin/client_search_cp");
    url.search = new URLSearchParams({
      format: "json",
      w: query.keywords,
      n: String(query.limit),
      p: String(page),
      g_tk: "5381",
      loginUin: "0",
      hostUin: "0",
      inCharset: "utf8",
      outCharset: "utf-8",
      notice: "0",
      platform: "yqq.json",
      needNewCode: "0"
    }).toString();
    const payload = await this.getJson(url, {
      referer: "https://y.qq.com/"
    });
    const data = asRecord(asRecord(payload)?.data)?.song;
    return Array.isArray(asRecord(data)?.list) ? asRecord(data)?.list as unknown[] : [];
  }

  private async getQqMusicTrack(trackId: string) {
    const url = new URL("https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg");
    url.search = new URLSearchParams({
      songmid: trackId,
      tpl: "yqq_song_detail",
      format: "json"
    }).toString();
    const payload = await this.getJson(url, { referer: "https://y.qq.com/" });
    const records = asRecord(payload)?.data;
    return Array.isArray(records) ? records : [];
  }

  private async getQqMusicAudioUrl(trackId: string, quality: MetingQuality) {
    const prefix = quality === "standard" ? "M500" : "M800";
    const filename = `${prefix}${trackId}${trackId}.mp3`;
    const payload = await this.getJson("https://u.y.qq.com/cgi-bin/musicu.fcg", {
      method: "POST",
      referer: "https://y.qq.com/",
      body: JSON.stringify({
        req_1: {
          module: "vkey.GetVkeyServer",
          method: "CgiGetVkey",
          param: {
            filename: [filename],
            guid: "10000",
            songmid: [trackId],
            songtype: [0],
            uin: "0",
            loginflag: 1,
            platform: "20"
          }
        },
        loginUin: "0",
        comm: { uin: "0", format: "json", ct: 24, cv: 0 }
      })
    });
    const item = asRecord(asRecord(asRecord(payload)?.req_1)?.data);
    const midUrlInfo = Array.isArray(item?.midurlinfo) ? item.midurlinfo[0] : null;
    const record = asRecord(midUrlInfo);
    const purl = readString(record?.purl);
    const sip = Array.isArray(item?.sip) ? readString(item.sip[0]) : null;
    return {
      url: purl && sip ? new URL(purl, sip).toString() : "",
      size: readNumber(record?.size),
      br: quality === "standard" ? 128 : 320
    };
  }

  private async searchKugou(query: MetingSearchQuery) {
    const page = Math.floor(query.offset / query.limit) + 1;
    const url = new URL("https://songsearch.kugou.com/song_search_v2");
    url.search = new URLSearchParams({
      keyword: query.keywords,
      page: String(page),
      pagesize: String(query.limit)
    }).toString();
    const payload = await this.getJson(url, { referer: "https://www.kugou.com/" });
    const records = asRecord(asRecord(payload)?.data)?.lists;
    return Array.isArray(records) ? records : [];
  }

  private async getKugouTrack(trackId: string) {
    const url = new URL("https://m.kugou.com/app/i/getSongInfo.php");
    url.search = new URLSearchParams({ cmd: "playInfo", hash: trackId }).toString();
    const payload = await this.getJson(url, { referer: "https://www.kugou.com/" });
    return payload && typeof payload === "object" ? [payload] : [];
  }

  private async getKugouAudioUrl(trackId: string) {
    const records = await this.getKugouTrack(trackId);
    const record = asRecord(records[0]);
    const backup = Array.isArray(record?.backup_url) ? readString(record.backup_url[0]) : null;
    return {
      url: readString(record?.url) ?? backup ?? "",
      size: readNumber(record?.fileSize),
      br: readNumber(record?.bitRate)
    };
  }

  private async searchTaihe(query: MetingSearchQuery) {
    const page = Math.floor(query.offset / query.limit) + 1;
    const payload = await this.getJson(buildTaiheUrl("/search", {
      word: query.keywords,
      pageNo: String(page),
      type: "1"
    }), { referer: "https://music.taihe.com/" });
    const records = asRecord(asRecord(payload)?.data)?.typeTrack;
    return Array.isArray(records) ? records : [];
  }

  private async getTaiheAudioUrl(trackId: string) {
    const payload = await this.getJson(buildTaiheUrl("/song/tracklink", {
      TSID: trackId
    }), { referer: "https://music.taihe.com/" });
    const record = asRecord(asRecord(payload)?.data);
    return {
      url: readString(record?.path) ?? "",
      size: readNumber(record?.size),
      br: readNumber(record?.rate)
    };
  }

  private async searchMigu(query: MetingSearchQuery) {
    const page = Math.floor(query.offset / query.limit) + 1;
    const url = new URL("https://pd.musicapp.migu.cn/MIGUM3.0/pc/resource/song/item/search/v1.0");
    url.search = new URLSearchParams({
      text: query.keywords,
      pageNo: String(page),
      pageSize: String(query.limit)
    }).toString();
    const payload = await this.getJson(url, { referer: "https://music.migu.cn/" });
    return Array.isArray(payload)
      ? payload.map((record) => addMiguTrackId(record))
      : [];
  }

  private async getMiguAudioUrl(trackId: string, quality: MetingQuality) {
    const [copyrightId, contentId] = splitMiguTrackId(trackId);
    if (!copyrightId || !contentId) return { url: "", size: 0, br: 0 };
    const toneFlag = quality === "standard" ? "PQ" : quality === "high" ? "HQ" : "HQ";
    const url = new URL("https://pd.musicapp.migu.cn/MIGUM3.0/strategy/pc/listen/v1.0");
    url.search = new URLSearchParams({
      scene: "",
      netType: "01",
      resourceType: "2",
      copyrightId,
      contentId,
      toneFlag
    }).toString();
    const payload = await this.getJson(url, {
      referer: "https://music.migu.cn/",
      channel: "0146951",
      uid: "1234"
    });
    const data = asRecord(asRecord(payload)?.data);
    return {
      url: readString(data?.url) ?? "",
      size: readNumber(data?.size ?? data?.fileSize),
      br: toneFlag === "PQ" ? 128 : 320
    };
  }

  private async getFirstSearchResult(
    provider: MetingPlatform,
    keywords: string,
    expectedTrackId: string
  ) {
    const records = await this.searchTracks(provider, {
      keywords,
      limit: 30,
      offset: 0
    });
    return records?.filter((record) => {
      const value = asRecord(record);
      return value && (
        readString(value._providerTrackId) === expectedTrackId ||
        readString(value.id) === expectedTrackId
      );
    }) ?? [];
  }

  private async getJson(url: URL | string, options: {
    method?: "GET" | "POST";
    referer: string;
    body?: string;
    channel?: string;
    uid?: string;
  }) {
    const headers = new Headers({
      accept: "application/json, text/plain, */*",
      "user-agent": userAgent,
      referer: options.referer
    });
    if (options.body) headers.set("content-type", "application/json");
    if (options.channel) headers.set("channel", options.channel);
    if (options.uid) headers.set("uid", options.uid);
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body,
      signal: AbortSignal.timeout(requestTimeoutMs())
    }).catch(() => null);
    if (!response?.ok) throw new Error("Provider request failed.");
    try {
      return await response.json() as unknown;
    } catch {
      throw new Error("Provider response was invalid.");
    }
  }

  private cacheTracks(provider: MetingPlatform, records: unknown[]) {
    const expiresAt = Date.now() + 10 * 60_000;
    for (const record of records) {
      const value = asRecord(record);
      const trackId = readString(value?._providerTrackId ?? value?.id ?? value?.songmid ?? value?.FileHash);
      if (trackId) this.trackCache.set(`${provider}:${trackId}`, { record, expiresAt });
    }
  }

  private getCachedTrack(provider: MetingPlatform, trackId: string) {
    const cached = this.trackCache.get(`${provider}:${trackId}`);
    if (!cached) return null;
    if (cached.expiresAt < Date.now()) {
      this.trackCache.delete(`${provider}:${trackId}`);
      return null;
    }
    return cached.record;
  }
}

export function isDirectMetingProvider(provider: MetingPlatform) {
  return provider !== "kuwo";
}

function addMiguTrackId(value: unknown) {
  const record = asRecord(value);
  if (!record) return value;
  const copyrightId = readString(record.copyrightId);
  const contentId = readString(record.contentId);
  return {
    ...record,
    _providerTrackId: copyrightId && contentId
      ? `${copyrightId}__${contentId}`
      : copyrightId
  };
}

function splitMiguTrackId(value: string) {
  const [copyrightId, contentId] = value.split("__", 2);
  return [copyrightId ?? "", contentId ?? ""];
}

function miguCopyrightId(value: string) {
  return splitMiguTrackId(value)[0];
}

function buildTaiheUrl(path: string, input: Record<string, string>) {
  const params: Record<string, string> = {
    ...input,
    timestamp: String(Math.round(Date.now() / 1000)),
    appid: "16073360"
  };
  const sorted = new URLSearchParams(params);
  sorted.sort();
  const sign = createHash("md5")
    .update(`${decodeURIComponent(sorted.toString())}0b50b02fd0d73a9c4c8c3a781c30845f`)
    .digest("hex");
  params.sign = sign;
  const url = new URL(`https://music.taihe.com/v1${path}`);
  url.search = new URLSearchParams(params).toString();
  return url;
}

function artworkFromRecord(value: unknown) {
  const record = asRecord(value);
  const artwork = readString(record?.pic ?? record?.picUrl ?? record?.Image ?? record?.img3 ?? record?.img2 ?? record?.img1);
  return artwork?.replace("{size}", "300").replace(/^http:/, "https:") ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() :
    typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function readNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function requestTimeoutMs() {
  const value = Number(process.env.METING_REQUEST_TIMEOUT_MS ?? 15_000);
  return Number.isFinite(value) ? Math.max(1_000, Math.floor(value)) : 15_000;
}
