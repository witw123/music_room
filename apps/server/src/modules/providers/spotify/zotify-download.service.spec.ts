import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { errorCodes } from "@music-room/shared";
import { ZotifyDownloadService } from "./zotify-download.service";

describe("ZotifyDownloadService", () => {
  const previous = {
    downloadDir: process.env.SPOTIFY_DOWNLOAD_DIR,
    bin: process.env.SPOTIFY_ZOTIFY_BIN,
    maxBytes: process.env.SPOTIFY_MAX_IMPORT_BYTES
  };
  const config = { clientId: "id", clientSecret: "secret", credentialsJson: "{}" };
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zotify-test-"));
    process.env.SPOTIFY_DOWNLOAD_DIR = path.join(tempDir, "downloads");
    process.env.SPOTIFY_ZOTIFY_BIN = path.join(tempDir, "missing-zotify");
    process.env.SPOTIFY_MAX_IMPORT_BYTES = "1024";
  });

  afterEach(async () => {
    if (previous.downloadDir === undefined) delete process.env.SPOTIFY_DOWNLOAD_DIR;
    else process.env.SPOTIFY_DOWNLOAD_DIR = previous.downloadDir;
    if (previous.bin === undefined) delete process.env.SPOTIFY_ZOTIFY_BIN;
    else process.env.SPOTIFY_ZOTIFY_BIN = previous.bin;
    if (previous.maxBytes === undefined) delete process.env.SPOTIFY_MAX_IMPORT_BYTES;
    else process.env.SPOTIFY_MAX_IMPORT_BYTES = previous.maxBytes;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("reports unavailable when Zotify is missing", async () => {
    const service = new ZotifyDownloadService();
    await expect(
      service.openAudio("user_1", config, "3Z0oQ8r78OUaHvGPiDBR3W", "high")
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: errorCodes.spotifyUnavailable })
    });
  });

  it("serves cached audio from the current user's directory", async () => {
    const userDir = path.join(process.env.SPOTIFY_DOWNLOAD_DIR!, "user_1");
    await fs.mkdir(userDir, { recursive: true });
    const cachePath = path.join(userDir, "3Z0oQ8r78OUaHvGPiDBR3W.mp3");
    await fs.writeFile(cachePath, Buffer.alloc(32, 1));
    process.env.SPOTIFY_ZOTIFY_BIN = process.execPath;

    const service = new ZotifyDownloadService();
    const result = await service.openAudio("user_1", config, "3Z0oQ8r78OUaHvGPiDBR3W", "high");
    expect(result.filePath).toBe(cachePath);
    expect(result.mimeType).toBe("audio/mpeg");
    expect(result.contentLength).toBe(32);
  });
});
