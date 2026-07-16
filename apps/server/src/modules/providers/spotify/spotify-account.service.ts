import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { SpotifyAccountStatus } from "@music-room/shared";
import { PrismaService } from "../../../infra/prisma/prisma.service";
import { SpotifyCryptoService } from "./spotify-crypto.service";

export type SpotifyStoredConfig = {
  clientId: string;
  clientSecret: string;
  credentialsJson: string;
};

export class SpotifyAccountRequiredError extends Error {
  constructor() {
    super("Spotify account credentials are required.");
  }
}

export class SpotifyAccountCredentialsInvalidError extends Error {
  constructor() {
    super("Spotify account credentials are invalid.");
  }
}

export class SpotifyAccountStorageUnavailableError extends Error {
  constructor() {
    super("Spotify account storage is temporarily unavailable.");
  }
}

@Injectable()
export class SpotifyAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: SpotifyCryptoService
  ) {}

  async getStatus(userId: string, hasZotifyBinary: boolean): Promise<SpotifyAccountStatus> {
    const account = await this.findAccount(userId);
    const hasValidCredentials = account ? this.tryDecryptAccount(account) !== null : false;
    const hasWebApiCredentials = hasValidCredentials;
    const hasDownloadCredentials = hasValidCredentials;
    const connected = hasWebApiCredentials && hasDownloadCredentials && hasZotifyBinary;

    let message: string | null = null;
    if (!account) {
      message = "请先配置 Spotify Client ID、Client Secret 和 credentials.json。";
    } else if (!hasValidCredentials) {
      message = "已保存的 Spotify 凭证无法读取，请删除后重新配置。";
    } else if (!hasZotifyBinary) {
      message = "服务端未找到 Zotify。";
    }

    return {
      connected,
      mode: "user_credentials",
      hasWebApiCredentials,
      hasDownloadCredentials,
      hasZotifyBinary,
      lastValidatedAt: account?.lastValidatedAt?.toISOString() ?? null,
      message
    };
  }

  async getConfigOrThrow(userId: string): Promise<SpotifyStoredConfig> {
    const account = await this.findAccount(userId);
    if (!account) {
      throw new SpotifyAccountRequiredError();
    }

    const config = this.tryDecryptAccount(account);
    if (!config) throw new SpotifyAccountCredentialsInvalidError();
    return config;
  }

  async saveAccount(userId: string, config: SpotifyStoredConfig) {
    await this.ensureDatabase();
    const encryptedClientId = this.crypto.encrypt(config.clientId);
    const encryptedClientSecret = this.crypto.encrypt(config.clientSecret);
    const encryptedCredentials = this.crypto.encrypt(config.credentialsJson);
    try {
      return await this.prisma.spotifyAccount.upsert({
        where: { userId },
        update: {
          encryptedClientId,
          encryptedClientSecret,
          encryptedCredentials,
          lastValidatedAt: new Date()
        },
        create: {
          id: `spotify_${randomUUID()}`,
          userId,
          encryptedClientId,
          encryptedClientSecret,
          encryptedCredentials,
          lastValidatedAt: new Date()
        }
      });
    } catch {
      throw new SpotifyAccountStorageUnavailableError();
    }
  }

  async disconnect(userId: string) {
    await this.ensureDatabase();
    try {
      await this.prisma.spotifyAccount.deleteMany({ where: { userId } });
    } catch {
      throw new SpotifyAccountStorageUnavailableError();
    }
    return { ok: true };
  }

  private async findAccount(userId: string) {
    await this.ensureDatabase();
    try {
      return await this.prisma.spotifyAccount.findUnique({ where: { userId } });
    } catch {
      throw new SpotifyAccountStorageUnavailableError();
    }
  }

  private async ensureDatabase() {
    if (!(await this.prisma.ensureAvailable())) {
      throw new SpotifyAccountStorageUnavailableError();
    }
  }

  private tryDecryptAccount(account: {
    encryptedClientId: string;
    encryptedClientSecret: string;
    encryptedCredentials: string;
  }): SpotifyStoredConfig | null {
    try {
      const config = {
        clientId: this.crypto.decrypt(account.encryptedClientId).trim(),
        clientSecret: this.crypto.decrypt(account.encryptedClientSecret).trim(),
        credentialsJson: this.crypto.decrypt(account.encryptedCredentials).trim()
      };
      const credentials = JSON.parse(config.credentialsJson) as unknown;
      if (
        !config.clientId ||
        !config.clientSecret ||
        !credentials ||
        typeof credentials !== "object" ||
        Array.isArray(credentials)
      ) {
        return null;
      }
      return config;
    } catch {
      return null;
    }
  }
}
