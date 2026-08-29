"use client";

import { useCallback, useEffect, useSyncExternalStore, useState } from "react";
import type { AuthSession } from "@music-room/shared";
import { errorCodes } from "@music-room/shared";
import { MusicRoomApiError, musicRoomApi } from "@/lib/network/music-room-api";

type SessionSnapshot = {
  activeSession: AuthSession | null;
  hasStoredSession: boolean;
  hydrated: boolean;
};

const emptySessionSnapshot: SessionSnapshot = {
  activeSession: null,
  hasStoredSession: false,
  hydrated: false
};

let sessionSnapshot = emptySessionSnapshot;
let sessionProbe: Promise<void> | null = null;
let sessionGeneration = 0;
const sessionListeners = new Set<() => void>();

function subscribeToSession(listener: () => void) {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

function getSessionSnapshot() {
  return sessionSnapshot;
}

function updateSessionSnapshot(next: SessionSnapshot) {
  if (
    areAuthSessionsEqual(sessionSnapshot.activeSession, next.activeSession) &&
    sessionSnapshot.hasStoredSession === next.hasStoredSession &&
    sessionSnapshot.hydrated === next.hydrated
  ) {
    return;
  }

  sessionSnapshot = next;
  for (const listener of sessionListeners) listener();
}

function setSharedSession(session: AuthSession | null) {
  sessionGeneration += 1;
  updateSessionSnapshot({
    activeSession: session,
    hasStoredSession: Boolean(session),
    hydrated: true
  });
}

/**
 * Only a definitive 401 from the server proves the session is gone. Network
 * flakes, 5xx responses, or a restarting server must keep the (possibly still
 * valid) session instead of logging the user out.
 */
function isUnauthorizedError(error: unknown) {
  return error instanceof MusicRoomApiError && error.code === errorCodes.unauthorized;
}

function ensureSessionProbe() {
  if (sessionProbe || sessionSnapshot.hydrated) return;

  const generation = sessionGeneration;
  sessionProbe = musicRoomApi.me()
    .then((session) => {
      if (generation !== sessionGeneration) return;
      updateSessionSnapshot({
        activeSession: isStoredAuthSession(session) ? session : null,
        hasStoredSession: isStoredAuthSession(session),
        hydrated: true
      });
    })
    .catch((error: unknown) => {
      if (generation !== sessionGeneration) return;
      if (!isUnauthorizedError(error)) {
        // Unknown state: stay hydrated without inventing a logged-out verdict.
        updateSessionSnapshot({
          activeSession: sessionSnapshot.activeSession,
          hasStoredSession: sessionSnapshot.hasStoredSession,
          hydrated: true
        });
        return;
      }
      updateSessionSnapshot({
        activeSession: null,
        hasStoredSession: false,
        hydrated: true
      });
    })
    .finally(() => {
      sessionProbe = null;
    });
}

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
  const { activeSession, hasStoredSession, hydrated } = useSyncExternalStore(
    subscribeToSession,
    getSessionSnapshot,
    getSessionSnapshot
  );
  const [statusMessage, setStatusMessage] = useState(initialStatusMessage);

  const persistSession = useCallback(
    (session: AuthSession | null) => {
      if (!session && typeof window !== "undefined") {
        window.localStorage.removeItem(sessionStorageKey);
      }
    },
    [sessionStorageKey]
  );

  const setActiveSession = useCallback(
    (session: AuthSession | null) => {
      setSharedSession(session);
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
    } catch (error) {
      // A network failure or server hiccup must not sign the user out; only a
      // real 401 (which also fires music-room-auth-expired) clears the session.
      if (isUnauthorizedError(error)) {
        setActiveSession(null);
      }
      return null;
    }
  }, [setActiveSession]);

  useEffect(() => {
    ensureSessionProbe();
  }, []);

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
