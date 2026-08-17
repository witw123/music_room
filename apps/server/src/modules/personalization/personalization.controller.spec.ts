import { PersonalizationController } from "./personalization.controller";

describe("PersonalizationController", () => {
  const auth = { getAuthSessionByTokenOrThrow: jest.fn().mockResolvedValue({ userId: "user_1" }) };
  const personalization = {
    getProfile: jest.fn().mockResolvedValue({ version: "1" }),
    recordEvent: jest.fn().mockResolvedValue({ ok: true }),
    syncProviders: jest.fn().mockResolvedValue([]),
    getRecommendations: jest.fn().mockResolvedValue({ forYou: [] }),
    recordFeedback: jest.fn().mockResolvedValue({ ok: true }),
    listExclusions: jest.fn().mockResolvedValue([]),
    removeExclusion: jest.fn().mockResolvedValue({ ok: true }),
    clearProfile: jest.fn().mockResolvedValue({ ok: true })
  };
  const controller = new PersonalizationController(personalization as never, auth as never);

  beforeEach(() => jest.clearAllMocks());

  it("records typed playback feedback for the current account", async () => {
    await controller.recordEvent("token", {
      id: "event_1",
      type: "playback",
      track: {
        provider: "netease",
        providerTrackId: "track_1",
        access: "free",
        quality: null,
        title: "Song",
        artist: "Artist",
        album: null,
        durationMs: 180000,
        artworkUrl: null
      },
      listenedMs: 30000,
      occurredAt: "2026-08-17T00:00:00.000Z"
    });
    expect(personalization.recordEvent).toHaveBeenCalledWith("user_1", expect.objectContaining({ type: "playback" }));
  });

  it("passes radio exclusions through the recommendation query", async () => {
    await controller.getRecommendations("token", {
      surface: "radio",
      provider: "netease",
      excludedTrackKeys: "netease:a,netease:b"
    });
    expect(personalization.getRecommendations).toHaveBeenCalledWith("user_1", expect.objectContaining({
      excludedTrackKeys: ["netease:a", "netease:b"]
    }));
  });
});
