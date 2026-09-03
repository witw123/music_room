import type { Socket } from "socket.io";
import type { RoomSnapshot, RoomSubscribeAckPayload } from "@music-room/shared";
import { readUserSessionCookie } from "../auth/auth.cookies";
import { isPrivateAddress } from "../providers/provider-fetch";

export type RealtimeRateLimitBucket = {
  windowStartedAt: number;
  count: number;
};

// ICE trickle produces many small messages during a room join. Keep that
// burst separate from SDP so candidates cannot consume the quota needed for
// the offer/answer that actually establishes the connection.
export const peerSignalRateLimits = {
  candidate: 1_200,
  description: 180
} as const;

export function getSocketSessionToken(client: Socket): string | undefined {
  const authToken =
    typeof client.handshake.auth?.sessionToken === "string"
      ? client.handshake.auth.sessionToken
      : undefined;

  if (authToken) {
    return authToken;
  }

  const headerToken = client.handshake.headers["x-session-token"];
  if (typeof headerToken === "string") {
    return headerToken;
  }

  return readUserSessionCookie(client.handshake.headers.cookie);
}

export function getSocketIp(client: Socket): string {
  const directAddress =
    client.handshake.address || client.conn.remoteAddress || "unknown";
  // x-real-ip is only meaningful when the TCP peer is our own reverse proxy,
  // which terminates on a private/loopback address and overwrites the header.
  // A direct public peer that supplies the header itself is spoofing it to
  // evade the per-IP socket cap and connect rate limit.
  if (isPrivateAddress(directAddress)) {
    const realIp = client.handshake.headers["x-real-ip"];
    if (typeof realIp === "string" && realIp.trim()) {
      return realIp.trim();
    }
  }
  return directAddress;
}

export function buildSubscribeAck(
  snapshot: RoomSnapshot,
  recoveryGeneration: number
): RoomSubscribeAckPayload {
  return {
    ok: true,
    protocolVersion: 4,
    capability: "webrtc-opus-v1",
    serverNow: new Date().toISOString(),
    recoveryGeneration,
    bootstrap: {
      roomId: snapshot.room.id,
      roomRevision: snapshot.room.roomRevision ?? 0,
      presenceRevision: snapshot.room.presenceRevision ?? 0,
      playback: snapshot.room.playback,
      members: snapshot.room.members.map((member) => ({
        id: member.id,
        peerId: member.peerId ?? null,
        presenceState: member.presenceState,
        role: member.role
      }))
    }
  };
}
