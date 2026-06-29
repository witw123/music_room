import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
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

describe("pure original-piece playback guard", () => {
  it("keeps legacy remote media stream playback out of the room runtime", () => {
    const files = listSourceFiles(webSrc).map((file) =>
      relative(webSrc, file).replace(/\\/g, "/")
    );

    expect(files).not.toContain("features/p2p/media-mesh.ts");
    expect(files).not.toContain("features/room/hooks/use-room-media-mesh.ts");
    expect(files).toContain("features/room/hooks/use-manual-cache-downloader.ts");
    expect(files).not.toContain("features/room/host-relay-audio.ts");
    expect(files).not.toContain("features/playback/host-media-sync.ts");
    expect(files).not.toContain("features/playback/room-media-clock.ts");
    expect(files).not.toContain("features/playback/silent-prewarm-stream.ts");
  });
});
