import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";

@Controller("v1/guest-sessions")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post()
  async createGuestSession(@Body() body: { nickname?: string }) {
    const nickname = body.nickname?.trim();
    if (!nickname) {
      throw new BadRequestException("Nickname is required.");
    }

    return this.authService.createGuestSession(nickname);
  }
}
