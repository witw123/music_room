import { describe, expect, it, vi } from "vitest";

describe("runtime endpoint fallbacks", () => {
  it("falls back to the current page origin for API requests", async () => {
    vi.resetModules();
    vi.stubGlobal("window", {
      location: {
        origin: "https://witw.top",
        protocol: "https:",
        host: "witw.top"
      }
    });

    const module = await import("./api-client");
    expect(module.apiBaseUrl).toBe("https://witw.top");
  });

  it("falls back to a matching same-origin websocket endpoint", async () => {
    vi.resetModules();
    vi.stubGlobal("window", {
      location: {
        origin: "https://witw.top",
        protocol: "https:",
        host: "witw.top"
      },
      localStorage: {
        getItem: vi.fn(() => null)
      }
    });

    const module = await import("./ws-client");
    expect(module.wsBaseUrl).toBe("wss://witw.top");
  });
});
