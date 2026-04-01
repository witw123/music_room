import { RealtimeService } from "./realtime.service";

describe("RealtimeService", () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it("returns ephemeral TURN credentials when shared-secret TURN is configured", () => {
    process.env.TURN_ENABLED = "true";
    process.env.TURN_PUBLIC_HOST = "turn.example.com";
    process.env.TURN_SHARED_SECRET = "secret";
    process.env.TURN_PROTOCOLS = "udp,tcp,tls";
    process.env.NEXT_PUBLIC_STUN_URL = "stun:stun.example.com:3478";

    const service = new RealtimeService();
    const result = service.buildIceConfig("user_1");

    expect(result.source).toBe("ephemeral");
    expect(result.iceServers[0]).toEqual({ urls: "stun:stun.example.com:3478" });
    expect(result.iceServers[1]?.username).toMatch(/^\d+:user_1$/);
    expect(result.iceServers[1]?.credential).toBeTruthy();
    expect(result.iceServers[1]?.urls).toEqual(
      expect.arrayContaining([
        "turn:turn.example.com:3478?transport=udp",
        "turn:turn.example.com:3478?transport=tcp",
        "turns:turn.example.com:5349?transport=tcp"
      ])
    );
  });

  it("falls back to static TURN config when shared-secret TURN is unavailable", () => {
    process.env.TURN_ENABLED = "true";
    process.env.NEXT_PUBLIC_STUN_URL = "stun:stun.example.com:3478";
    process.env.NEXT_PUBLIC_TURN_URL = "turn:turn.example.com:3478";
    process.env.NEXT_PUBLIC_TURN_USERNAME = "static-user";
    process.env.NEXT_PUBLIC_TURN_CREDENTIAL = "static-pass";

    const service = new RealtimeService();
    const result = service.buildIceConfig("user_1");

    expect(result.source).toBe("static");
    expect(result.iceServers).toEqual([
      { urls: "stun:stun.example.com:3478" },
      {
        urls: "turn:turn.example.com:3478",
        username: "static-user",
        credential: "static-pass"
      }
    ]);
  });

  it("returns stun-only config when no TURN configuration is available", () => {
    process.env.NEXT_PUBLIC_STUN_URL = "stun:stun.example.com:3478";

    const service = new RealtimeService();
    const result = service.buildIceConfig("user_1");

    expect(result.source).toBe("stun-only");
    expect(result.iceServers).toEqual([{ urls: "stun:stun.example.com:3478" }]);
  });
});
