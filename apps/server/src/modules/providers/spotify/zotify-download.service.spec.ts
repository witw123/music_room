import { HttpException } from "@nestjs/common";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { errorCodes } from "@music-room/shared";
import { ZotifyDownloadService } from "./zotify-download.service";

describe("ZotifyDownloadService", () => {
  const previous = {
    credentials: process.env.SPOTIFY_CREDENTIALS_PATH,
    downloadDir: process.env.SPOTIFY_DOWNLOAD_DIR,
    bin: process.env.SPOTIFY_ZOTIFY_BIN,
    maxBytes: process.env.SPOTIFY_MAX_IMPORT_BYTES
  };

  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zotify-test-"));
    process.env.SPOTIFY_CREDENTIALS_PATH = path.join(tempDir, "credentials.json");
    process.env.SPOTIFY_DOWNLOAD_DIR = path.join(tempDir, "downloads");
    process.env.SPOTIFY_ZOTIFY_BIN = process.execPath;
    process.env.SPOTIFY_MAX_IMPORT_BYTES = "1024";
  });

  afterEach(async () => {
    if (previous.credentials === undefined) delete process.env.SPOTIFY_CREDENTIALS_PATH;
    else process.env.SPOTIFY_CREDENTIALS_PATH = previous.credentials;
    if (previous.downloadDir === undefined) delete process.env.SPOTIFY_DOWNLOAD_DIR;
    else process.env.SPOTIFY_DOWNLOAD_DIR = previous.downloadDir;
    if (previous.bin === undefined) delete process.env.SPOTIFY_ZOTIFY_BIN;
    else process.env.SPOTIFY_ZOTIFY_BIN = previous.bin;
    if (previous.maxBytes === undefined) delete process.env.SPOTIFY_MAX_IMPORT_BYTES;
    else process.env.SPOTIFY_MAX_IMPORT_BYTES = previous.maxBytes;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("requires credentials before downloading", async () => {
    const service = new ZotifyDownloadService();
    try {
      await service.openAudio("3Z0oQ8r78OUaHvGPiDBR3W", "high");
      throw new Error("Expected openAudio to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const response = (error as HttpException).getResponse() as { code: string };
      expect(response.code).toBe(errorCodes.spotifyAccountRequired);
    }
  });

  it("serves cached audio when present", async () => {
    await fs.writeFile(process.env.SPOTIFY_CREDENTIALS_PATH!, '{"ok":true}');
    await fs.mkdir(process.env.SPOTIFY_DOWNLOAD_DIR!, { recursive: true });
    const cachePath = path.join(process.env.SPOTIFY_DOWNLOAD_DIR!, "3Z0oQ8r78OUaHvGPiDBR3W.mp3");
    await fs.writeFile(cachePath, Buffer.alloc(32, 1));

    const service = new ZotifyDownloadService();
    const result = await service.openAudio("3Z0oQ8r78OUaHvGPiDBR3W", "high");
    expect(result.filePath).toBe(cachePath);
    expect(result.mimeType).toBe("audio/mpeg");
    expect(result.contentLength).toBe(32);
  });
});
