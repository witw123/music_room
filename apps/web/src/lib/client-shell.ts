export const clientQueryParam = "client";
export const clientCookieName = "music-room-client";
export const githubReleasesUrl = "https://github.com/witw123/music_room/releases";

export type ClientPlatform = "desktop" | "mobile";

const clientPlatforms: ClientPlatform[] = ["desktop", "mobile"];

export function isClientPlatform(value: string | null | undefined): value is ClientPlatform {
  return clientPlatforms.includes(value as ClientPlatform);
}

export function getClientPlatformFromSearch(searchParams: URLSearchParams) {
  const value = searchParams.get(clientQueryParam);
  return isClientPlatform(value) ? value : null;
}

export function buildAppEntryHref(platform?: ClientPlatform | null) {
  if (!platform) {
    return "/app";
  }

  return `/app?${clientQueryParam}=${platform}`;
}

export function buildWorkspaceAuthHref(options?: {
  redirectTo?: string;
  clientPlatform?: ClientPlatform | null;
}) {
  const redirectTo = options?.redirectTo ?? "/app";
  const nextSearchParams = new URLSearchParams({
    redirectTo
  });

  if (options?.clientPlatform) {
    nextSearchParams.set(clientQueryParam, options.clientPlatform);
  }

  return `/auth?${nextSearchParams.toString()}`;
}

export function getClientPlatformFromCookie(cookieHeader: string | undefined) {
  if (!cookieHeader) {
    return null;
  }

  const value = cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${clientCookieName}=`))
    ?.split("=")[1];

  return isClientPlatform(value) ? value : null;
}
