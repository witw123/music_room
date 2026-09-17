"use client";

import { useEffect, useState } from "react";
import type { PersonalizationProfileResponse } from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { personalizationChangedEvent } from "./use-personalization-reporter";
import {
  getLocalStoredProfile,
  mergeProfileWithServer
} from "./local-personalization-store";

let cachedProfile: PersonalizationProfileResponse | null = null;
let inFlightRequest: Promise<PersonalizationProfileResponse | null> | null = null;

function requestProfile(force: boolean): Promise<PersonalizationProfileResponse | null> {
  if (inFlightRequest) {
    return inFlightRequest;
  }
  if (!force && cachedProfile) {
    return Promise.resolve(cachedProfile);
  }
  inFlightRequest = musicRoomApi.getPersonalizationProfile()
    .then((serverProfile) => {
      const local = getLocalStoredProfile();
      const merged = mergeProfileWithServer(local, serverProfile);
      cachedProfile = merged ?? serverProfile;
      return cachedProfile;
    })
    .catch(() => {
      const local = getLocalStoredProfile();
      if (local) cachedProfile = local;
      return cachedProfile;
    })
    .finally(() => {
      inFlightRequest = null;
    });
  return inFlightRequest;
}

export function usePersonalizationProfile() {
  const [profile, setProfile] = useState<PersonalizationProfileResponse | null>(() => {
    return cachedProfile ?? getLocalStoredProfile();
  });
  const [loading, setLoading] = useState(() => {
    return cachedProfile === null && getLocalStoredProfile() === null;
  });

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: number | null = null;
    let refreshQueued = false;

    const initial = cachedProfile ?? getLocalStoredProfile();
    if (initial) {
      setProfile(initial);
      setLoading(false);
    } else {
      setLoading(true);
    }

    void requestProfile(false).then((next) => {
      if (cancelled) return;
      if (next) setProfile(next);
      setLoading(false);
    });

    const scheduleRefresh = () => {
      const latestLocal = getLocalStoredProfile();
      if (latestLocal) {
        setProfile(latestLocal);
      }

      if (refreshTimer !== null) {
        refreshQueued = true;
        return;
      }
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void requestProfile(true).then((next) => {
          if (cancelled) return;
          if (next) setProfile(next);
          if (refreshQueued) {
            refreshQueued = false;
            scheduleRefresh();
          }
        });
      }, 450);
    };

    window.addEventListener(personalizationChangedEvent, scheduleRefresh);
    return () => {
      cancelled = true;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.removeEventListener(personalizationChangedEvent, scheduleRefresh);
    };
  }, []);

  return { profile, loading };
}
