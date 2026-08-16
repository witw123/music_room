import { UnauthorizedException } from "@nestjs/common";
import { RecommendationsController } from "./recommendations.controller";

describe("RecommendationsController", () => {
  it("requires the existing session token and forwards the validated query", async () => {
    const recommendations = {
      getLastFmSimilarTracks: jest.fn().mockResolvedValue({ items: [] })
    };
    const auth = {
      getAuthSessionByTokenOrThrow: jest.fn().mockResolvedValue({ userId: "user_1" })
    };
    const controller = new RecommendationsController(recommendations as never, auth as never);

    await expect(controller.getLastFmSimilarTracks({
      artist: "Artist",
      track: "Track",
      limit: "20"
    }, "token")).resolves.toEqual({ items: [] });
    expect(recommendations.getLastFmSimilarTracks).toHaveBeenCalledWith("user_1", {
      artist: "Artist",
      track: "Track",
      limit: 20
    });
  });

  it("rejects requests without a valid session", async () => {
    const auth = {
      getAuthSessionByTokenOrThrow: jest.fn().mockRejectedValue(new Error("Session expired."))
    };
    const controller = new RecommendationsController({} as never, auth as never);

    await expect(controller.getLastFmSimilarTracks({
      artist: "Artist",
      track: "Track"
    }, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
