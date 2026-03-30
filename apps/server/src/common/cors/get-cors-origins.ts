const defaultCorsOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];

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

function expandOriginVariants(origin: string) {
  const normalized = normalizeOriginVariant(origin);

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname;
    const variants = new Set<string>([normalized]);

    if (host.startsWith("www.")) {
      const apex = host.slice(4);
      const apexUrl = new URL(parsed.toString());
      apexUrl.hostname = apex;
      variants.add(normalizeOriginVariant(apexUrl.toString()));
    } else if (host.includes(".")) {
      const wwwUrl = new URL(parsed.toString());
      wwwUrl.hostname = `www.${host}`;
      variants.add(normalizeOriginVariant(wwwUrl.toString()));
    }

    return [...variants];
  } catch {
    return [normalized];
  }
}

export function getCorsOrigins() {
  const configuredOrigins = process.env.CORS_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const sourceOrigins = configuredOrigins?.length ? configuredOrigins : defaultCorsOrigins;
  return [...new Set(sourceOrigins.flatMap(expandOriginVariants))];
}
