"use client";

import { useEffect, useState } from "react";
import {
  appSettingsChangeEvent,
  getAppSettings,
  getDefaultAppSettings,
  type PlayerStyle
} from "./settings-store";

export function usePlayerStyle() {
  const [playerStyle, setPlayerStyle] = useState<PlayerStyle>(
    () => getDefaultAppSettings().playback.playerStyle
  );

  useEffect(() => {
    const syncPlayerStyle = () => setPlayerStyle(getAppSettings().playback.playerStyle);
    syncPlayerStyle();
    window.addEventListener(appSettingsChangeEvent, syncPlayerStyle);
    window.addEventListener("storage", syncPlayerStyle);
    return () => {
      window.removeEventListener(appSettingsChangeEvent, syncPlayerStyle);
      window.removeEventListener("storage", syncPlayerStyle);
    };
  }, []);

  return playerStyle;
}
