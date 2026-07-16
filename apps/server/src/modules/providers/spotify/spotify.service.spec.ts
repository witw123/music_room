import { HttpException } from "@nestjs/common";
import { errorCodes } from "@music-room/shared";
import { SpotifyService } from "./spotify.service";
import { SpotifyWebApiClientError } from "./spotify-web-api.client";

describe("SpotifyService", () => {
  const previousEnabled = process.env.SPOTIFY_ENABLED;

  afterEach(() => {
    if (previousEnabled === undefined) delete process.env.SPOTIFY_ENABLED;
    else process.env.SPOTIFY_ENABLED = previousEnabled;
  });

  it("returns disabled error when feature is off", async () => {
    process.env.SPOTIFY_ENABLED = "false";
    const service = new SpotifyService({} as never, {} as never, {} as never);
    try {
      await service.getAccountStatus("user_1");
      throw new Error("Expected getAccountStatus to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const response = (error as HttpException).getResponse() as { code: string };
      expect(response.code).toBe(errorCodes.spotifyDisabled);
    }
  });

  it("reports per-user credential readiness", async () => {
    process.env.SPOTIFY_ENABLED = "true";
    const downloads = {
      getAccountReadiness: jest.fn().mockResolvedValue({ hasZotifyBinary: true })
    };
    const accounts = {
      getStatus: jest.fn().mockResolvedValue({
        connected: true,
        mode: "user_credentials",
        hasWebApiCredentials: true,
        hasDownloadCredentials: true,
        hasZotifyBinary: true,
        lastValidatedAt: null,
        message: null
      })
    };
    const service = new SpotifyService({} as never, downloads as never, accounts as never);
    await expect(service.getAccountStatus("user_1")).resolves.toMatchObject({
      connected: true,
      mode: "user_credentials"
    });
    expect(accounts.getStatus).toHaveBeenCalledWith("user_1", true);
  });

  it("maps search results from the per-user web api client", async () => {
    process.env.SPOTIFY_ENABLED = "true";
    const config = { clientId: "client", clientSecret: "secret", credentialsJson: "{}" };
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
    const api = { searchTracks: jest.fn().mockResolvedValue([candidate]) };
    const accounts = { getConfigOrThrow: jest.fn().mockResolvedValue(config) };
    const service = new SpotifyService(api as never, {} as never, accounts as never);
    await expect(
      service.searchTracks("user_1", { q: "song", limit: 20, offset: 0 })
    ).resolves.toEqual({ items: [candidate], limit: 20, offset: 0 });
    expect(api.searchTracks).toHaveBeenCalledWith(config, {
      q: "song",
      limit: 20,
      offset: 0
    });
  });

  it("maps not-found errors from the web api", async () => {
    process.env.SPOTIFY_ENABLED = "true";
    const config = { clientId: "client", clientSecret: "secret", credentialsJson: "{}" };
    const api = {
      getTrack: jest.fn().mockRejectedValue(new SpotifyWebApiClientError("not-found"))
    };
    const accounts = { getConfigOrThrow: jest.fn().mockResolvedValue(config) };
    const service = new SpotifyService(api as never, {} as never, accounts as never);
    await expect(service.getTrack("user_1", "3Z0oQ8r78OUaHvGPiDBR3W")).rejects.toMatchObject({
      response: expect.objectContaining({ code: errorCodes.spotifyTrackNotFound })
    });
  });

  it("rate limits audio downloads", async () => {
    process.env.SPOTIFY_ENABLED = "true";
    const config = { clientId: "client", clientSecret: "secret", credentialsJson: "{}" };
    const api = {
      getTrack: jest.fn().mockResolvedValue({
        provider: "spotify",
        providerTrackId: "3Z0oQ8r78OUaHvGPiDBR3W"
      })
    };
    const accounts = { getConfigOrThrow: jest.fn().mockResolvedValue(config) };
    const downloads = {
      openAudio: jest.fn().mockResolvedValue({
        filePath: "/tmp/a.mp3",
        mimeType: "audio/mpeg",
        fileType: "mp3",
        contentLength: 10,
        maxBytes: 100
      })
    };
    const service = new SpotifyService(api as never, downloads as never, accounts as never);
    await service.openAudio("user_1", "3Z0oQ8r78OUaHvGPiDBR3W", "high");
    await service.openAudio("user_1", "3Z0oQ8r78OUaHvGPiDBR3W", "high");
    await service.openAudio("user_1", "3Z0oQ8r78OUaHvGPiDBR3W", "high");
    await expect(
      service.openAudio("user_1", "3Z0oQ8r78OUaHvGPiDBR3W", "high")
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: errorCodes.rateLimited })
    });
  });

  it("validates credentials JSON before saving", async () => {
    process.env.SPOTIFY_ENABLED = "true";
    const accounts = { saveAccount: jest.fn() };
    const service = new SpotifyService({} as never, {} as never, accounts as never);
    await expect(
      service.saveAccount("user_1", {
        clientId: "id",
        clientSecret: "secret",
        credentialsJson: "not-json"
      })
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: errorCodes.validationFailed })
    });
    expect(accounts.saveAccount).not.toHaveBeenCalled();
  });
});
