import { describe, expect, it } from "vitest";
import { lastFmSimilarTracksResponseSchema } from "./models";

describe("Last.fm recommendation contracts", () => {
  it("limits normalized responses to the public recommendation shape", () => {
    expect(lastFmSimilarTracksResponseSchema.parse({
      seed: { title: "Seed", artist: "Artist" },
      tags: [{ name: "pop", weight: 100 }],
      items: [{ title: "Similar", artist: "Other", match: 0.87 }]
    })).toEqual({
      seed: { title: "Seed", artist: "Artist" },
      tags: [{ name: "pop", weight: 100 }],
      items: [{ title: "Similar", artist: "Other", match: 0.87 }]
    });
  });
});
