import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const maxRedirects = 3;

export async function fetchProviderUrl(
  initialUrl: URL,
  init: RequestInit,
  timeoutMs: number,
  isAllowedHost: (hostname: string) => boolean
) {
  let url = new URL(initialUrl.toString());

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    await assertSafeProviderUrl(url, isAllowedHost);
    const response = await fetchWithHeadersTimeout(url.toString(), init, timeoutMs);

    if (!redirectStatuses.has(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location || redirectCount === maxRedirects) {
      throw new Error("Provider returned too many or invalid redirects.");
    }

    url = new URL(location, url);
  }

  throw new Error("Provider returned too many redirects.");
}

async function assertSafeProviderUrl(
  url: URL,
  isAllowedHost: (hostname: string) => boolean
) {
  if (
    url.protocol !== "https:" ||
    (url.port !== "" && url.port !== "443") ||
    url.username ||
    url.password ||
    !isAllowedHost(url.hostname)
  ) {
    throw new Error("Provider returned an unsupported URL.");
  }

  const addresses = isIP(url.hostname)
    ? [url.hostname]
    : (await lookup(url.hostname, { all: true, verbatim: true })).map((entry) => entry.address);

  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error("Provider URL resolved to a private address.");
  }
}

function fetchWithHeadersTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    ...init,
    redirect: "manual",
    signal: controller.signal
  }).finally(() => clearTimeout(timer));
}

export function isPrivateAddress(address: string) {
  if (isIP(address) === 4) {
    return isPrivateIpv4(address);
  }

  if (isIP(address) !== 6) {
    return true;
  }

  const bytes = parseIpv6(address);
  if (!bytes) {
    return true;
  }

  const isAllZero = bytes.every((value) => value === 0);
  const isLoopback = bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1;
  const isIpv4Mapped = bytes.slice(0, 10).every((value) => value === 0) && bytes[10] === 255 && bytes[11] === 255;
  const isIpv4Compatible = bytes.slice(0, 12).every((value) => value === 0);

  if (isIpv4Mapped || isIpv4Compatible) {
    return isPrivateIpv4(bytes.slice(12));
  }

  const first = bytes[0];
  const second = bytes[1];
  return isAllZero ||
    isLoopback ||
    first === 0xff ||
    (first & 0xfe) === 0xfc ||
    (first === 0xfe && (second & 0xc0) === 0x80) ||
    (first === 0xfe && (second & 0xc0) === 0xc0);
}

function isPrivateIpv4(value: string | number[]) {
  const octets = typeof value === "string" ? value.split(".").map(Number) : value;
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return true;
  }

  const [first, second, third] = octets;
  return first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 198 && (second === 18 || second === 19 || second === 51)) ||
    (first === 203 && (second === 0 || (second === 0 && third === 113))) ||
    first >= 224;
}

function parseIpv6(address: string) {
  const normalized = address.toLowerCase().split("%")[0];
  const sections = normalized.split("::");
  if (sections.length > 2) {
    return null;
  }

  const parseSection = (section: string) => {
    if (!section) return [];
    const parts = section.split(":");
    const values: number[] = [];
    for (const part of parts) {
      if (part.includes(".")) {
        const octets = part.split(".").map(Number);
        if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return null;
        values.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      values.push(Number.parseInt(part, 16));
    }
    return values;
  };

  const left = parseSection(sections[0]);
  const right = parseSection(sections[1] ?? "");
  if (!left || !right) return null;

  const missing = sections.length === 2 ? 8 - left.length - right.length : 0;
  if (missing < 0 || (sections.length === 2 && missing === 0)) return null;
  const groups = sections.length === 2 ? [...left, ...Array<number>(missing).fill(0), ...right] : left;
  if (groups.length !== 8) return null;

  return groups.flatMap((group) => [group >> 8, group & 0xff]);
}
