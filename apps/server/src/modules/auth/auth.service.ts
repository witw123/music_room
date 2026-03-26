import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { GuestSession } from "@music-room/shared";

@Injectable()
export class AuthService {
  createGuestSession(nickname: string): GuestSession {
    return {
      id: `guest_${randomUUID()}`,
      nickname,
      token: "replace-with-jwt",
      createdAt: new Date().toISOString()
    };
  }
}

