import { describe, expect, it } from "vitest";
import {
  compareReleaseVersions,
  isNewerReleaseVersion,
  normalizeReleaseVersion
} from "./update-version";

describe("update version helpers", () => {
  it("normalizes GitHub tag names into comparable release versions", () => {
    expect(normalizeReleaseVersion("v0.2.8")).toBe("0.2.8");
    expect(normalizeReleaseVersion("  1.10.0  ")).toBe("1.10.0");
    expect(normalizeReleaseVersion("release-0.2.8")).toBeNull();
  });

  it("compares release versions by numeric major minor and patch segments", () => {
    expect(compareReleaseVersions("0.2.10", "0.2.9")).toBeGreaterThan(0);
    expect(compareReleaseVersions("0.3.0", "0.2.99")).toBeGreaterThan(0);
    expect(compareReleaseVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareReleaseVersions("0.2.8", "0.2.8")).toBe(0);
    expect(compareReleaseVersions("0.2.7", "0.2.8")).toBeLessThan(0);
  });

  it("treats invalid versions as not newer", () => {
    expect(isNewerReleaseVersion("0.2.8", "v0.2.9")).toBe(true);
    expect(isNewerReleaseVersion("0.2.8", "v0.2.8")).toBe(false);
    expect(isNewerReleaseVersion("0.2.8", "latest")).toBe(false);
  });
});
