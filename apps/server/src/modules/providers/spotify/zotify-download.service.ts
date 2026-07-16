import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { createApiErrorResponse, errorCodes } from "@music-room/shared";
import type { SpotifyQuality } from "./spotify.schemas";

export type ZotifyDownloadResult = {
  filePath: string;
  mimeType: string;
  fileType: string;
  contentLength: number;
  maxBytes: number;
};

type QueueJob<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

const audioExtensions = new Set([".mp3", ".ogg", ".oga", ".m4a", ".flac", ".opus", ".aac"]);
const execFileAsync = promisify(execFile);

@Injectable()
export class ZotifyDownloadService {
  private readonly queue: Array<QueueJob<unknown>> = [];
  private active = false;

  async getAccountReadiness() {
    const credentialsPath = this.credentialsPath();
    const bin = this.zotifyBin();
    const hasDownloadCredentials = await this.fileExists(credentialsPath);
    const hasZotifyBinary = await this.commandLooksAvailable(bin);
    return {
      hasDownloadCredentials,
      hasZotifyBinary,
      credentialsPath,
      zotifyBin: bin
    };
  }

  async openAudio(trackId: string, quality: SpotifyQuality): Promise<ZotifyDownloadResult> {
    const readiness = await this.getAccountReadiness();
    if (!readiness.hasDownloadCredentials) {
      throw new HttpException(
        createApiErrorResponse(
          errorCodes.spotifyAccountRequired,
          "Spotify download credentials are not configured on the server."
        ),
        HttpStatus.CONFLICT
      );
    }
    if (!readiness.hasZotifyBinary) {
      throw new HttpException(
        createApiErrorResponse(
          errorCodes.spotifyUnavailable,
          "Zotify binary is not available on the server."
        ),
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    return this.enqueue(async () => {
      const cached = await this.findCachedAudio(trackId);
      if (cached) {
        return cached;
      }
      return this.downloadTrack(trackId, quality);
    });
  }

  createReadStream(filePath: string) {
    return createReadStream(filePath);
  }

  private async downloadTrack(trackId: string, quality: SpotifyQuality): Promise<ZotifyDownloadResult> {
    const downloadRoot = this.downloadDir();
    const jobDir = path.join(downloadRoot, "jobs", `${trackId}-${Date.now()}`);
    await fs.mkdir(jobDir, { recursive: true });
    await fs.mkdir(downloadRoot, { recursive: true });

    const format = this.downloadFormat();
    const args = [
      "--credentials-location",
      this.credentialsPath(),
      "--root-path",
      jobDir,
      "--output",
      "{track_id}.{ext}",
      "--download-format",
      format,
      "--download-quality",
      this.mapQuality(quality),
      "--download-lyrics",
      "False",
      "--print-downloads",
      "True",
      `https://open.spotify.com/track/${trackId}`
    ];

    try {
      await this.runZotify(args);
      const audioPath = await this.findAudioFile(jobDir);
      if (!audioPath) {
        throw new HttpException(
          createApiErrorResponse(
            errorCodes.spotifyDownloadFailed,
            "Zotify finished without producing an audio file."
          ),
          HttpStatus.BAD_GATEWAY
        );
      }

      const stats = await fs.stat(audioPath);
      if (stats.size > this.maxImportBytes()) {
        throw new HttpException(
          createApiErrorResponse(
            errorCodes.spotifyImportTooLarge,
            "The Spotify audio file is too large."
          ),
          HttpStatus.PAYLOAD_TOO_LARGE
        );
      }

      const extension = path.extname(audioPath).toLowerCase() || `.${format}`;
      const cachePath = path.join(downloadRoot, `${trackId}${extension}`);
      await fs.copyFile(audioPath, cachePath);
      await fs.rm(jobDir, { recursive: true, force: true }).catch(() => undefined);

      return {
        filePath: cachePath,
        mimeType: mimeTypeForExtension(extension),
        fileType: extension.replace(".", "") || format,
        contentLength: stats.size,
        maxBytes: this.maxImportBytes()
      };
    } catch (error) {
      await fs.rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async findCachedAudio(trackId: string): Promise<ZotifyDownloadResult | null> {
    const downloadRoot = this.downloadDir();
    let entries;
    try {
      entries = await fs.readdir(downloadRoot, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.startsWith(`${trackId}.`)) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!audioExtensions.has(extension)) continue;
      const filePath = path.join(downloadRoot, entry.name);
      const stats = await fs.stat(filePath);
      if (stats.size <= 0) continue;
      if (stats.size > this.maxImportBytes()) {
        throw new HttpException(
          createApiErrorResponse(
            errorCodes.spotifyImportTooLarge,
            "The Spotify audio file is too large."
          ),
          HttpStatus.PAYLOAD_TOO_LARGE
        );
      }
      return {
        filePath,
        mimeType: mimeTypeForExtension(extension),
        fileType: extension.replace(".", ""),
        contentLength: stats.size,
        maxBytes: this.maxImportBytes()
      };
    }
    return null;
  }

  private async findAudioFile(dir: string): Promise<string | null> {
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop()!;
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        const extension = path.extname(entry.name).toLowerCase();
        if (audioExtensions.has(extension)) {
          return fullPath;
        }
      }
    }
    return null;
  }

  private runZotify(args: string[]) {
    const bin = this.zotifyBin();
    const timeoutMs = this.jobTimeoutMs();

    return new Promise<void>((resolve, reject) => {
      const child = spawn(bin, args, {
        shell: false,
        windowsHide: true,
        env: { ...process.env }
      });

      let stderr = "";
      let stdout = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(
          new HttpException(
            createApiErrorResponse(
              errorCodes.spotifyDownloadFailed,
              "Zotify download timed out."
            ),
            HttpStatus.GATEWAY_TIMEOUT
          )
        );
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = appendCapped(stdout, chunk.toString("utf8"));
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = appendCapped(stderr, chunk.toString("utf8"));
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(
          new HttpException(
            createApiErrorResponse(
              errorCodes.spotifyUnavailable,
              `Failed to start Zotify: ${error.message}`
            ),
            HttpStatus.SERVICE_UNAVAILABLE
          )
        );
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
          return;
        }
        reject(this.mapProcessFailure(stderr, stdout, code));
      });
    });
  }

  private mapProcessFailure(stderr: string, stdout: string, code: number | null) {
    const combined = `${stderr}\n${stdout}`.toLowerCase();
    if (
      combined.includes("bad credentials") ||
      combined.includes("login failed") ||
      combined.includes("session expired") ||
      combined.includes("unauthorized")
    ) {
      return new HttpException(
        createApiErrorResponse(
          errorCodes.spotifyAuthExpired,
          "Spotify download credentials are invalid or expired."
        ),
        HttpStatus.UNAUTHORIZED
      );
    }
    if (combined.includes("not found") || combined.includes("no tracks")) {
      return new HttpException(
        createApiErrorResponse(errorCodes.spotifyTrackNotFound, "Spotify track was not found."),
        HttpStatus.NOT_FOUND
      );
    }
    return new HttpException(
      createApiErrorResponse(
        errorCodes.spotifyDownloadFailed,
        `Zotify download failed${code === null ? "" : ` (exit ${code})`}.`
      ),
      HttpStatus.BAD_GATEWAY
    );
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        run: run as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject
      });
      void this.pump();
    });
  }

  private async pump() {
    if (this.active) return;
    this.active = true;
    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      try {
        job.resolve(await job.run());
      } catch (error) {
        job.reject(error);
      }
    }
    this.active = false;
  }

  private credentialsPath() {
    return (
      process.env.SPOTIFY_CREDENTIALS_PATH?.trim() ||
      path.resolve(process.cwd(), "data", "spotify", "credentials.json")
    );
  }

  private downloadDir() {
    return (
      process.env.SPOTIFY_DOWNLOAD_DIR?.trim() ||
      path.resolve(process.cwd(), "data", "spotify", "downloads")
    );
  }

  private zotifyBin() {
    return process.env.SPOTIFY_ZOTIFY_BIN?.trim() || "zotify";
  }

  private downloadFormat() {
    const value = process.env.SPOTIFY_DOWNLOAD_FORMAT?.trim().toLowerCase();
    if (
      value === "aac" ||
      value === "fdk_aac" ||
      value === "m4a" ||
      value === "mp3" ||
      value === "ogg" ||
      value === "opus" ||
      value === "vorbis"
    ) {
      return value;
    }
    return "mp3";
  }

  private mapQuality(quality: SpotifyQuality) {
    if (quality === "normal") return "normal";
    if (quality === "very_high") return "very_high";
    return "high";
  }

  private maxImportBytes() {
    const value = Number(process.env.SPOTIFY_MAX_IMPORT_BYTES ?? 209_715_200);
    return Number.isFinite(value) && value > 0 ? value : 209_715_200;
  }

  private jobTimeoutMs() {
    const value = Number(process.env.SPOTIFY_JOB_TIMEOUT_MS ?? 180_000);
    return Number.isFinite(value) && value > 0 ? value : 180_000;
  }

  private async fileExists(filePath: string) {
    try {
      const stats = await fs.stat(filePath);
      return stats.isFile() && stats.size > 0;
    } catch {
      return false;
    }
  }

  private async commandLooksAvailable(bin: string) {
    if (path.isAbsolute(bin) || bin.includes("/") || bin.includes("\\")) {
      return this.fileExists(bin);
    }
    try {
      await execFileAsync(process.platform === "win32" ? "where.exe" : "which", [bin], {
        timeout: 5_000,
        windowsHide: true
      });
      return true;
    } catch {
      return false;
    }
  }
}

function mimeTypeForExtension(extension: string) {
  switch (extension.toLowerCase()) {
    case ".flac":
      return "audio/flac";
    case ".ogg":
    case ".oga":
    case ".opus":
      return "audio/ogg";
    case ".m4a":
    case ".aac":
      return "audio/mp4";
    case ".mp3":
    default:
      return "audio/mpeg";
  }
}

function appendCapped(current: string, next: string, max = 8_000) {
  const combined = `${current}${next}`;
  return combined.length > max ? combined.slice(combined.length - max) : combined;
}
