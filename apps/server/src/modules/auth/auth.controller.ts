import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
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
      throw new BadRequestException(error instanceof Error ? error.message : "Invalid payload.");
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
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
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
