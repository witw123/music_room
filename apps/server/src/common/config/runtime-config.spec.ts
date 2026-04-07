import { validateRuntimeConfig } from "./runtime-config";

describe("validateRuntimeConfig", () => {
  it("allows placeholder secrets outside production", () => {
    expect(() =>
      validateRuntimeConfig({
        NODE_ENV: "development",
        JWT_SECRET: "replace-this-with-a-long-random-secret",
        TURN_ENABLED: "true",
        TURN_SHARED_SECRET: "replace-with-a-turn-shared-secret"
      })
    ).not.toThrow();
  });

  it("rejects placeholder JWT secret in production", () => {
    expect(() =>
      validateRuntimeConfig({
        NODE_ENV: "production",
        JWT_SECRET: "replace-this-with-a-long-random-secret",
        TURN_ENABLED: "false",
        NEXT_PUBLIC_TURN_URL: "turn:static.example.com:3478?transport=udp"
      })
    ).toThrow("Invalid JWT_SECRET for production startup.");
  });

  it("rejects placeholder TURN secret in production when TURN is enabled", () => {
    expect(() =>
      validateRuntimeConfig({
        NODE_ENV: "production",
        JWT_SECRET: "super-secret-jwt",
        TURN_PUBLIC_HOST: "turn.example.com",
        TURN_ENABLED: "true",
        TURN_SHARED_SECRET: "replace-with-a-turn-shared-secret"
      })
    ).toThrow("Invalid TURN_SHARED_SECRET for production startup.");
  });

  it("requires an explicit TURN host or app domain in production when TURN is enabled", () => {
    expect(() =>
      validateRuntimeConfig({
        NODE_ENV: "production",
        JWT_SECRET: "super-secret-jwt",
        TURN_ENABLED: "true",
        TURN_SHARED_SECRET: "super-secret-turn"
      })
    ).toThrow("TURN requires TURN_PUBLIC_HOST or APP_DOMAIN in production startup.");
  });

  it("rejects production startup when TURN is disabled without a static TURN server", () => {
    expect(() =>
      validateRuntimeConfig({
        NODE_ENV: "production",
        JWT_SECRET: "super-secret-jwt",
        TURN_ENABLED: "false"
      })
    ).toThrow("TURN is required for production startup.");
  });

  it("allows production startup with static TURN when ephemeral TURN is disabled", () => {
    expect(() =>
      validateRuntimeConfig({
        NODE_ENV: "production",
        JWT_SECRET: "super-secret-jwt",
        TURN_ENABLED: "false",
        NEXT_PUBLIC_TURN_URL: "turn:static.example.com:3478?transport=udp"
      })
    ).not.toThrow();
  });

  it("allows production startup with static TURN fallback when ephemeral TURN vars are incomplete", () => {
    expect(() =>
      validateRuntimeConfig({
        NODE_ENV: "production",
        JWT_SECRET: "super-secret-jwt",
        TURN_ENABLED: "true",
        NEXT_PUBLIC_WEBRTC_ICE_SERVERS: JSON.stringify([
          { urls: "stun:stun.example.com:19302" },
          { urls: "turn:static.example.com:3478?transport=udp" }
        ])
      })
    ).not.toThrow();
  });

  it("allows valid production secrets", () => {
    expect(() =>
      validateRuntimeConfig({
        NODE_ENV: "production",
        JWT_SECRET: "super-secret-jwt",
        TURN_PUBLIC_HOST: "turn.example.com",
        TURN_ENABLED: "true",
        TURN_SHARED_SECRET: "super-secret-turn"
      })
    ).not.toThrow();
  });
});
