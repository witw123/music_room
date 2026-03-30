"use client";

import type { ReactNode } from "react";

type LegacyTrackCacheContextValue = never;

// Legacy placeholder: the real cache workflow now lives in
// `features/upload/use-track-uploads.ts`.
export function TrackCacheProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useTrackCache(): LegacyTrackCacheContextValue {
  throw new Error(
    "TrackCacheContext is legacy-only. Use the upload feature hooks from features/upload instead."
  );
}
