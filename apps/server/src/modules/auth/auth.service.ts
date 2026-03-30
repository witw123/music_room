import { Injectable } from "@nestjs/common";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { AuthSession, UserProfile } from "@music-room/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";

type StoredUser = UserProfile & {
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
};

type StoredUserSession = {
  id: string;
  userId: string;
  token: string;
  createdAt: string;
  expiresAt: string;
};

const sessionTtlMs = 1000 * 60 * 60 * 24 * 30;

@Injectable()
export class AuthService {
  private readonly usersById = new Map<string, StoredUser>();
  private readonly userIdByUsername = new Map<string, string>();
  private readonly sessionsByToken = new Map<string, StoredUserSession>();

  constructor(private readonly prisma: PrismaService) {}

  async register(input: {
    username: string;
    password: string;
    nickname: string;
  }): Promise<AuthSession> {
    const username = input.username.trim().toLowerCase();
    const nickname = input.nickname.trim();
    const password = input.password;

    if (!username) {
      throw new Error("Username is required.");
    }

    if (!nickname) {
      throw new Error("Nickname is required.");
    }

    if (password.trim().length < 6) {
      throw new Error("Password must be at least 6 characters.");
    }

    await this.assertUsernameAvailable(username);

    const now = new Date();
    const user: StoredUser = {
      id: `user_${randomUUID()}`,
      username,
      nickname,
      passwordHash: hashPassword(password),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    this.usersById.set(user.id, user);
    this.userIdByUsername.set(username, user.id);

    if (this.prisma.isAvailable()) {
      await this.prisma.users.create({
        data: {
          id: user.id,
          username: user.username,
          passwordHash: user.passwordHash,
          nickname: user.nickname,
          createdAt: new Date(user.createdAt),
          updatedAt: new Date(user.updatedAt)
        }
      });
    }

    return this.createSessionForUser(user);
  }

  async createGuestSession(nickname: string): Promise<AuthSession> {
    const slugBase =
      nickname
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "user";

    return this.register({
      username: `${slugBase}-${randomBytes(4).toString("hex")}`,
      password: randomBytes(12).toString("hex"),
      nickname
    });
  }

  async login(input: { username: string; password: string }): Promise<AuthSession> {
    const username = input.username.trim().toLowerCase();
    const password = input.password;

    if (!username || !password) {
      throw new Error("Username and password are required.");
    }

    const user = await this.getUserByUsernameOrThrow(username);
    if (!verifyPassword(password, user.passwordHash)) {
      throw new Error("Invalid username or password.");
    }

    return this.createSessionForUser(user);
  }

  async logout(token?: string) {
    if (!token) {
      return { ok: true };
    }

    const session = this.sessionsByToken.get(token) ?? (await this.getPersistedSessionByToken(token));
    if (session) {
      this.sessionsByToken.delete(token);

      if (this.prisma.isAvailable()) {
        await this.prisma.userSessions.deleteMany({
          where: { token }
        });
      }
    }

    return { ok: true };
  }

  async getAuthSessionByTokenOrThrow(token?: string): Promise<AuthSession> {
    if (!token) {
      throw new Error("Invalid session token.");
    }

    const storedSession =
      this.sessionsByToken.get(token) ?? (await this.getPersistedSessionByToken(token));

    if (!storedSession) {
      throw new Error("Invalid session token.");
    }

    if (new Date(storedSession.expiresAt).getTime() <= Date.now()) {
      this.sessionsByToken.delete(token);
      if (this.prisma.isAvailable()) {
        await this.prisma.userSessions.deleteMany({
          where: { token }
        });
      }
      throw new Error("Session expired.");
    }

    const user = await this.getUserOrThrow(storedSession.userId);
    return this.toAuthSession(user, storedSession);
  }

  async assertSessionToken(userId: string, token?: string) {
    const session = await this.getAuthSessionByTokenOrThrow(token);

    if (session.userId !== userId) {
      throw new Error("Invalid session token.");
    }

    return session;
  }

  async getUserOrThrow(userId: string): Promise<UserProfile> {
    const cached = this.usersById.get(userId);
    if (cached) {
      return toUserProfile(cached);
    }

    if (this.prisma.isAvailable()) {
      const persisted = await this.prisma.users.findUnique({
        where: { id: userId }
      });

      if (persisted) {
        const user: StoredUser = {
          id: persisted.id,
          username: persisted.username,
          nickname: persisted.nickname,
          passwordHash: persisted.passwordHash,
          createdAt: persisted.createdAt.toISOString(),
          updatedAt: persisted.updatedAt.toISOString()
        };
        this.usersById.set(user.id, user);
        this.userIdByUsername.set(user.username, user.id);
        return toUserProfile(user);
      }
    }

    throw new Error(`Unknown user: ${userId}`);
  }

  async getSessionOrThrow(userId: string) {
    return this.getUserOrThrow(userId);
  }

  async getUserByUsernameOrThrow(username: string): Promise<StoredUser> {
    const cachedUserId = this.userIdByUsername.get(username);
    if (cachedUserId) {
      const cached = this.usersById.get(cachedUserId);
      if (cached) {
        return cached;
      }
    }

    if (this.prisma.isAvailable()) {
      const persisted = await this.prisma.users.findUnique({
        where: { username }
      });

      if (persisted) {
        const user: StoredUser = {
          id: persisted.id,
          username: persisted.username,
          nickname: persisted.nickname,
          passwordHash: persisted.passwordHash,
          createdAt: persisted.createdAt.toISOString(),
          updatedAt: persisted.updatedAt.toISOString()
        };
        this.usersById.set(user.id, user);
        this.userIdByUsername.set(user.username, user.id);
        return user;
      }
    }

    throw new Error("Invalid username or password.");
  }

  private async createSessionForUser(user: StoredUser): Promise<AuthSession> {
    const storedSession: StoredUserSession = {
      id: `session_${randomUUID()}`,
      userId: user.id,
      token: randomBytes(32).toString("base64url"),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + sessionTtlMs).toISOString()
    };

    this.sessionsByToken.set(storedSession.token, storedSession);

    if (this.prisma.isAvailable()) {
      await this.prisma.userSessions.create({
        data: {
          id: storedSession.id,
          userId: storedSession.userId,
          token: storedSession.token,
          createdAt: new Date(storedSession.createdAt),
          expiresAt: new Date(storedSession.expiresAt)
        }
      });
    }

    return this.toAuthSession(user, storedSession);
  }

