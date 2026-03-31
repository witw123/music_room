"use client";

import {
  clientCookieName,
  clientQueryParam,
  isClientPlatform,
  type ClientPlatform
} from "./client-shell";

export function getClientPlatformFromBrowser(): ClientPlatform | null {
  if (typeof window === "undefined") {
    return null;
  }

  const searchParams = new URLSearchParams(window.location.search);
  const queryValue = searchParams.get(clientQueryParam);
  if (isClientPlatform(queryValue)) {
    return queryValue;
  }

  const cookieValue = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${clientCookieName}=`))
    ?.split("=")[1];

  return isClientPlatform(cookieValue) ? cookieValue : null;
}
