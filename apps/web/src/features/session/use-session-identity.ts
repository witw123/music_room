"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuthSession } from "@music-room/shared";
import { musicRoomApi } from "@/lib/music-room-api";

export function useSessionIdentity(options: {
  sessionStorageKey: string;
  initialStatusMessage: string;
}) {
  const { sessionStorageKey, initialStatusMessage } = options;
  const [activeSession, setActiveSessionState] = useState<AuthSession | null>(null);
  const [statusMessage, setStatusMessage] = useState(initialStatusMessage);
  const [hydrated, setHydrated] = useState(false);

  const persistSession = useCallback(
    (session: AuthSession | null) => {
      if (session) {
        window.localStorage.setItem(sessionStorageKey, JSON.stringify(session));
        return;
      }

      window.localStorage.removeItem(sessionStorageKey);
    },
    [sessionStorageKey]
  );

  const setActiveSession = useCallback(
    (session: AuthSession | null) => {
      setActiveSessionState(session);
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
      if (parsed.id && parsed.token && parsed.username && parsed.nickname) {
        setActiveSessionState(parsed);
      } else {
        window.localStorage.removeItem(sessionStorageKey);
      }
    } catch {
      window.localStorage.removeItem(sessionStorageKey);
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
    hydrated,
    setActiveSession,
    statusMessage,
    setStatusMessage,
    clearIdentity,
    refreshSession
  };
}
