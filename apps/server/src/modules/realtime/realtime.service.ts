import { Injectable, Logger } from "@nestjs/common";
import { createHmac } from "node:crypto";
import {
  iceConfigResponseSchema,
  type IceConfigResponse,
  type IceServerConfig
} from "@music-room/shared";

const defaultStunUrl = "stun:stun.l.google.com:19302";
const defaultTtlSeconds = 60 * 60;

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  buildIceConfig(userId: string, options?: { requestHost?: string | null }): IceConfigResponse {
    const ttlSeconds = parsePositiveInt(process.env.TURN_TTL_SECONDS) ?? defaultTtlSeconds;
    const stunUrl = process.env.NEXT_PUBLIC_STUN_URL?.trim() || defaultStunUrl;
    const staticIceServers = this.getStaticIceServers(stunUrl);
    const hasStaticTurn = hasTurnIceServer(staticIceServers);
    const turnEnabled = process.env.TURN_ENABLED !== "false";
    const turnHost = resolveTurnHost(options?.requestHost);
    const turnSecret = process.env.TURN_SHARED_SECRET?.trim();

    if (turnEnabled && turnHost && turnSecret) {
      const response = iceConfigResponseSchema.parse({
        iceServers: this.getEphemeralIceServers({
          stunUrl,
          turnHost,
          turnSecret,
          userId,
          ttlSeconds
        }),
        ttlSeconds,
        source: "ephemeral"
      });
      return response;
    }

    if (turnEnabled && (!turnHost || !turnSecret)) {
      this.logger.warn(
        "TURN is enabled but TURN_PUBLIC_HOST/APP_DOMAIN or TURN_SHARED_SECRET is missing. Falling back."
      );
    }

    if (hasStaticTurn) {
      return iceConfigResponseSchema.parse({
        iceServers: staticIceServers,
        ttlSeconds,
        source: "static"
      });
    }

    if (process.env.NODE_ENV === "production") {
      throw new Error("TURN is required to build ICE config in production.");
    }

    return iceConfigResponseSchema.parse({
      iceServers: [{ urls: stunUrl }],
      ttlSeconds,
      source: "stun-only"
    });
  }

  private getEphemeralIceServers(input: {
    stunUrl: string;
    turnHost: string;
    turnSecret: string;
    userId: string;
    ttlSeconds: number;
  }): IceServerConfig[] {
    const port = parsePositiveInt(process.env.TURN_PORT) ?? 3478;
    const tlsPort = parsePositiveInt(process.env.TURN_TLS_PORT) ?? 5349;
    const expiry = Math.floor(Date.now() / 1000) + input.ttlSeconds;
    const username = `${expiry}:${input.userId}`;
    const credential = createHmac("sha1", input.turnSecret).update(username).digest("base64");
    const protocols = (process.env.TURN_PROTOCOLS ?? "udp,tcp,tls")
      .split(",")
      .map((protocol) => protocol.trim().toLowerCase())
      .filter(Boolean);

    const urls: string[] = [];
    for (const protocol of protocols) {
      if (protocol === "udp") {
        urls.push(`turn:${input.turnHost}:${port}?transport=udp`);
      }

      if (protocol === "tcp") {
        urls.push(`turn:${input.turnHost}:${port}?transport=tcp`);
      }

      if (protocol === "tls" || protocol === "turns") {
        urls.push(`turns:${input.turnHost}:${tlsPort}?transport=tcp`);
      }
    }

    return [
      { urls: input.stunUrl },
      {
        urls,
        username,
        credential
      }
    ];
  }

  private getStaticIceServers(stunUrl: string): IceServerConfig[] {
    const rawJson = process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS?.trim();
    if (rawJson) {
      try {
        const parsed = JSON.parse(rawJson) as unknown;
        const result = iceConfigResponseSchema.shape.iceServers.safeParse(parsed);
        if (result.success && result.data.length > 0) {
          return result.data;
        }
      } catch {
        // Fall through to simple env parsing.
      }
    }

    const turnUrl = process.env.NEXT_PUBLIC_TURN_URL?.trim();
    const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME?.trim();
    const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL?.trim();
    const servers: IceServerConfig[] = [{ urls: stunUrl }];

    if (turnUrl) {
      servers.push({
        urls: turnUrl,
        username: turnUsername || undefined,
        credential: turnCredential || undefined
      });
    }

    return servers;
  }
}

function parsePositiveInt(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveTurnHost(requestHost?: string | null) {
  const explicitHost = process.env.TURN_PUBLIC_HOST?.trim();
  if (explicitHost) {
    return explicitHost;
  }

  const appDomain = process.env.APP_DOMAIN?.trim();
  if (appDomain) {
    // Allow TURN_PUBLIC_HOST_USE_APP_DOMAIN=1 to skip the "turn." prefix
    // so that TURN shares the same domain as the app (useful when the
    // reverse proxy / load balancer routes TURN ports on the same host).
    if (process.env.TURN_PUBLIC_HOST_USE_APP_DOMAIN === "1") {
      return appDomain;
    }
    return appDomain.startsWith("turn.") ? appDomain : `turn.${appDomain}`;
  }

  // Use the request's Host header as a last-resort fallback.
  // This handles cases where neither TURN_PUBLIC_HOST nor APP_DOMAIN is set
  // but the ICE endpoint is reached via a known public hostname.
  const normalizedRequestHost = normalizeHostHeader(requestHost);
  if (normalizedRequestHost) {
    return normalizedRequestHost;
  }

  return null;
}

function normalizeHostHeader(value?: string | null) {
  const firstHost = value?.split(",")[0]?.trim();
  if (!firstHost) {
    return null;
  }

  if (firstHost.startsWith("[")) {
    const closingBracketIndex = firstHost.indexOf("]");
    return closingBracketIndex > 1 ? firstHost.slice(1, closingBracketIndex) : null;
  }

  const withoutPort = firstHost.split(":")[0]?.trim();
  return withoutPort || null;
}

function hasTurnIceServer(iceServers: IceServerConfig[]) {
  return iceServers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((value) => value.startsWith("turn:") || value.startsWith("turns:"));
  });
}
