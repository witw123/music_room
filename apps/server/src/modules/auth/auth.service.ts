import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { GuestSession } from "@music-room/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";

@Injectable()
export class AuthService {
  private readonly sessions = new Map<string, GuestSession>();

  constructor(private readonly prisma: PrismaService) {}

  async createGuestSession(nickname: string): Promise<GuestSession> {
    const session = {
      id: `guest_${randomUUID()}`,
      nickname: nickname.trim() || "Guest",
      token: "replace-with-jwt",
      createdAt: new Date().toISOString()
    };

    this.sessions.set(session.id, session);

    if (this.prisma.isAvailable()) {
      await this.prisma.guestSessions.upsert({
        where: { id: session.id },
        update: {
          nickname: session.nickname,
          token: session.token
        },
        create: {
          id: session.id,
          nickname: session.nickname,
          token: session.token,
          createdAt: new Date(session.createdAt)
        }
      });
    }

    return session;
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  async getSessionOrThrow(sessionId: string) {
    const existing = this.sessions.get(sessionId);

    if (existing) {
      return existing;
    }

    if (this.prisma.isAvailable()) {
      const persisted = await this.prisma.guestSessions.findUnique({
        where: { id: sessionId }
      });

      if (persisted) {
        const session = {
          id: persisted.id,
          nickname: persisted.nickname,
          token: persisted.token,
          createdAt: persisted.createdAt.toISOString()
        };
        this.sessions.set(session.id, session);
        return session;
      }
    }

    throw new Error(`Unknown session: ${sessionId}`);
  }
}
