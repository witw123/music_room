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

type OriginRequest = {
  protocol?: string;
  headers?: {
    host?: string | string[];
    "x-forwarded-proto"?: string | string[];
  };
  get?: (header: string) => string | undefined;
};

export function getCorsOrigins() {
  const configuredOrigins = process.env.CORS_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const sourceOrigins = configuredOrigins?.length ? configuredOrigins : defaultCorsOrigins;
  return [...new Set(sourceOrigins.map(normalizeOriginVariant))];
}

export function getRequestOrigin(request: OriginRequest) {
  const rawForwardedProtocol = request.get?.("x-forwarded-proto") ?? request.headers?.["x-forwarded-proto"];
  const forwardedProtocol = Array.isArray(rawForwardedProtocol)
    ? rawForwardedProtocol[0]
    : rawForwardedProtocol?.split(",")[0];
  const configuredProtocol = forwardedProtocol?.trim().toLowerCase();
  const protocol = ["http", "https"].includes(configuredProtocol ?? "")
    ? configuredProtocol
    : request.protocol?.trim().toLowerCase();
  const rawHost = request.get?.("host") ?? request.headers?.host;
  const host = Array.isArray(rawHost) ? rawHost[0]?.trim() : rawHost?.trim();
  if (!protocol || !host) return null;
  return normalizeOriginVariant(`${protocol}://${host}`);
}

export function isAllowedOrigin(
  origin: string | undefined,
  requestOrigin: string | null,
  allowedOrigins = getCorsOrigins()
) {
  if (!origin) return false;
  const normalizedOrigin = normalizeOriginVariant(origin);
  return (
    allowedOrigins.includes(normalizedOrigin) ||
    (requestOrigin !== null && normalizedOrigin === normalizeOriginVariant(requestOrigin))
  );
}
