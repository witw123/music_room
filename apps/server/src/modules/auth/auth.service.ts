import { Injectable, Logger } from "@nestjs/common";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { AuthSession, UserProfile } from "@music-room/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";

type PersistenceMode = "database" | "fallback";

type StoredUser = UserProfile & {
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
  persistence: PersistenceMode;
};

type StoredUserSession = {
  id: string;
  userId: string;
  token: string;
  createdAt: string;
  expiresAt: string;
  persistence: PersistenceMode;
};

type FallbackAuthStore = {
  users: Array<
    Omit<StoredUser, "persistence">
  >;
  sessions: Array<
    Omit<StoredUserSession, "persistence">
  >;
};

const sessionTtlMs = 1000 * 60 * 60 * 24 * 30;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly usersById = new Map<string, StoredUser>();
  private readonly userIdByUsername = new Map<string, string>();
  private readonly sessionsByToken = new Map<string, StoredUserSession>();
  private readonly allowFallbackPersistence =
    process.env.AUTH_FAKE_PERSISTENCE === "true" ||
    (process.env.AUTH_FAKE_PERSISTENCE !== "false" && process.env.NODE_ENV !== "production");
  private readonly fallbackStorePath = resolve(
    process.cwd(),
    process.env.AUTH_FAKE_PERSIST_PATH ?? ".tmp/auth-fallback-store.json"
  );
  private fallbackLoaded = false;

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

    const persistence = await this.resolvePersistenceModeOrThrow();
    await this.assertUsernameAvailable(username);

    const now = new Date().toISOString();
    const user: StoredUser = {
      id: `user_${randomUUID()}`,
      username,
      nickname,
      passwordHash: hashPassword(password),
      createdAt: now,
      updatedAt: now,
      persistence
    };

    this.cacheUser(user);

    if (persistence === "database") {
      await this.prisma.user.create({
        data: {
          id: user.id,
          username: user.username,
          passwordHash: user.passwordHash,
          nickname: user.nickname,
          createdAt: new Date(user.createdAt),
          updatedAt: new Date(user.updatedAt)
        }
      });
    } else {
      await this.persistFallbackStore();
      this.logger.warn(
        `Database unavailable; created fallback auth user "${user.username}" at ${this.fallbackStorePath}`
      );
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

    await this.ensureAuthLookupAvailableOrThrow();
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

    await this.ensureFallbackStoreLoaded();

    const session = this.sessionsByToken.get(token) ?? (await this.getPersistedSessionByToken(token));
    if (!session) {
      return { ok: true };
    }

    this.sessionsByToken.delete(token);

    if (session.persistence === "database") {
      if (await this.prisma.ensureAvailable()) {
        await this.prisma.userSession.deleteMany({
          where: { token }
        });
      }
      return { ok: true };
    }

    await this.persistFallbackStore();
    return { ok: true };
  }

  async getAuthSessionByTokenOrThrow(token?: string): Promise<AuthSession> {
    if (!token) {
      throw new Error("Invalid session token.");
    }

    await this.ensureFallbackStoreLoaded();

    const storedSession =
      this.sessionsByToken.get(token) ?? (await this.getPersistedSessionByToken(token));

    if (!storedSession) {
      throw new Error("Invalid session token.");
    }

    if (new Date(storedSession.expiresAt).getTime() <= Date.now()) {
      this.sessionsByToken.delete(token);
      if (storedSession.persistence === "database") {
        if (await this.prisma.ensureAvailable()) {
          await this.prisma.userSession.deleteMany({
            where: { token }
          });
        }
      } else {
        await this.persistFallbackStore();
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
    await this.ensureFallbackStoreLoaded();

    const cached = this.usersById.get(userId);
    if (cached) {
      return toUserProfile(cached);
    }

    if (await this.prisma.ensureAvailable()) {
      const persisted = await this.prisma.user.findUnique({
        where: { id: userId }
      });

      if (persisted) {
        const user: StoredUser = {
          id: persisted.id,
          username: persisted.username,
          nickname: persisted.nickname,
          passwordHash: persisted.passwordHash,
          createdAt: persisted.createdAt.toISOString(),
          updatedAt: persisted.updatedAt.toISOString(),
          persistence: "database"
        };
        this.cacheUser(user);
        return toUserProfile(user);
      }
    }

    throw new Error(`Unknown user: ${userId}`);
  }

  async getSessionOrThrow(userId: string) {
    return this.getUserOrThrow(userId);
  }

  async getUserByUsernameOrThrow(username: string): Promise<StoredUser> {
    await this.ensureFallbackStoreLoaded();

    const cachedUserId = this.userIdByUsername.get(username);
    if (cachedUserId) {
      const cached = this.usersById.get(cachedUserId);
      if (cached) {
        return cached;
      }
    }

    if (await this.prisma.ensureAvailable()) {
      const persisted = await this.prisma.user.findUnique({
        where: { username }
      });

      if (persisted) {
        const user: StoredUser = {
          id: persisted.id,
          username: persisted.username,
          nickname: persisted.nickname,
          passwordHash: persisted.passwordHash,
          createdAt: persisted.createdAt.toISOString(),
          updatedAt: persisted.updatedAt.toISOString(),
          persistence: "database"
        };
        this.cacheUser(user);
        return user;
      }
    }

    throw new Error("Invalid username or password.");
  }

  private async createSessionForUser(user: StoredUser): Promise<AuthSession> {
    const persistence =
      user.persistence === "database" && (await this.prisma.ensureAvailable())
        ? "database"
        : "fallback";

    if (persistence === "fallback" && !this.allowFallbackPersistence) {
      throw new Error(
        "Account storage is temporarily unavailable. Please try again after the database is ready."
      );
    }

    const storedSession: StoredUserSession = {
      id: `session_${randomUUID()}`,
      userId: user.id,
      token: randomBytes(32).toString("base64url"),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + sessionTtlMs).toISOString(),
      persistence
    };

    this.sessionsByToken.set(storedSession.token, storedSession);

    if (persistence === "database") {
      await this.prisma.userSession.create({
        data: {
          id: storedSession.id,
          userId: storedSession.userId,
          token: storedSession.token,
          createdAt: new Date(storedSession.createdAt),
          expiresAt: new Date(storedSession.expiresAt)
        }
      });
    } else {
      await this.persistFallbackStore();
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
    await this.ensureFallbackStoreLoaded();

    if (this.userIdByUsername.has(username)) {
      throw new Error("Username already exists.");
    }

    if (await this.prisma.ensureAvailable()) {
      const existing = await this.prisma.user.findUnique({
        where: { username }
      });

      if (existing) {
        throw new Error("Username already exists.");
      }
    }
  }

  private async getPersistedSessionByToken(token: string) {
    await this.ensureFallbackStoreLoaded();

    if (await this.prisma.ensureAvailable()) {
      const persisted = await this.prisma.userSession.findUnique({
        where: { token }
      });

      if (persisted) {
        const session: StoredUserSession = {
          id: persisted.id,
          userId: persisted.userId,
          token: persisted.token,
          createdAt: persisted.createdAt.toISOString(),
          expiresAt: persisted.expiresAt.toISOString(),
          persistence: "database"
        };
        this.sessionsByToken.set(session.token, session);
        return session;
      }
    }

    return null;
  }

  private async resolvePersistenceModeOrThrow(): Promise<PersistenceMode> {
    if (await this.prisma.ensureAvailable()) {
      return "database";
    }

    if (this.allowFallbackPersistence) {
      await this.ensureFallbackStoreLoaded();
      return "fallback";
    }

    throw new Error(
      "Account storage is temporarily unavailable. Please try again after the database is ready."
    );
  }

  private async ensureAuthLookupAvailableOrThrow() {
    if (await this.prisma.ensureAvailable()) {
      return;
    }

    await this.ensureFallbackStoreLoaded();

    if (this.allowFallbackPersistence) {
      return;
    }

    throw new Error(
      "Account storage is temporarily unavailable. Please try again after the database is ready."
    );
  }

  private cacheUser(user: StoredUser) {
    this.usersById.set(user.id, user);
    this.userIdByUsername.set(user.username, user.id);
  }

  private async ensureFallbackStoreLoaded() {
    if (!this.allowFallbackPersistence || this.fallbackLoaded) {
      return;
    }

    this.fallbackLoaded = true;

    try {
      const raw = await readFile(this.fallbackStorePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<FallbackAuthStore>;

      for (const user of parsed.users ?? []) {
        this.cacheUser({
          ...user,
          persistence: "fallback"
        });
      }

      for (const session of parsed.sessions ?? []) {
        this.sessionsByToken.set(session.token, {
          ...session,
          persistence: "fallback"
        });
      }
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error ? String(error.code) : null;
      if (code !== "ENOENT") {
        this.logger.warn(`Failed to read fallback auth store. ${String(error)}`);
      }
    }
  }

  private async persistFallbackStore() {
    if (!this.allowFallbackPersistence) {
      return;
    }

    await this.ensureFallbackStoreLoaded();

    const payload: FallbackAuthStore = {
      users: Array.from(this.usersById.values())
        .filter((user) => user.persistence === "fallback")
        .map(({ persistence: _persistence, ...user }) => user),
      sessions: Array.from(this.sessionsByToken.values())
        .filter((session) => session.persistence === "fallback")
        .map(({ persistence: _persistence, ...session }) => session)
    };

    await mkdir(dirname(this.fallbackStorePath), { recursive: true });
    await writeFile(this.fallbackStorePath, JSON.stringify(payload, null, 2), "utf8");
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
