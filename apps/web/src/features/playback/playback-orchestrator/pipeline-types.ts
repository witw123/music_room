export type PlaybackRecoveryStage =
  | "startup-buffering"
  | "steady"
  | "degraded"
  | "shadow-catchup"
  | "audible-local-fallback";

export type SchedulerBudgetTier = "critical" | "protected" | "comfort" | "expanded";

export type TransportGovernorMode =
  | "bootstrap"
  | "segment-catchup"
  | "local-primary"
  | "emergency-fallback";

export type FullLocalPlaybackSessionState = {
  key: string | null;
  availableInSession: boolean;
};
