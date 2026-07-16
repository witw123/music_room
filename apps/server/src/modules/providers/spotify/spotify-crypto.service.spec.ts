import { SpotifyCryptoService } from "./spotify-crypto.service";

describe("SpotifyCryptoService", () => {
  const previousKey = process.env.SPOTIFY_CREDENTIALS_ENCRYPTION_KEY;

  afterEach(() => {
    if (previousKey === undefined) delete process.env.SPOTIFY_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.SPOTIFY_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  });

  it("encrypts and decrypts credentials without exposing plaintext", () => {
    process.env.SPOTIFY_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    const service = new SpotifyCryptoService();
    const encrypted = service.encrypt("spotify-client-secret");

    expect(encrypted).toMatch(/^v1:/);
    expect(encrypted).not.toContain("spotify-client-secret");
    expect(service.decrypt(encrypted)).toBe("spotify-client-secret");
  });

  it("rejects an invalid encryption key", () => {
    process.env.SPOTIFY_CREDENTIALS_ENCRYPTION_KEY = "invalid";
    expect(() => new SpotifyCryptoService().encrypt("secret")).toThrow(
      "SPOTIFY_CREDENTIALS_ENCRYPTION_KEY"
    );
  });
});
