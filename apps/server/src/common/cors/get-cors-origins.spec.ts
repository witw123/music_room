import { getRequestOrigin, isAllowedOrigin } from "./get-cors-origins";

describe("origin validation", () => {
  it("accepts the exact same origin reported by the reverse proxy", () => {
    const requestOrigin = getRequestOrigin({
      protocol: "http",
      get: (header) => {
        if (header === "host") return "music-room.invalid";
        if (header === "x-forwarded-proto") return "https";
        return undefined;
      }
    });

    expect(requestOrigin).toBe("https://music-room.invalid");
    expect(isAllowedOrigin("https://music-room.invalid", requestOrigin, [])).toBe(true);
  });

  it("normalizes configured origins but rejects another host", () => {
    expect(isAllowedOrigin("https://admin.invalid/", null, ["https://admin.invalid"])).toBe(true);
    expect(isAllowedOrigin("https://attacker.invalid", "https://music-room.invalid", [])).toBe(false);
  });
});
