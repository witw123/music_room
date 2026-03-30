"use client";

import { useCallback, useEffect, useState } from "react";
import type { GuestSession } from "@music-room/shared";

export function useSessionIdentity(options: {
  sessionStorageKey: string;
  initialStatusMessage: string;
}) {
  const { sessionStorageKey, initialStatusMessage } = options;
  const [nickname, setNickname] = useState("");
  const [activeSession, setActiveSession] = useState<GuestSession | null>(null);
  const [statusMessage, setStatusMessage] = useState(initialStatusMessage);

  useEffect(() => {
    const storedSession = window.localStorage.getItem(sessionStorageKey);
    if (!storedSession) {
      return;
    }

    try {
      const parsed = JSON.parse(storedSession) as GuestSession;
      if (parsed.id && parsed.nickname && parsed.token) {
        setActiveSession(parsed);
        setNickname(parsed.nickname);
        setStatusMessage(`已恢复身份：${parsed.nickname}。`);
      }
    } catch {
      window.localStorage.removeItem(sessionStorageKey);
    }
  }, [sessionStorageKey]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    window.localStorage.setItem(sessionStorageKey, JSON.stringify(activeSession));
  }, [activeSession, sessionStorageKey]);

  const clearIdentity = useCallback(() => {
    setActiveSession(null);
    setNickname("");
    window.localStorage.removeItem(sessionStorageKey);
    setStatusMessage(initialStatusMessage);
  }, [initialStatusMessage, sessionStorageKey]);

  return {
    nickname,
    setNickname,
    activeSession,
    setActiveSession,
    statusMessage,
    setStatusMessage,
    clearIdentity
  };
}
