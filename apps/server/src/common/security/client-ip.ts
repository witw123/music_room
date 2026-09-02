/**
 * Resolve the best-effort client IP for rate limiting and audit logging.
 *
 * Precedence follows the rest of the NestJS app: the explicit `@Ip()` value
 * (which respects the configured trust proxy), then the request IP, then the
 * raw socket address. Shared by the auth and personalization controllers so
 * the fallback chain stays in one place.
 */
export function resolveClientIp(
  request: { ip?: string; socket?: { remoteAddress?: string } },
  ipAddress?: string
): string {
  return (
    ipAddress?.trim() ||
    request.ip?.trim() ||
    request.socket?.remoteAddress?.trim() ||
    "unknown"
  );
}
