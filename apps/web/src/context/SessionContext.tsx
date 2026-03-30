"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AuthSession } from "@music-room/shared";
import { useSessionIdentity } from "@/features/session/use-session-identity";

type SessionContextValue = {
  activeSession: AuthSession | null;
  nickname: string;
  setNickname: (nickname: string) => void;
  ensureSession: (_actionLabel: string) => Promise<AuthSession | null>;
  clearIdentity: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { activeSession, clearIdentity } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: "登录后即可进入音乐房。"
  });

  return (
    <SessionContext.Provider
      value={{
        activeSession,
        nickname: activeSession?.nickname ?? "",
        setNickname: () => undefined,
        ensureSession: async () => activeSession,
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
