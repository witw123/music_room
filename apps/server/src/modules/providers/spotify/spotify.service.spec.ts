import { HttpException } from "@nestjs/common";
import { errorCodes } from "@music-room/shared";
import { SpotifyService } from "./spotify.service";
import { SpotifyWebApiClientError } from "./spotify-web-api.client";

describe("SpotifyService", () => {
  const previousEnabled = process.env.SPOTIFY_ENABLED;
  const previousClientId = process.env.SPOTIFY_CLIENT_ID;
  const previousClientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  afterEach(() => {
    if (previousEnabled === undefined) delete process.env.SPOTIFY_ENABLED;
    else process.env.SPOTIFY_ENABLED = previousEnabled;
    if (previousClientId === undefined) delete process.env.SPOTIFY_CLIENT_ID;
    else process.env.SPOTIFY_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.SPOTIFY_CLIENT_SECRET;
    else process.env.SPOTIFY_CLIENT_SECRET = previousClientSecret;
  });

  it("returns disabled error when feature is off", async () => {
    process.env.SPOTIFY_ENABLED = "false";
    const service = new SpotifyService({} as never, {} as never);
    try {
      await service.getAccountStatus("user_1");
      throw new Error("Expected getAccountStatus to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const response = (error as HttpException).getResponse() as { code: string };
      expect(response.code).toBe(errorCodes.spotifyDisabled);
    }
  });

  it("reports server credential readiness", async () => {
    process.env.SPOTIFY_ENABLED = "true";
    process.env.SPOTIFY_CLIENT_ID = "client";
    process.env.SPOTIFY_CLIENT_SECRET = "secret";
    const api = {
      hasClientCredentials: jest.fn().mockReturnValue(true)
    };
    const downloads = {
      getAccountReadiness: jest.fn().mockResolvedValue({
        hasDownloadCredentials: true,
        hasZotifyBinary: true
      })
    };
    const service = new SpotifyService(api as never, downloads as never);
    await expect(service.getAccountStatus("user_1")).resolves.toEqual({
      connected: true,
      mode: "server_credentials",
      hasWebApiCredentials: true,
      hasDownloadCredentials: true,
      hasZotifyBinary: true,
      message: null
    });
  });

  it("maps search results from the web api client", async () => {
    process.env.SPOTIFY_ENABLED = "true";
    process.env.SPOTIFY_CLIENT_ID = "client";
    process.env.SPOTIFY_CLIENT_SECRET = "secret";
    const candidate = {
      provider: "spotify" as const,
      providerTrackId: "3Z0oQ8r78OUaHvGPiDBR3W",
      title: "Song",
      artist: "Artist",
      album: "Album",
      durationMs: 120000,
      artworkUrl: null,
      explicit: false,
      previewUrl: null,
      quality: "high" as const
    };
    const api = {
      hasClientCredentials: jest.fn().mockReturnValue(true),
      searchTracks: jest.fn().mockResolvedValue([candidate])
    };
    const service = new SpotifyService(api as never, {} as never);
    await expect(
      service.searchTracks("user_1", { q: "song", limit: 20, offset: 0 })
    ).resolves.toEqual({
      items: [candidate],
      limit: 20,
      offset: 0
    });
  });

  it("maps not-found errors from the web api", async () => {
    process.env.SPOTIFY_ENABLED = "true";
    process.env.SPOTIFY_CLIENT_ID = "client";
    process.env.SPOTIFY_CLIENT_SECRET = "secret";
    const api = {
      hasClientCredentials: jest.fn().mockReturnValue(true),
      getTrack: jest.fn().mockRejectedValue(new SpotifyWebApiClientError("not-found"))
    };
    const service = new SpotifyService(api as never, {} as never);
    await expect(service.getTrack("user_1", "3Z0oQ8r78OUaHvGPiDBR3W")).rejects.toMatchObject({
      response: expect.objectContaining({ code: errorCodes.spotifyTrackNotFound })
    });
  });

  it("rate limits audio downloads", async () => {
    process.env.SPOTIFY_ENABLED = "true";
    process.env.SPOTIFY_CLIENT_ID = "client";
    process.env.SPOTIFY_CLIENT_SECRET = "secret";
    const api = {
      hasClientCredentials: jest.fn().mockReturnValue(true),
      getTrack: jest.fn().mockResolvedValue({
        provider: "spotify",
        providerTrackId: "3Z0oQ8r78OUaHvGPiDBR3W"
      })
    };
    const downloads = {
      openAudio: jest.fn().mockResolvedValue({
        filePath: "/tmp/a.mp3",
        mimeType: "audio/mpeg",
        fileType: "mp3",
        contentLength: 10,
        maxBytes: 100
      })
    };
    const service = new SpotifyService(api as never, downloads as never);
    await service.openAudio("user_1", "3Z0oQ8r78OUaHvGPiDBR3W", "high");
    await service.openAudio("user_1", "3Z0oQ8r78OUaHvGPiDBR3W", "high");
    await service.openAudio("user_1", "3Z0oQ8r78OUaHvGPiDBR3W", "high");
    await expect(
      service.openAudio("user_1", "3Z0oQ8r78OUaHvGPiDBR3W", "high")
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: errorCodes.rateLimited })
    });
  });
});