  private toAuthSession(user: UserProfile, session: StoredUserSession): AuthSession {
    return {
      id: user.id,
      userId: user.id,
      username: user.username,
      nickname: user.nickname,
      token: session.token,
      createdAt: session.createdAt
    };
  }

  private async assertUsernameAvailable(username: string) {
    if (this.userIdByUsername.has(username)) {
      throw new Error("Username already exists.");
    }

    if (!this.prisma.isAvailable()) {
      return;
    }

    const existing = await this.prisma.users.findUnique({
      where: { username }
    });

    if (existing) {
      throw new Error("Username already exists.");
    }
  }

  private async getPersistedSessionByToken(token: string) {
    if (!this.prisma.isAvailable()) {
      return null;
    }

    const persisted = await this.prisma.userSessions.findUnique({
      where: { token }
    });

    if (!persisted) {
      return null;
    }

    const session: StoredUserSession = {
      id: persisted.id,
      userId: persisted.userId,
      token: persisted.token,
      createdAt: persisted.createdAt.toISOString(),
      expiresAt: persisted.expiresAt.toISOString()
    };
    this.sessionsByToken.set(session.token, session);
    return session;
  }
}

function toUserProfile(user: StoredUser): UserProfile {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname
  };
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string) {
  const [salt, expectedHash] = storedHash.split(":");
  if (!salt || !expectedHash) {
    return false;
  }

  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "hex");

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}
