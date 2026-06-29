import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const webSrc = join(__dirname, "../..");

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (entry === ".next" || entry === "node_modules") {
      return [];
    }
    if (statSync(fullPath).isDirectory()) {
      return listSourceFiles(fullPath);
    }
    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

describe("hybrid media and cache playback guard", () => {
  it("keeps realtime media bootstrap separate from cache downloading", () => {
    const files = listSourceFiles(webSrc).map((file) =>
      relative(webSrc, file).replace(/\\/g, "/")
    );

    expect(files).toContain("features/p2p/media-mesh.ts");
    expect(files).toContain("features/room/hooks/use-manual-cache-downloader.ts");
    expect(files).not.toContain("features/room/host-relay-audio.ts");
    expect(files).not.toContain("features/playback/host-media-sync.ts");
    expect(files).not.toContain("features/playback/room-media-clock.ts");
    expect(files).not.toContain("features/playback/silent-prewarm-stream.ts");
  });

  it("does not let the media mesh own piece cache persistence", () => {
    const forbiddenPatterns = [
      "cacheTrackPieces",
      "getCachedPiece",
      "requestPieces",
      "ManualCache"
    ];

    const mediaMeshFile = join(webSrc, "features/p2p/media-mesh.ts");
    const text = readFileSync(mediaMeshFile, "utf8");
    const offenders = forbiddenPatterns.filter((pattern) => text.includes(pattern));

    expect(offenders).toEqual([]);
  });
});
