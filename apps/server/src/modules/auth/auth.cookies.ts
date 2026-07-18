export const userSessionCookieName = "music_room_session";

export function readUserSessionCookie(cookieHeader?: string | string[]) {
  const header = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
  if (!header) {
    return undefined;
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) {
      continue;
    }

    const name = part.slice(0, separator).trim();
    if (name !== userSessionCookieName) {
      continue;
    }

    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value) || undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}
