"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuthSession } from "@music-room/shared";
import { musicRoomApi } from "@/lib/music-room-api";

export function isStoredAuthSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== "object") {
    return false;
  }

  const session = value as Partial<AuthSession>;
  return Boolean(
    session.id &&
      session.userId &&
      session.username &&
      session.nickname &&
      session.token &&
      session.createdAt
  );
}

export function areAuthSessionsEqual(
  left: AuthSession | null,
  right: AuthSession | null
) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.id === right.id &&
    left.userId === right.userId &&
    left.username === right.username &&
    left.nickname === right.nickname &&
    left.token === right.token &&
    left.createdAt === right.createdAt
  );
}

export function useSessionIdentity(options: {
  sessionStorageKey: string;
  initialStatusMessage: string;
}) {
  const { sessionStorageKey, initialStatusMessage } = options;
  const [activeSession, setActiveSessionState] = useState<AuthSession | null>(null);
  const [hasStoredSession, setHasStoredSession] = useState(false);
  const [statusMessage, setStatusMessage] = useState(initialStatusMessage);
  const [hydrated, setHydrated] = useState(false);

  const persistSession = useCallback(
    (session: AuthSession | null) => {
      if (session) {
        window.localStorage.setItem(sessionStorageKey, JSON.stringify(session));
        setHasStoredSession(true);
        return;
      }

      window.localStorage.removeItem(sessionStorageKey);
      setHasStoredSession(false);
    },
    [sessionStorageKey]
  );

  const setActiveSession = useCallback(
    (session: AuthSession | null) => {
      setActiveSessionState((current) =>
        areAuthSessionsEqual(current, session) ? current : session
      );
      persistSession(session);
    },
    [persistSession]
  );

  const clearIdentity = useCallback(() => {
    setActiveSession(null);
    setStatusMessage(initialStatusMessage);
  }, [initialStatusMessage, setActiveSession]);

  const refreshSession = useCallback(async () => {
    try {
      const session = await musicRoomApi.me();
      setActiveSession(session);
      return session;
    } catch {
      setActiveSession(null);
      return null;
    }
  }, [setActiveSession]);

  useEffect(() => {
    const storedSession = window.localStorage.getItem(sessionStorageKey);
    if (!storedSession) {
      setHydrated(true);
      return;
    }

    try {
      const parsed = JSON.parse(storedSession) as AuthSession;
      if (isStoredAuthSession(parsed)) {
        setActiveSessionState(parsed);
        setHasStoredSession(true);
      } else {
        window.localStorage.removeItem(sessionStorageKey);
        setHasStoredSession(false);
      }
    } catch {
      window.localStorage.removeItem(sessionStorageKey);
      setHasStoredSession(false);
    }

    setHydrated(true);
  }, [sessionStorageKey]);

  useEffect(() => {
    const handleExpired = () => {
      clearIdentity();
      setStatusMessage("登录已失效，请重新登录。");
    };

    window.addEventListener("music-room-auth-expired", handleExpired);
    return () => {
      window.removeEventListener("music-room-auth-expired", handleExpired);
    };
  }, [clearIdentity]);

  return {
    activeSession,
    hasStoredSession,
    hydrated,
    setActiveSession,
    statusMessage,
    setStatusMessage,
    clearIdentity,
    refreshSession
  };
}
