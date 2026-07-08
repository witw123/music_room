import { beforeEach, describe, expect, it, vi } from "vitest";
import { check } from "@tauri-apps/plugin-updater";
import { getClientPlatformFromBrowser } from "@/lib/client-shell-browser";
import { getDesktopAppVersion, isDesktopRuntime } from "@/lib/desktop-api";
import { checkClientUpdate } from "./client-update-service";

vi.mock("@/lib/client-shell-browser", () => ({
  getClientPlatformFromBrowser: vi.fn(),
  getClientVersionFromBrowser: vi.fn()
}));

vi.mock("@/lib/desktop-api", () => ({
  getDesktopAppVersion: vi.fn(),
  isDesktopRuntime: vi.fn(),
  openDesktopExternal: vi.fn()
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn()
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn()
}));

describe("checkClientUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientPlatformFromBrowser).mockReturnValue("desktop");
    vi.mocked(isDesktopRuntime).mockReturnValue(true);
    vi.mocked(getDesktopAppVersion).mockResolvedValue("0.2.8");
  });

  it("preserves string errors returned by the Tauri updater", async () => {
    const updaterError =
      'None of the fallback platforms ["darwin-aarch64"] were found in the response `platforms` object';
    vi.mocked(check).mockRejectedValue(updaterError);

    const result = await checkClientUpdate("manual");

    expect(result).toEqual({
      status: "failed",
      message: updaterError
    });
  });
});
