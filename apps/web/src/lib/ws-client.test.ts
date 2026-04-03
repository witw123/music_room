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

  it("uses websocket-only transport without transport fallback", async () => {
    const { createRoomSocket } = await import("./ws-client");

    createRoomSocket();

    expect(ioMock).toHaveBeenCalledWith(
      "wss://music.example.com",
      expect.objectContaining({
        transports: ["websocket"],
        auth: { sessionToken: "session-token" },
        reconnection: true
      })
    );
    expect(ioMock.mock.calls[0]?.[1]).not.toHaveProperty("tryAllTransports");
  });
});
