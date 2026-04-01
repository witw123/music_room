import { cookies } from "next/headers";
import {
  clientCookieName,
  clientQueryParam,
  isClientPlatform,
  type ClientPlatform
} from "./client-shell";

export async function getClientPlatformFromRequest(
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>
) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const queryValue = resolvedSearchParams?.[clientQueryParam];
  const normalizedQueryValue = Array.isArray(queryValue) ? queryValue[0] : queryValue;

  if (isClientPlatform(normalizedQueryValue)) {
    return normalizedQueryValue;
  }

  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(clientCookieName)?.value;
  return isClientPlatform(cookieValue) ? (cookieValue as ClientPlatform) : null;
}
