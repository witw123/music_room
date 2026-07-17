import { apiBaseUrl } from "./api-client";
import type { AdminIncident, AdminOverview, AdminRoomSummary, AdminSession, AdminUserSummary } from "@music-room/shared";

const csrfStorageKey = "music-room-admin-csrf";

export class AdminApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

function getCsrfToken() {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(csrfStorageKey);
}

async function request<T>(path: string, init: RequestInit = {}) {
  const method = (init.method ?? "GET").toUpperCase();
  const csrf = getCsrfToken();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(method !== "GET" && csrf ? { "x-admin-csrf": csrf } : {}),
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try { const body = await response.json() as { message?: string }; message = body.message ?? message; } catch { /* plain response */ }
    throw new AdminApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}

export const adminApi = {
  login: async (username: string, password: string) => {
    const session = await request<AdminSession>("/v1/admin/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    if (typeof window !== "undefined") window.sessionStorage.setItem(csrfStorageKey, session.csrfToken);
    return session;
  },
  logout: () => request<{ ok: boolean }>("/v1/admin/auth/logout", { method: "POST" }),
  session: () => request<AdminSession>("/v1/admin/session"),
  overview: () => request<AdminOverview>("/v1/admin/overview"),
  rooms: (query = "") => request<{ data: AdminRoomSummary[]; nextCursor: string | null; generatedAt: string }>(`/v1/admin/rooms${query ? `?q=${encodeURIComponent(query)}` : ""}`),
  room: (roomId: string) => request<AdminRoomSummary & { playback: unknown; queue: unknown; tracks: unknown; members: unknown }>(`/v1/admin/rooms/${encodeURIComponent(roomId)}`),
  terminateRoom: (roomId: string, expectedJoinCode: string, reason: string) => request<{ ok: boolean; alreadyTerminated: boolean }>(`/v1/admin/rooms/${encodeURIComponent(roomId)}/terminate`, { method: "POST", body: JSON.stringify({ expectedJoinCode, reason }) }),
  users: (query = "") => request<{ data: AdminUserSummary[]; nextCursor: string | null; generatedAt: string }>(`/v1/admin/users${query ? `?q=${encodeURIComponent(query)}` : ""}`),
  user: (userId: string) => request(`/v1/admin/users/${encodeURIComponent(userId)}`),
  setUserStatus: (userId: string, status: "ACTIVE" | "DISABLED", reason: string) => request<{ ok: boolean; status: string }>(`/v1/admin/users/${encodeURIComponent(userId)}/status`, { method: "PATCH", body: JSON.stringify({ status, reason }) }),
  revokeSessions: (userId: string, reason: string) => request<{ ok: boolean }>(`/v1/admin/users/${encodeURIComponent(userId)}/sessions/revoke`, { method: "POST", body: JSON.stringify({ reason }) }),
  incidents: () => request<{ data: AdminIncident[]; nextCursor: string | null; generatedAt: string }>("/v1/admin/incidents"),
  audit: () => request<{ data: Array<{ id: string; actorUserId: string; action: string; targetType: string; targetId: string | null; reason: string | null; result: string; createdAt: string }>; nextCursor: string | null; generatedAt: string }>("/v1/admin/audit-logs"),
  system: () => request<AdminOverview>("/v1/admin/system")
};
