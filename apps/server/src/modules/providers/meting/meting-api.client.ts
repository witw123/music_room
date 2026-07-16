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
    return this.call(async () => {
      const meting = await this.create(provider);
      const raw = await meting.search(query.keywords, {
        page: Math.floor(query.offset / query.limit) + 1,
        limit: query.limit,
        type: 1
      });
      return parseJsonArray(raw);
    });
  }

  async getTrack(provider: MetingPlatform, trackId: string) {
    return this.call(async () => parseJsonValue(await (await this.create(provider)).song(trackId)));
  }

  async getTrackArtwork(provider: MetingPlatform, trackId: string) {
    return this.call(async () => parseJsonValue(await (await this.create(provider)).pic(trackId, 300)));
  }

  async getAudioUrl(provider: MetingPlatform, trackId: string, quality: MetingQuality) {
    return this.call(async () => {
      const raw = await (await this.create(provider)).url(trackId, bitrateForQuality(quality));
      const parsed = parseJsonValue(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new MetingApiError("invalid-response");
      }
      return parsed as Record<string, unknown>;
    });
  }

  private async create(provider: MetingPlatform) {
    const { default: MetingConstructor } = await loadMetingModule();
    return new MetingConstructor(metingPlatformMap[provider]).format(true);
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
