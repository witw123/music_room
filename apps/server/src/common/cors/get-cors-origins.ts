const defaultCorsOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001"
];

function normalizeOriginVariant(origin: string) {
  try {
    const parsed = new URL(origin);
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return origin.trim().replace(/\/$/, "");
  }
}

export function getCorsOrigins() {
  const configuredOrigins = process.env.CORS_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const sourceOrigins = configuredOrigins?.length ? configuredOrigins : defaultCorsOrigins;
  return [...new Set(sourceOrigins.map(normalizeOriginVariant))];
}
