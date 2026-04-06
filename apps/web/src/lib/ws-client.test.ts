import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ioMock = vi.fn(
  (_url: string, _options: Record<string, unknown>) => ({ connected: false })
);

vi.mock("socket.io-client", () => ({
  io: ioMock
}));

describe("createRoomSocket", () => {
  beforeEach(() => {
    vi.resetModules();
    ioMock.mockClear();
    vi.stubGlobal("window", {
      location: {
        protocol: "https:",
        host: "music.example.com"
      },
      localStorage: {
        getItem: vi.fn(() => JSON.stringify({ token: "session-token" }))
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("enables websocket first with polling fallback and tighter reconnect cadence", async () => {
    const { createRoomSocket } = await import("./ws-client");

    createRoomSocket();

    expect(ioMock).toHaveBeenCalledWith(
      "wss://music.example.com",
      expect.objectContaining({
        transports: ["websocket", "polling"],
        auth: { sessionToken: "session-token" },
        reconnection: true,
        reconnectionDelay: 800,
        reconnectionDelayMax: 8000
      })
    );
  });
});
