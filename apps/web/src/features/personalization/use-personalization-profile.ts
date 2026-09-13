"use client";

import { useEffect, useState } from "react";
import type { PersonalizationProfileResponse } from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { personalizationChangedEvent } from "./use-personalization-reporter";

// Module-level cache shared by the profile header and the taste tab, so both
// consumers read from a single request per visit instead of fetching twice.
let cachedProfile: PersonalizationProfileResponse | null = null;
let inFlightRequest: Promise<PersonalizationProfileResponse | null> | null = null;

function requestProfile(force: boolean) {
  if (inFlightRequest) {
    return inFlightRequest;
  }
  if (!force && cachedProfile) {
    return Promise.resolve(cachedProfile);
  }
  inFlightRequest = musicRoomApi.getPersonalizationProfile()
    .then((profile) => {
      cachedProfile = profile;
      return profile;
    })
    .catch(() => cachedProfile)
    .finally(() => {
      inFlightRequest = null;
    });
  return inFlightRequest;
}

export function usePersonalizationProfile() {
  const [profile, setProfile] = useState<PersonalizationProfileResponse | null>(cachedProfile);
  const [loading, setLoading] = useState(cachedProfile === null);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: number | null = null;
    let refreshQueued = false;

    if (cachedProfile) {
      setProfile(cachedProfile);
      setLoading(false);
    } else {
      setLoading(true);
      void requestProfile(false).then((next) => {
        if (cancelled) return;
        setProfile(next);
        setLoading(false);
      });
    }

    // Listening activity reports stream in bursts; debounce reloads like the
    // profile tab did before this hook was shared with the header.
    const scheduleRefresh = () => {
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
