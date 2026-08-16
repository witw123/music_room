import { HttpStatus } from "@nestjs/common";
import { errorCodes } from "@music-room/shared";
import { fetchProviderUrl } from "../providers/provider-fetch";
import { RecommendationsService } from "./recommendations.service";

jest.mock("../providers/provider-fetch", () => ({
  fetchProviderUrl: jest.fn()
}));

const mockedFetchProviderUrl = fetchProviderUrl as jest.MockedFunction<typeof fetchProviderUrl>;
const input = { artist: "Seed Artist", track: "Seed Track", limit: 100 };

describe("RecommendationsService", () => {
  const previousApiKey = process.env.LASTFM_API_KEY;

  afterEach(() => {
    mockedFetchProviderUrl.mockReset();
    if (previousApiKey === undefined) delete process.env.LASTFM_API_KEY;
    else process.env.LASTFM_API_KEY = previousApiKey;
  });

  it("normalizes Last.fm tracks and tags without returning the API key", async () => {
    process.env.LASTFM_API_KEY = "private-key";
    mockedFetchProviderUrl
      .mockResolvedValueOnce(jsonResponse({
        similartracks: {
          track: [
            { name: "Lower", artist: { name: "Artist B" }, match: "0.4" },
            { name: "Higher", artist: { name: "Artist A" }, match: "0.9" },
            { name: "Higher", artist: { name: "Artist A" }, match: "0.9" }
          ]
        }
      }))
      .mockResolvedValueOnce(jsonResponse({
        toptags: {
          tag: [
            { name: "rock", count: 50 },
            { name: "pop", count: "100" },
            { name: "pop", count: "90" }
          ]
        }
      }));
    const service = new RecommendationsService();

    await expect(service.getLastFmSimilarTracks("user_1", input)).resolves.toEqual({
      seed: { title: "Seed Track", artist: "Seed Artist" },
      tags: [
        { name: "pop", weight: 100 },
        { name: "rock", weight: 50 }
      ],
      items: [
        { title: "Higher", artist: "Artist A", match: 0.9 },
        { title: "Lower", artist: "Artist B", match: 0.4 }
      ]
    });

    const url = mockedFetchProviderUrl.mock.calls[0]?.[0];
    expect(url?.hostname).toBe("ws.audioscrobbler.com");
    expect(url?.searchParams.get("method")).toBe("track.getSimilar");
    expect(url?.searchParams.get("api_key")).toBe("private-key");
  });

  it("keeps similar-track results when tags cannot be loaded", async () => {
    process.env.LASTFM_API_KEY = "private-key";
    mockedFetchProviderUrl
      .mockResolvedValueOnce(jsonResponse({
        similartracks: { track: [{ name: "Similar", artist: { name: "Artist" }, match: "0.8" }] }
      }))
      .mockRejectedValueOnce(new Error("tags unavailable"));
    const service = new RecommendationsService();

    await expect(service.getLastFmSimilarTracks("user_1", input)).resolves.toMatchObject({
      tags: [],
      items: [{ title: "Similar", artist: "Artist", match: 0.8 }]
    });
  });

  it("returns a stable unavailable error without a configured key", async () => {
    delete process.env.LASTFM_API_KEY;
    const service = new RecommendationsService();

    await expect(service.getLastFmSimilarTracks("user_1", input)).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      response: expect.objectContaining({ code: errorCodes.recommendationUnavailable })
    });
    expect(mockedFetchProviderUrl).not.toHaveBeenCalled();
  });

  it("maps upstream failures to the recommendation unavailable contract", async () => {
    process.env.LASTFM_API_KEY = "private-key";
    mockedFetchProviderUrl.mockRejectedValueOnce(new Error("offline"));
    const service = new RecommendationsService();

    await expect(service.getLastFmSimilarTracks("user_1", input)).rejects.toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
      response: expect.objectContaining({ code: errorCodes.recommendationUnavailable })
    });
  });

  it("limits Last.fm requests per signed-in user", async () => {
    process.env.LASTFM_API_KEY = "private-key";
    mockedFetchProviderUrl.mockImplementation(async (url) => {
      const method = url.searchParams.get("method");
      return jsonResponse(method === "track.getSimilar"
        ? { similartracks: { track: [] } }
        : { toptags: { tag: [] } });
    });
    const service = new RecommendationsService();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await expect(service.getLastFmSimilarTracks("user_1", input)).resolves.toBeDefined();
    }
    await expect(service.getLastFmSimilarTracks("user_1", input)).rejects.toMatchObject({
      response: expect.objectContaining({ code: errorCodes.rateLimited })
    });
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
