import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import type {
  AlistAudioItem,
  AlistFileItem,
  AlistListResponse,
  AlistTestResponse
} from "@music-room/shared";

const AUDIO_EXTENSIONS = new Set([
  ".flac",
  ".mp3",
  ".wav",
  ".m4a",
  ".ogg",
  ".aac",
  ".opus",
  ".ape",
  ".dsf",
  ".dff"
]);

@Injectable()
export class AlistService {
  private readonly logger = new Logger(AlistService.name);

  async testConnection(
    baseUrl: string,
    mountPath: string,
    token?: string
  ): Promise<AlistTestResponse> {
    try {
      const normalizedUrl = baseUrl.replace(/\/+$/, "");
      const res = await this.callAlistApi(normalizedUrl, "/api/fs/list", {
        path: mountPath || "/",
        page: 1,
        per_page: 1,
        refresh: true
      }, token);

      if (res.code === 200) {
        return { ok: true, message: "Alist 服务连接成功，目录可正常访问。" };
      }
      return { ok: false, message: `Alist 响应错误 (${res.code}): ${res.message}` };
    } catch (err) {
      return {
        ok: false,
        message: `无法连接到 Alist 服务: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }

  async listDirectory(
    baseUrl: string,
    dirPath: string,
    page = 1,
    perPage = 100,
    refresh = false,
    token?: string
  ): Promise<AlistListResponse> {
    const normalizedUrl = baseUrl.replace(/\/+$/, "");
    const normalizedPath = dirPath.startsWith("/") ? dirPath : `/${dirPath}`;

    const res = await this.callAlistApi(normalizedUrl, "/api/fs/list", {
      path: normalizedPath,
      page,
      per_page: perPage,
      refresh
    }, token);

    if (res.code !== 200) {
      throw new HttpException(
        `Alist 目录读取失败 (${res.code}): ${res.message}`,
        HttpStatus.BAD_GATEWAY
      );
    }

    const content: AlistFileItem[] = res.data?.content ?? [];
    const directories: string[] = [];
    const audioFiles: AlistFileItem[] = [];
    const lrcFileNames = new Set<string>();

    for (const item of content) {
      if (item.isDir) {
        directories.push(item.name);
        continue;
      }

      const lowerName = item.name.toLowerCase();
      if (lowerName.endsWith(".lrc")) {
        // 记录歌词文件名（不含扩展名）
        lrcFileNames.add(item.name.slice(0, -4).toLowerCase());
        continue;
      }

      const dotIndex = lowerName.lastIndexOf(".");
      if (dotIndex > 0) {
        const ext = lowerName.slice(dotIndex);
        if (AUDIO_EXTENSIONS.has(ext)) {
          audioFiles.push(item);
        }
      }
    }

    const items: AlistAudioItem[] = audioFiles.map((file) => {
      const dotIndex = file.name.lastIndexOf(".");
      const baseName = dotIndex > 0 ? file.name.slice(0, dotIndex) : file.name;
      const ext = dotIndex > 0 ? file.name.slice(dotIndex + 1).toLowerCase() : "";

      // 尝试按 "歌手 - 歌名" 格式拆分
      let artist = "未知歌手";
      let title = baseName;
      if (baseName.includes(" - ")) {
        const parts = baseName.split(" - ");
        artist = parts[0]?.trim() || "未知歌手";
        title = parts.slice(1).join(" - ").trim() || baseName;
      }

      const cleanDirPath = normalizedPath.endsWith("/")
        ? normalizedPath.slice(0, -1)
        : normalizedPath;
      const filePath = `${cleanDirPath}/${file.name}`;

      const hasLrc = lrcFileNames.has(baseName.toLowerCase());
      const lrcPath = hasLrc ? `${cleanDirPath}/${baseName}.lrc` : null;

      return {
        path: filePath,
        name: file.name,
        title,
        artist,
        album: null,
        sizeBytes: file.size,
        ext,
        lrcPath
      };
    });

    return {
      total: res.data?.total ?? items.length,
      items,
      directories,
      currentPath: normalizedPath
    };
  }

  async getFileDetail(
    baseUrl: string,
    filePath: string,
    token?: string
  ): Promise<{ rawUrl: string; size: number; name: string }> {
    const normalizedUrl = baseUrl.replace(/\/+$/, "");
    const normalizedPath = filePath.startsWith("/") ? filePath : `/${filePath}`;

    const res = await this.callAlistApi(normalizedUrl, "/api/fs/get", {
      path: normalizedPath
    }, token);

    if (res.code !== 200 || !res.data?.raw_url) {
      throw new HttpException(
        `获取 Alist 文件直链失败 (${res.code}): ${res.message || "未返回直链"}`,
        HttpStatus.BAD_GATEWAY
      );
    }

    return {
      rawUrl: res.data.raw_url,
      size: res.data.size ?? 0,
      name: res.data.name ?? ""
    };
  }

  async fetchAudioStream(
    rawUrl: string,
    range?: string
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    body: ReadableStream<Uint8Array> | null;
  }> {
    const headers: Record<string, string> = {
      "User-Agent": "MusicRoom/1.0 (Alist Stream Client)"
    };
    if (range) {
      headers.Range = range;
    }

    const res = await fetch(rawUrl, { headers });
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

  private async callAlistApi(
    baseUrl: string,
    endpoint: string,
    body: Record<string, unknown>,
    token?: string
  ): Promise<{ code: number; message: string; data?: unknown }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (token) {
      headers.Authorization = token;
    }

    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw new Error(`Alist HTTP 响应异常: ${res.status} ${res.statusText}`);
    }

    return res.json() as Promise<{ code: number; message: string; data?: unknown }>;
  }
}
