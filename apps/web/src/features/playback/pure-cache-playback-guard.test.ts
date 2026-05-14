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

describe("pure cache playback guard", () => {
  it("does not keep realtime audio stream implementation files", () => {
    const files = listSourceFiles(webSrc).map((file) =>
      relative(webSrc, file).replace(/\\/g, "/")
    );

    expect(files).not.toContain("features/p2p/media-mesh.ts");
    expect(files).not.toContain("features/room/host-relay-audio.ts");
    expect(files).not.toContain("features/playback/host-media-sync.ts");
    expect(files).not.toContain("features/playback/room-media-clock.ts");
    expect(files).not.toContain("features/playback/silent-prewarm-stream.ts");
  });

  it("does not reference remote stream playback or media mesh runtime code", () => {
    const forbiddenPatterns = [
      "remote-stream",
      "RoomMediaMesh",
      "createRoomMediaMeshRuntime",
      "remoteAudioRef",
      "scheduleRemotePlaybackRetry",
      "syncHostMediaStream",
      "room.media.clock"
    ];

    const offenders = listSourceFiles(webSrc)
      .filter((file) => !file.endsWith("pure-cache-playback-guard.test.ts"))
      .flatMap((file) => {
        const text = readFileSync(file, "utf8");
        return forbiddenPatterns
          .filter((pattern) => text.includes(pattern))
          .map((pattern) => `${relative(webSrc, file).replace(/\\/g, "/")}: ${pattern}`);
      });

    expect(offenders).toEqual([]);
  });
});
