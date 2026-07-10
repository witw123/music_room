import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./CacheTabPanel.tsx", import.meta.url), "utf8");

describe("CacheTabPanel appearance", () => {
  it("keeps the native search control dark in browser and WebView shells", () => {
    expect(source).toContain("bg-[#0d0d10]");
    expect(source).toContain("[color-scheme:dark]");
    expect(source).not.toContain("bg-background/50");
  });
});
