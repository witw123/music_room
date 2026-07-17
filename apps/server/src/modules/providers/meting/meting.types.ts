import type { MetingProvider } from "@music-room/shared";

export type MetingPlatform = MetingProvider;
export type MetingQuality = "standard" | "high" | "exhigh";

export type MetingSearchQuery = {
  keywords: string;
  limit: number;
  offset: number;
};

export const metingPlatformMap: Record<MetingPlatform, string> = {
  qqmusic: "tencent",
  kugou: "kugou",
  kuwo: "kuwo",
  taihe: "baidu",
  migu: "migu",
  baidu: "baidu"
};
