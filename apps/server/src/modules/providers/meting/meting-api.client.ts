import { Injectable } from "@nestjs/common";
import type Meting from "@meting/core";
import type { MetingPlatform, MetingQuality, MetingSearchQuery } from "./meting.types";
import { metingPlatformMap } from "./meting.types";

export type MetingApiErrorKind = "unavailable" | "invalid-response";

export class MetingApiError extends Error {
  constructor(public readonly kind: MetingApiErrorKind) {
    super("Meting provider request failed.");
    this.name = "MetingApiError";
  }
}

@Injectable()
export class MetingApiClient {
  async searchTracks(provider: MetingPlatform, query: MetingSearchQuery) {
    try {
      const records = await this.call(async () => {
        const meting = await this.create(provider);
        const raw = await meting.search(query.keywords, {
          page: Math.floor(query.offset / query.limit) + 1,
          limit: query.limit,
          type: 1
        });
        return parseJsonArray(raw);
      });
      if (provider !== "kuwo" || records.some(hasTrackIdentity)) {
        return records;
      }
    } catch (error) {
      if (provider !== "kuwo") throw error;
    }

    return this.searchKuwoLegacy(query);
  }

  async getTrack(provider: MetingPlatform, trackId: string) {
    return this.call(async () => parseJsonValue(await (await this.create(provider)).song(trackId)));
  }

  async getTrackArtwork(provider: MetingPlatform, trackId: string) {
    return this.call(async () => parseJsonValue(await (await this.create(provider)).pic(trackId, 300)));
  }

  async getAudioUrl(provider: MetingPlatform, trackId: string, quality: MetingQuality) {
    try {
      const parsed = await this.call(async () => {
        const raw = await (await this.create(provider)).url(trackId, bitrateForQuality(quality));
        const value = parseJsonValue(raw);
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new MetingApiError("invalid-response");
        }
        return value as Record<string, unknown>;
      });
      if (provider !== "kuwo" || typeof parsed.url === "string" && parsed.url.trim()) {
        return parsed;
      }
    } catch (error) {
      if (provider !== "kuwo") throw error;
    }

    return this.getKuwoLegacyAudioUrl(trackId, quality);
  }

  private async create(provider: MetingPlatform) {
    const { default: MetingConstructor } = await loadMetingModule();
    return new MetingConstructor(metingPlatformMap[provider]).format(true);
  }

  private async searchKuwoLegacy(query: MetingSearchQuery) {
    const page = Math.floor(query.offset / query.limit);
    const url = new URL("https://search.kuwo.cn/r.s");
    url.search = new URLSearchParams({
      all: query.keywords,
      ft: "music",
      itemset: "web_2013",
      client: "kt",
      pn: String(page),
      rn: String(query.limit),
      rformat: "json",
      encoding: "utf8"
    }).toString();
    const response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0", accept: "text/plain" },
      signal: AbortSignal.timeout(requestTimeoutMs())
    }).catch(() => null);
    if (!response?.ok) {
      throw new MetingApiError("unavailable");
    }

    const payload = parseKuwoLegacyJson(await response.text());
    const records = payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).abslist
      : null;
    if (!Array.isArray(records)) return [];
    return records
      .map(toKuwoLegacyRecord)
      .filter((record): record is Record<string, unknown> => !!record);
  }

  private async getKuwoLegacyAudioUrl(trackId: string, quality: MetingQuality) {
    const url = new URL("https://antiserver.kuwo.cn/anti.s");
    url.search = new URLSearchParams({
      type: "convert_url",
      rid: trackId,
      format: "mp3",
      response: "url"
    }).toString();
    const response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0", accept: "text/plain" },
      signal: AbortSignal.timeout(requestTimeoutMs())
    }).catch(() => null);
    if (!response?.ok) {
      throw new MetingApiError("unavailable");
    }

    const audioUrl = (await response.text()).trim();
    return {
      url: /^https?:\/\//.test(audioUrl) ? audioUrl : "",
      size: 0,
      br: bitrateForQuality(quality)
    };
  }

  private async call<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof MetingApiError) throw error;
      throw new MetingApiError("unavailable");
    }
  }
}

type MetingModule = { default: typeof Meting };

let metingModulePromise: Promise<MetingModule> | undefined;

function loadMetingModule() {
  if (!metingModulePromise) {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (
      specifier: string
    ) => Promise<MetingModule>;
    metingModulePromise = dynamicImport("@meting/core");
  }

  return metingModulePromise;
}

function parseJsonValue(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new MetingApiError("invalid-response");
  }
}

function parseJsonArray(value: string) {
  const parsed = parseJsonValue(value);
  return Array.isArray(parsed) ? parsed : [];
}

function bitrateForQuality(quality: MetingQuality) {
  if (quality === "standard") return 128;
  if (quality === "high") return 192;
  return 320;
}

function requestTimeoutMs() {
  const value = Number(process.env.METING_REQUEST_TIMEOUT_MS ?? 15_000);
  return Number.isFinite(value) ? Math.max(1_000, Math.floor(value)) : 15_000;
}

function parseKuwoLegacyJson(value: string) {
  try {
    return JSON.parse(convertSingleQuotedJson(value)) as unknown;
  } catch {
    throw new MetingApiError("invalid-response");
  }
}

function convertSingleQuotedJson(value: string) {
  let result = "";
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (!quote) {
      if (character === "'" || character === '"') {
        quote = character;
        result += '"';
      } else {
        result += character;
      }
      continue;
    }

    if (character === "\\") {
      const next = value[index + 1];
      if (next === "'") {
        result += "'";
        index += 1;
      } else {
        result += character + (next ?? "");
        index += 1;
      }
      continue;
    }

    if (character === quote) {
      result += '"';
      quote = null;
      continue;
    }

    if (quote === "'" && character === '"') {
      result += '\\"';
    } else {
      result += character;
    }
  }

  return result;
}

function toKuwoLegacyRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const providerTrackId = readFirstString(record.MUSICRID, record.DC_TARGETID);
  const title = decodeKuwoText(readFirstString(record.SONGNAME, record.NAME));
  if (!providerTrackId || !title) return null;

  return {
    id: providerTrackId.replace(/^MUSIC_/, ""),
    name: title,
    artist: [decodeKuwoText(readFirstString(record.ARTIST, record.AARTIST) ?? "未知歌手")],
    album: decodeKuwoText(readFirstString(record.ALBUM)),
    interval: Number(record.DURATION) || 0,
    access: record.PAY === "0" ? "free" : "unknown"
  };
}

function hasTrackIdentity(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Boolean(readFirstString(record.id, record.url_id, record.songmid) &&
    readFirstString(record.name, record.title));
}

function readFirstString(...values: unknown[]) {
  return values.find((value): value is string =>
    typeof value === "string" && value.trim().length > 0
  )?.trim() ?? null;
}

function decodeKuwoText(value: string | null) {
  return value
    ?.replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim() || null;
}
