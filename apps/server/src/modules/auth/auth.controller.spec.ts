import { ConflictException, HttpException, HttpStatus, UnauthorizedException } from "@nestjs/common";
import { AuthController } from "./auth.controller";

describe("AuthController", () => {
  const request = {
    ip: "127.0.0.1",
    headers: {} as Record<string, string>,
    socket: { remoteAddress: "127.0.0.1" }
  };

  it("rate limits repeated login attempts by IP and username", async () => {
    const authService = {
      login: jest.fn().mockRejectedValue(new Error("Invalid username or password."))
    };
    const controller = new AuthController(authService as never);

    for (let index = 0; index < 6; index += 1) {
      await expect(
        controller.login({ username: "tester", password: "bad-pass" }, request, "127.0.0.1")
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }

    await expect(
      controller
        .login({ username: "tester", password: "bad-pass" }, request, "127.0.0.1")
        .catch((error: unknown) => {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        })
    ).resolves.toBeUndefined();
  });

  it("rate limits repeated register attempts by IP and username", async () => {
    const authService = {
      register: jest.fn().mockRejectedValue(new Error("Username already exists."))
    };
    const controller = new AuthController(authService as never);

    for (let index = 0; index < 4; index += 1) {
      await expect(
        controller.register(
          { username: "tester", password: "bad-pass", nickname: "Tester" },
          request,
          "127.0.0.1"
        )
      ).rejects.toBeInstanceOf(ConflictException);
    }

    await expect(
      controller
        .register(
          { username: "tester", password: "bad-pass", nickname: "Tester" },
          request,
          "127.0.0.1"
        )
        .catch((error: unknown) => {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        })
    ).resolves.toBeUndefined();
  });

  it("uses trusted request ip instead of spoofable forwarded headers", async () => {
    const authService = {
      login: jest.fn().mockRejectedValue(new Error("Invalid username or password."))
    };
    const controller = new AuthController(authService as never);
    const spoofedRequest = {
      ...request,
      ip: "10.0.0.10",
      headers: {
        "x-forwarded-for": "1.2.3.4",
        "x-real-ip": "5.6.7.8"
      }
    };

    for (let index = 0; index < 12; index += 1) {
      await expect(
        controller.login(
          { username: `tester_${index}`, password: "bad-pass" },
          spoofedRequest,
          "10.0.0.10"
        )
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }

    await expect(
      controller.login(
        { username: "tester_12", password: "bad-pass" },
        spoofedRequest,
        "10.0.0.10"
      )
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS
    });
  });

  it("uses redis counters when redis is available", async () => {
    const authService = {
      login: jest.fn().mockRejectedValue(new Error("Invalid username or password."))
    };
    const redisService = {
      isAvailable: jest.fn(() => true),
      incrementWithTtlMs: jest.fn().mockResolvedValue(1)
    };
    const controller = new AuthController(authService as never, redisService as never);

    await expect(
      controller.login({ username: "tester", password: "bad-pass" }, request, "127.0.0.1")
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(redisService.incrementWithTtlMs).toHaveBeenCalledWith(
      "auth:login:ip:127.0.0.1",
      60_000
    );
    expect(redisService.incrementWithTtlMs).toHaveBeenCalledWith(
      "auth:login:username:tester",
      60_000
    );
  });
});
