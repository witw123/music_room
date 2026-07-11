import { timingSafeEqual } from "node:crypto";

export const sessionCookieName = "__Host-music-room-session";
export const csrfCookieName = "__Host-music-room-csrf";
export const sessionTtlMs = 1000 * 60 * 60 * 24 * 7;

export function parseCookieHeader(header?: string) {
  const cookies = new Map<string, string>();
  for (const entry of header?.split(";") ?? []) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    const name = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    if (name) cookies.set(name, decodeURIComponent(value));
  }
  return cookies;
}

export function getSessionTokenFromCookie(header?: string) {
  return parseCookieHeader(header).get(sessionCookieName);
}

export function hasValidCsrfPair(cookieHeader?: string, headerToken?: string) {
  const cookieToken = parseCookieHeader(cookieHeader).get(csrfCookieName);
  if (!cookieToken || !headerToken) return false;
  const left = Buffer.from(cookieToken);
  const right = Buffer.from(headerToken);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function buildCookie(name: string, value: string, options?: {
  maxAgeSeconds?: number;
  sameSite?: "Lax" | "None";
  httpOnly?: boolean;
}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/"];
  if (options?.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  if (options?.httpOnly !== false) parts.push("HttpOnly");
  parts.push(`SameSite=${options?.sameSite ?? "Lax"}`);
  parts.push("Secure");
  return parts.join("; ");
}

export function resolveSameSite(origin?: string) {
  return origin === "http://127.0.0.1:37421" ? "None" as const : "Lax" as const;
}
