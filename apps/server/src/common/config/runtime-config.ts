const insecureJwtSecrets = new Set([
  "",
  "replace-this-with-a-long-random-secret",
  "changeme",
  "your-jwt-secret"
]);

const insecureTurnSecrets = new Set([
  "",
  "replace-with-a-turn-shared-secret",
  "changeme",
  "your-turn-shared-secret"
]);

export function validateRuntimeConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== "production") {
    return;
  }

  if (env.NETEASE_ENABLED === "true" && !isValidNeteaseEncryptionKey(env.NETEASE_COOKIE_ENCRYPTION_KEY)) {
    throw new Error(
      "NETEASE_COOKIE_ENCRYPTION_KEY must be a 32-byte hex or base64 key when NetEase is enabled."
    );
  }

  if (env.SPOTIFY_ENABLED === "true") {
    if (!env.SPOTIFY_CLIENT_ID?.trim() || !env.SPOTIFY_CLIENT_SECRET?.trim()) {
      throw new Error(
        "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required when Spotify is enabled."
      );
    }
    if (!env.SPOTIFY_CREDENTIALS_PATH?.trim()) {
      throw new Error(
        "SPOTIFY_CREDENTIALS_PATH is required when Spotify is enabled."
      );
    }
    if (!env.SPOTIFY_ZOTIFY_BIN?.trim()) {
      throw new Error("SPOTIFY_ZOTIFY_BIN is required when Spotify is enabled.");
    }
  }

  const jwtSecret = env.JWT_SECRET?.trim() ?? "";
  if (insecureJwtSecrets.has(jwtSecret.toLowerCase())) {
    throw new Error("Invalid JWT_SECRET for production startup.");
  }

  const turnEnabled = env.TURN_ENABLED !== "false";
  const turnProtocols = (env.TURN_PROTOCOLS ?? "udp,tcp,tls")
    .split(",")
    .map((protocol) => protocol.trim().toLowerCase())
    .filter(Boolean);
  if (turnProtocols.length === 0 || turnProtocols.some((protocol) => !["udp", "tcp", "tls"].includes(protocol))) {
    throw new Error("Production TURN_PROTOCOLS must contain only udp, tcp, or tls.");
  }
  if (hasUnsupportedStaticTurnProtocol(env)) {
    throw new Error("Production ICE configuration contains an unsupported TURN transport.");
  }
  const hasStaticTurnConfig = hasStaticTurnIceConfig(env);
  if (!turnEnabled) {
    if (!hasStaticTurnConfig) {
      throw new Error("TURN is required for production startup.");
    }
    return;
  }

  const turnPublicHost = env.TURN_PUBLIC_HOST?.trim() ?? "";
  const appDomain = env.APP_DOMAIN?.trim() ?? "";
  const turnSecret = env.TURN_SHARED_SECRET?.trim() ?? "";
  const useRequestHostForTurn = env.TURN_PUBLIC_HOST_USE_REQUEST_HOST === "1";
  const hasTurnHostSource = !!turnPublicHost || !!appDomain || useRequestHostForTurn;
  if (turnPublicHost && !useRequestHostForTurn && isLocalHost(turnPublicHost)) {
    throw new Error("TURN_PUBLIC_HOST cannot be localhost in production startup.");
  }
  if (!turnPublicHost && !useRequestHostForTurn && appDomain && isLocalHost(appDomain)) {
    throw new Error("APP_DOMAIN cannot be localhost for TURN in production startup.");
  }
  const hasEphemeralTurnConfig = hasTurnHostSource && !!turnSecret;
  if (hasEphemeralTurnConfig) {
    if (insecureTurnSecrets.has(turnSecret.toLowerCase())) {
      throw new Error("Invalid TURN_SHARED_SECRET for production startup.");
    }
    return;
  }

  if (hasStaticTurnConfig) {
    return;
  }

  if (!hasTurnHostSource) {
    throw new Error("TURN requires TURN_PUBLIC_HOST or APP_DOMAIN in production startup.");
  }

  throw new Error("TURN requires TURN_SHARED_SECRET in production startup.");
}

function hasStaticTurnIceConfig(env: NodeJS.ProcessEnv) {
  const directTurnUrl = env.NEXT_PUBLIC_TURN_URL?.trim() ?? "";
  if (isTurnUrl(directTurnUrl)) {
    return true;
  }

  const rawJson = env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS?.trim() ?? "";
  if (!rawJson) {
    return false;
  }

  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!Array.isArray(parsed)) {
      return false;
    }

    return parsed.some((server) => {
      if (!server || typeof server !== "object" || !("urls" in server)) {
        return false;
      }

      const urls = (server as { urls?: unknown }).urls;
      if (typeof urls === "string") {
        return isTurnUrl(urls);
      }

      return Array.isArray(urls) && urls.some((value) => typeof value === "string" && isTurnUrl(value));
    });
  } catch {
    return false;
  }
}

export function isValidNeteaseEncryptionKey(value: string | undefined) {
  if (!value?.trim()) {
    return false;
  }

  const normalized = value.trim();
  if (/^[a-f0-9]{64}$/i.test(normalized)) {
    return true;
  }

  try {
    return Buffer.from(normalized, "base64").length === 32;
  } catch {
    return false;
  }
}

function hasUnsupportedStaticTurnProtocol(env: NodeJS.ProcessEnv) {
  const values: string[] = [env.NEXT_PUBLIC_TURN_URL?.trim() ?? ""];
  const rawJson = env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS?.trim() ?? "";
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      if (Array.isArray(parsed)) {
        for (const server of parsed) {
          if (!server || typeof server !== "object" || !("urls" in server)) continue;
          const urls = (server as { urls?: unknown }).urls;
          if (typeof urls === "string") values.push(urls);
          else if (Array.isArray(urls)) values.push(...urls.filter((url): url is string => typeof url === "string"));
        }
      }
    } catch {
      return false;
    }
  }
  return values.some((value) => {
    const normalized = value.toLowerCase();
    if (normalized.startsWith("turns:")) {
      return /(?:[?&]transport=)(udp|tls)\b/.test(normalized);
    }
    if (!normalized.startsWith("turn:")) return false;
    const transport = normalized.match(/(?:[?&]transport=)([^&]+)/)?.[1];
    return transport !== undefined && !["udp", "tcp"].includes(transport);
  });
}

function isTurnUrl(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("turn:") || normalized.startsWith("turns:");
}

function isLocalHost(value: string) {
  const firstHost = value.split(",")[0]?.trim().toLowerCase() ?? "";
  const normalized = firstHost.startsWith("[")
    ? firstHost.slice(1, firstHost.indexOf("]") > 0 ? firstHost.indexOf("]") : undefined)
    : firstHost.includes(":") && firstHost.split(":").length <= 2
      ? firstHost.split(":")[0]
      : firstHost;

  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0.0.0.0" ||
    normalized === "127.0.0.1" ||
    !!normalized?.startsWith("127.")
  );
}
