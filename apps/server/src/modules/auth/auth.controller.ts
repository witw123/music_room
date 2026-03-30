import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Post,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { AuthService } from "./auth.service";

@Controller("v1/auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  async register(
    @Body() body: { username?: string; password?: string; nickname?: string }
  ) {
    try {
      return await this.authService.register({
        username: body.username ?? "",
        password: body.password ?? "",
        nickname: body.nickname ?? ""
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid payload.";
      if (message.includes("Username already exists")) {
        throw new ConflictException(message);
      }
      if (message.includes("Account storage is temporarily unavailable")) {
        throw new ServiceUnavailableException(message);
      }
      throw new BadRequestException(message);
    }
  }

  @Post("login")
  async login(@Body() body: { username?: string; password?: string }) {
    try {
      return await this.authService.login({
        username: body.username ?? "",
        password: body.password ?? ""
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unauthorized.";
      if (message.includes("Account storage is temporarily unavailable")) {
        throw new ServiceUnavailableException(message);
      }
      throw new UnauthorizedException(message);
    }
  }

  @Post("logout")
  async logout(@Headers("x-session-token") sessionToken: string | undefined) {
    return this.authService.logout(sessionToken);
  }

  @Get("me")
  async me(@Headers("x-session-token") sessionToken: string | undefined) {
    try {
      return await this.authService.getAuthSessionByTokenOrThrow(sessionToken);
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }
}
