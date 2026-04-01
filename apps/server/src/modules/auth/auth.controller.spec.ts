import { ConflictException, HttpException, HttpStatus, UnauthorizedException } from "@nestjs/common";
import { AuthController } from "./auth.controller";

describe("AuthController", () => {
  const request = {
    ip: "127.0.0.1",
    headers: {},
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
});
