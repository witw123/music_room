import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ nonce: process.env.MUSIC_ROOM_DESKTOP_BUILD_NONCE ?? null });
}
