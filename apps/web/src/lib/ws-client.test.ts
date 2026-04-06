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
      "https://music.example.com",
      expect.objectContaining({
        transports: ["websocket", "polling"],
        auth: { sessionToken: "session-token" },
        reconnection: true,
        reconnectionDelay: 800,
        reconnectionDelayMax: 8000
      })
    );
  });

  it("converts env-provided websocket origins to http origins for socket.io fallback transports", async () => {
    vi.stubEnv("NEXT_PUBLIC_WS_URL", "wss://realtime.example.com/ws");
    const { createRoomSocket } = await import("./ws-client");

    createRoomSocket();

    expect(ioMock).toHaveBeenCalledWith(
      "https://realtime.example.com",
      expect.objectContaining({
        path: "/ws/socket.io"
      })
    );
    vi.unstubAllEnvs();
  });
});
