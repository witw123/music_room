import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  clientCookieName,
  getClientPlatformFromCookie,
  getClientPlatformFromSearch
} from "@/lib/client-shell";

const protectedClientPaths = ["/app", "/auth", "/rooms", "/room"];

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  if (!protectedClientPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  const clientPlatform = getClientPlatformFromSearch(searchParams);
  const cookiePlatform = getClientPlatformFromCookie(request.headers.get("cookie") ?? undefined);

  if (!clientPlatform && !cookiePlatform) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  response.cookies.set(clientCookieName, clientPlatform ?? cookiePlatform!, {
    path: "/",
    sameSite: "lax",
    secure: true,
    httpOnly: false
  });
  return response;
}

export const config = {
  matcher: ["/app/:path*", "/auth/:path*", "/rooms/:path*", "/room/:path*"]
};
