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
        TURN_ENABLED: "false"
      })
    ).toThrow("Invalid JWT_SECRET for production startup.");
  });

  it("rejects placeholder TURN secret in production when TURN is enabled", () => {
    expect(() =>
      validateRuntimeConfig({
        NODE_ENV: "production",
        JWT_SECRET: "super-secret-jwt",
        TURN_ENABLED: "true",
        TURN_SHARED_SECRET: "replace-with-a-turn-shared-secret"
      })
    ).toThrow("Invalid TURN_SHARED_SECRET for production startup.");
  });

  it("allows valid production secrets", () => {
    expect(() =>
      validateRuntimeConfig({
        NODE_ENV: "production",
        JWT_SECRET: "super-secret-jwt",
        TURN_ENABLED: "true",
        TURN_SHARED_SECRET: "super-secret-turn"
      })
    ).not.toThrow();
  });
});
