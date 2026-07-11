import { createHmac } from "node:crypto";

jest.mock("@music-room/shared", () => ({
  iceConfigResponseSchema: {
    parse: (value: unknown) => value,
    shape: {
      iceServers: {
        safeParse: (value: unknown) => ({ success: true, data: value })
      }
    }
  }
}));

import { RealtimeService } from "./realtime.service";

describe("RealtimeService", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-04-01T00:00:00.000Z"));
    process.env = {
      ...envBackup,
      TURN_PORT: "3478",
      TURN_TLS_PORT: "5349",
      TURN_PROTOCOLS: "tcp,udp,tls",
      TURN_TTL_SECONDS: "3600",
      NEXT_PUBLIC_STUN_URL: "stun:stun.example.com:3478"
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = { ...envBackup };
  });

  it("builds ephemeral ICE config when TURN host and secret are available", () => {
    process.env.TURN_ENABLED = "true";
    process.env.TURN_PUBLIC_HOST = "turn.example.com";
    process.env.TURN_SHARED_SECRET = "turn-secret";
    const service = new RealtimeService();

    const config = service.buildIceConfig("user_1");
    const expiry = Math.floor(new Date("2026-04-01T00:00:00.000Z").getTime() / 1000) + 3600;
    const username = `${expiry}:user_1`;
    const credential = createHmac("sha1", "turn-secret").update(username).digest("base64");

    expect(config).toEqual({
      source: "ephemeral",
      ttlSeconds: 3600,
      iceServers: [
        { urls: "stun:stun.example.com:3478" },
        {
          urls: [
            "turn:turn.example.com:3478?transport=udp"
          ],
          username,
          credential
        }
      ]
    });
  });

  it("does not expose localhost TURN URLs in production when a public request host is available", () => {
    process.env.NODE_ENV = "production";
    process.env.TURN_ENABLED = "true";
    process.env.TURN_PUBLIC_HOST = "localhost";
    delete process.env.APP_DOMAIN;
    process.env.TURN_SHARED_SECRET = "turn-secret";
    const service = new RealtimeService();

    const config = service.buildIceConfig("user_1", {
      requestHost: "musicroom.witw.top"
    });

    expect(config.source).toBe("ephemeral");
    expect(config.iceServers[1]).toMatchObject({
      urls: expect.arrayContaining(["turn:musicroom.witw.top:3478?transport=udp"])
    });
  });

  it("derives turn host from APP_DOMAIN when explicit TURN host is missing", () => {
    process.env.TURN_ENABLED = "true";
    delete process.env.TURN_PUBLIC_HOST;
    process.env.APP_DOMAIN = "example.com";
    process.env.TURN_SHARED_SECRET = "turn-secret";
    const service = new RealtimeService();

    const config = service.buildIceConfig("user_1");

    expect(config.source).toBe("ephemeral");
    expect(config.iceServers[1]).toMatchObject({
      urls: expect.arrayContaining(["turn:turn.example.com:3478?transport=udp"])
    });
  });

  it("uses the request host as a last-resort TURN host", () => {
    process.env.TURN_ENABLED = "true";
    delete process.env.TURN_PUBLIC_HOST;
    delete process.env.APP_DOMAIN;
    delete process.env.TURN_PUBLIC_HOST_USE_REQUEST_HOST;
    process.env.TURN_SHARED_SECRET = "turn-secret";
    const service = new RealtimeService();

    const config = service.buildIceConfig("user_1", { requestHost: "example.com:3001" });

    expect(config.source).toBe("ephemeral");
    expect(config.iceServers[1]).toMatchObject({
      urls: expect.arrayContaining(["turn:example.com:3478?transport=udp"])
    });
  });

  it("can derive turn host from the request host when explicitly enabled", () => {
    process.env.TURN_ENABLED = "true";
    delete process.env.TURN_PUBLIC_HOST;
    delete process.env.APP_DOMAIN;
    process.env.TURN_PUBLIC_HOST_USE_REQUEST_HOST = "1";
    process.env.TURN_SHARED_SECRET = "turn-secret";
    const service = new RealtimeService();

    const config = service.buildIceConfig("user_1", { requestHost: "example.com:3001" });

    expect(config.source).toBe("ephemeral");
    expect(config.iceServers[1]).toMatchObject({
      urls: expect.arrayContaining(["turn:example.com:3478?transport=udp"])
    });
  });

  it("falls back to static ICE servers when TURN credentials are unavailable but static TURN is configured", () => {
    process.env.TURN_ENABLED = "true";
    delete process.env.TURN_PUBLIC_HOST;
    delete process.env.APP_DOMAIN;
    delete process.env.TURN_SHARED_SECRET;
    process.env.NEXT_PUBLIC_TURN_URL = "turn:static.example.com:3478?transport=udp";
    process.env.NEXT_PUBLIC_TURN_USERNAME = "static-user";
    process.env.NEXT_PUBLIC_TURN_CREDENTIAL = "static-password";
    const service = new RealtimeService();

    const config = service.buildIceConfig("user_1");

    expect(config).toEqual({
      source: "static",
      ttlSeconds: 3600,
      iceServers: [
        { urls: "stun:stun.example.com:3478" },
        {
          urls: "turn:static.example.com:3478?transport=udp",
          username: "static-user",
          credential: "static-password"
        }
      ]
    });
  });

  it("falls back to stun-only when TURN is unavailable and no static TURN exists", () => {
    process.env.TURN_ENABLED = "true";
    delete process.env.TURN_PUBLIC_HOST;
    delete process.env.APP_DOMAIN;
    delete process.env.TURN_SHARED_SECRET;
    delete process.env.NEXT_PUBLIC_TURN_URL;
    const service = new RealtimeService();

    const config = service.buildIceConfig("user_1");

    expect(config).toEqual({
      source: "stun-only",
      ttlSeconds: 3600,
      iceServers: [{ urls: "stun:stun.example.com:3478" }]
    });
  });

  it("rejects stun-only ICE config in production", () => {
    process.env.NODE_ENV = "production";
    process.env.TURN_ENABLED = "true";
    delete process.env.TURN_PUBLIC_HOST;
    delete process.env.APP_DOMAIN;
    delete process.env.TURN_SHARED_SECRET;
    delete process.env.NEXT_PUBLIC_TURN_URL;
    const service = new RealtimeService();

    expect(() => service.buildIceConfig("user_1")).toThrow(
      "TURN is required to build ICE config in production."
    );
  });

  it("returns static ICE servers when TURN is disabled but explicit static servers exist", () => {
    process.env.TURN_ENABLED = "false";
    process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS = JSON.stringify([
      { urls: "stun:stun.example.com:3478" },
      {
        urls: ["turn:static.example.com:3478?transport=udp"],
        username: "user",
        credential: "pass"
      }
    ]);
    const service = new RealtimeService();

    const config = service.buildIceConfig("user_1");

    expect(config.source).toBe("static");
    expect(config.iceServers).toHaveLength(2);
  });
});
