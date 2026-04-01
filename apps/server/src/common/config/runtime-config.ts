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
  if (!turnEnabled) {
    return;
  }

  const turnSecret = env.TURN_SHARED_SECRET?.trim() ?? "";
  if (insecureTurnSecrets.has(turnSecret.toLowerCase())) {
    throw new Error("Invalid TURN_SHARED_SECRET for production startup.");
  }
}
