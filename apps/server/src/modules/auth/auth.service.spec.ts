import { AuthService } from "./auth.service";

function createPrismaMock() {
  return {
    isAvailable: jest.fn(() => false),
    ensureAvailable: jest.fn(async () => false),
    guestSessions: {
      upsert: jest.fn(),
      findUnique: jest.fn()
    }
  };
}

describe("AuthService", () => {
  afterEach(() => {
    delete process.env.AUTH_FAKE_PERSISTENCE;
    delete process.env.AUTH_FAKE_PERSIST_PATH;
    delete process.env.NODE_ENV;
  });

  it("creates a real random token instead of the placeholder value", async () => {
    const prisma = createPrismaMock();
    const service = new AuthService(prisma as never);

    const session = await service.createGuestSession("Host");

    expect(session.token).not.toBe("replace-with-jwt");
    expect(session.token.length).toBeGreaterThan(20);
  });

  it("accepts the matching session token", async () => {
    const prisma = createPrismaMock();
    const service = new AuthService(prisma as never);

    const session = await service.createGuestSession("Host");

    const { token: _token, ...publicSession } = session;
    await expect(service.assertSessionToken(session.id, session.token)).resolves.toEqual(publicSession);
  });

  it("rejects a missing or invalid session token", async () => {
    const prisma = createPrismaMock();
    const service = new AuthService(prisma as never);

    const session = await service.createGuestSession("Host");

    await expect(service.assertSessionToken(session.id)).rejects.toThrow("Invalid session token.");
    await expect(service.assertSessionToken(session.id, "bad-token")).rejects.toThrow(
      "Invalid session token."
    );
  });

  it("requires a non-empty nickname to create a guest session", async () => {
    const prisma = createPrismaMock();
    const service = new AuthService(prisma as never);

    await expect(service.createGuestSession("   ")).rejects.toThrow("Nickname is required.");
  });

  it("disables fallback account persistence by default in production", async () => {
    process.env.NODE_ENV = "production";

    const prisma = createPrismaMock();
    const service = new AuthService(prisma as never);

    await expect(service.createGuestSession("Host")).rejects.toThrow(
      "Account storage is temporarily unavailable. Please try again after the database is ready."
    );
  });

  it("does not cache a user when the registration transaction fails", async () => {
    const prisma = {
      isAvailable: jest.fn(() => true),
      ensureAvailable: jest.fn(async () => true),
      $transaction: jest.fn().mockRejectedValue(new Error("database write failed")),
      user: {
        findUnique: jest.fn().mockResolvedValue(null)
      }
    };
    const service = new AuthService(prisma as never);

    await expect(service.register({
      username: "tester",
      password: "secret-pass",
      nickname: "Tester"
    })).rejects.toThrow("database write failed");
    await expect(service.login({ username: "tester", password: "secret-pass" }))
      .rejects.toThrow("Invalid username or password.");
  });
});
