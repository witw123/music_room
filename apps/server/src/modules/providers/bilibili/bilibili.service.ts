import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { BilibiliSearchResponse, BilibiliTrackCandidate, BilibiliVideoDetail } from "@music-room/shared";
import { BilibiliApiClient, type BilibiliSearchItem } from "./bilibili-api.client";

@Injectable()
export class BilibiliService {
  private readonly logger = new Logger(BilibiliService.name);

  constructor(private readonly client: BilibiliApiClient) {}

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
    mimeType: string;
    fileType: string;
    bvid: string;
    cid: number;
  }> {
    const resolvedCid = cid ?? (await this.resolveFirstCid(bvid));
    const playData = await this.client.getPlayUrl(bvid, resolvedCid);

    const audioStreams = playData.dash?.audio ?? [];
    if (audioStreams.length > 0) {
      // 按照 bandwidth / id 降序排序，取最高音质
      const bestAudio = [...audioStreams].sort((a, b) => b.bandwidth - a.bandwidth)[0]!;
      const url = bestAudio.baseUrl || bestAudio.backupUrl?.[0] || "";
      if (!url) {
        throw new NotFoundException(`未能解析到 B 站音频流直链: ${bvid}`);
      }
      return {
        url,
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
    return this.client.fetchAudioStream(resolved.url, range);
  }

  async search(keyword: string, page = 1, pageSize = 20): Promise<BilibiliSearchResponse> {
    const { items, total } = await this.client.searchVideo(keyword, page, pageSize);
    const candidates = items.map((item) => this.mapSearchItemToCandidate(item));
    return {
      items: candidates,
      limit: pageSize,
      offset: (page - 1) * pageSize
    };
  }

  private async resolveFirstCid(bvid: string): Promise<number> {
    const detail = await this.getVideoDetail(bvid);
    const firstCid = detail.pages[0]?.cid;
    if (!firstCid) {
      throw new NotFoundException(`Bilibili 视频不存在有效分P: ${bvid}`);
    }
    return firstCid;
  }

  private mapSearchItemToCandidate(item: BilibiliSearchItem): BilibiliTrackCandidate {
    // B 站搜索结果中的标题通常带 <em class="keyword">周杰伦</em> 标签，需去除
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
