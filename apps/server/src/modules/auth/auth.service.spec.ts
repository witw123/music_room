import { AuthService } from "./auth.service";

function createPrismaMock() {
  return {
    isAvailable: jest.fn(() => false),
    guestSessions: {
      upsert: jest.fn(),
      findUnique: jest.fn()
    }
  };
}

describe("AuthService", () => {
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

    await expect(service.assertSessionToken(session.id, session.token)).resolves.toEqual(session);
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
});
