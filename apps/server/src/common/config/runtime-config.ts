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

  const jwtSecret = env.JWT_SECRET?.trim() ?? "";
  if (insecureJwtSecrets.has(jwtSecret.toLowerCase())) {
    throw new Error("Invalid JWT_SECRET for production startup.");
  }

  const turnEnabled = env.TURN_ENABLED !== "false";
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
