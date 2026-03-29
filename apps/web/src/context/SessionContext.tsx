"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from "react";
import type { GuestSession } from "@music-room/shared";
import { musicRoomApi } from "@/lib/music-room-api";

type SessionContextValue = {
  activeSession: GuestSession | null;
  nickname: string;
  setNickname: (nickname: string) => void;
  ensureSession: (actionLabel: string) => Promise<GuestSession | null>;
  clearIdentity: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

const sessionStorageKey = "music-room-session";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [activeSession, setActiveSession] = useState<GuestSession | null>(null);
  const [nickname, setNickname] = useState("");

  // Restore session from localStorage on mount
  useEffect(() => {
    const stored = window.localStorage.getItem(sessionStorageKey);
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored) as GuestSession;
      if (parsed.id && parsed.nickname && parsed.token) {
        setActiveSession(parsed);
        setNickname(parsed.nickname);
      }
    } catch {
      window.localStorage.removeItem(sessionStorageKey);
    }
  }, []);

  // Persist session to localStorage when it changes
  useEffect(() => {
    if (activeSession) {
      window.localStorage.setItem(sessionStorageKey, JSON.stringify(activeSession));
    }
  }, [activeSession]);

  const ensureSession = useCallback(
    async (actionLabel: string): Promise<GuestSession | null> => {
      const trimmedNickname = nickname.trim();
      if (!trimmedNickname) {
        return null;
      }

      if (activeSession && activeSession.nickname === trimmedNickname) {
        return activeSession;
      }

      try {
        const nextSession = await musicRoomApi.createGuestSession(trimmedNickname);
        setActiveSession(nextSession);
        return nextSession;
      } catch {
        return null;
      }
    },
    [activeSession, nickname]
  );

  const clearIdentity = useCallback(() => {
    setActiveSession(null);
    setNickname("");
    window.localStorage.removeItem(sessionStorageKey);
  }, []);

  return (
    <SessionContext.Provider
      value={{
        activeSession,
        nickname,
        setNickname,
        ensureSession,
        clearIdentity
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return ctx;
}
