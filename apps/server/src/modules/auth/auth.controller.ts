import { Body, Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";

@Controller("v1/guest-sessions")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post()
  async createGuestSession(@Body() body: { nickname?: string }) {
    return this.authService.createGuestSession(body.nickname ?? "Guest");
  }
}
