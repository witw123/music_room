import type {
  PeerDiagnosticsSnapshot,
  RoomMediaConnectionState
} from "@music-room/shared";
import type { PeerConnectionStatsSample } from "./connection-stats";

export type PeerTransportScore = "healthy" | "degraded" | "unstable" | "failed";
export type PeerRecoveryStage =
  | "idle"
  | "soft"
  | "ice-restart"
  | "hard-recreate"
  | "full-resubscribe";
export type StableTransportKind = "direct" | "relay";

type SupervisorSample = {
  timestampMs: number;
  candidateType: string | null;
  protocol: string | null;
  currentRoundTripTimeMs: number | null;
  availableOutgoingBitrateKbps: number | null;
  packetLossRate: number | null;
  jitterMs: number | null;
  mediaReceiveBitrateKbps: number | null;
  dataChannelState: string | null;
  dataConnectionState: string | null;
  mediaConnectionState: string | null;
  dataIceState: string | null;
  mediaIceState: string | null;
};

type RecoveryBudgetState = {
  lastSoftAtByGeneration: Record<string, number>;
  lastIceRestartAtMs: number | null;
  lastHardRecreateAtMs: number | null;
  lastFullResubscribeAtMs: number | null;
};

export type PeerConnectionSupervisorState = {
  peerId: string;
  roomId: string;
  transportScore: PeerTransportScore;
  recoveryStage: PeerRecoveryStage;
  stableTransportKind: StableTransportKind | null;
  preferredTransportKind: StableTransportKind | null;
  lastFailureReason: string | null;
  lastRecoveryAction: RecoveryBudgetAction | null;
  iceRestartCount: number;
  hardRecreateCount: number;
  dataChannelState: string | null;
  dataConnectionState: string | null;
  mediaConnectionState: string | null;
  dataIceState: string | null;
  mediaIceState: string | null;
  lastSignalStateAtMs: number;
  lastTransportProgressAtMs: number | null;
  lastPlayoutProgressAtMs: number | null;
  samples: SupervisorSample[];
  consecutiveDegradedWindows: number;
  consecutiveUnstableWindows: number;
  consecutiveHealthyWindows: number;
  healthyTransportSinceMs: number | null;
  lastObservedTransportKind: StableTransportKind | null;
  recoveryBudget: RecoveryBudgetState;
};

type ObserveTransportInput = {
  state: PeerConnectionSupervisorState;
  sample: PeerConnectionStatsSample;
  diagnostics?: Pick<
    PeerDiagnosticsSnapshot,
    "dataChannelState" | "dataConnectionState" | "mediaConnectionState" | "dataIceState" | "mediaIceState"
  > | null;
  now?: number;
};

type NoteSignalStateInput = {
  state: PeerConnectionSupervisorState;
  dataChannelState?: string | null;
  dataConnectionState?: string | null;
  mediaConnectionState?: string | null;
  dataIceState?: string | null;
  mediaIceState?: string | null;
  lastFailureReason?: string | null;
  now?: number;
};

type RecoveryBudgetAction = "soft" | "ice-restart" | "hard-recreate" | "full-resubscribe";

const supervisorWindowMs = 5_000;
const stableTransportPersistWindowMs = 30_000;
const stableTransportTtlMs = 30 * 60_000;
const softRecoveryBudgetMs = 800;
const iceRestartBudgetMs = 2_500;
const hardRecreateBudgetMs = 8_000;
const fullResubscribeBudgetMs = 15_000;
const storageKeyPrefix = "music-room:stable-transport";

export function createPeerConnectionSupervisorState(input: {
  peerId: string;
  roomId: string;
  now?: number;
}): PeerConnectionSupervisorState {
  const now = input.now ?? Date.now();
  const storedTransportKind = loadStableTransportKind(input.roomId, input.peerId, now);

  return {
    peerId: input.peerId,
    roomId: input.roomId,
    transportScore: "healthy",
    recoveryStage: "idle",
    stableTransportKind: storedTransportKind,
    preferredTransportKind: storedTransportKind,
    lastFailureReason: null,
    lastRecoveryAction: null,
    iceRestartCount: 0,
    hardRecreateCount: 0,
    dataChannelState: null,
    dataConnectionState: null,
    mediaConnectionState: null,
    dataIceState: null,
    mediaIceState: null,
    lastSignalStateAtMs: now,
    lastTransportProgressAtMs: null,
    lastPlayoutProgressAtMs: null,
    samples: [],
    consecutiveDegradedWindows: 0,
    consecutiveUnstableWindows: 0,
    consecutiveHealthyWindows: 0,
    healthyTransportSinceMs: null,
    lastObservedTransportKind: storedTransportKind,
    recoveryBudget: {
      lastSoftAtByGeneration: {},
      lastIceRestartAtMs: null,
      lastHardRecreateAtMs: null,
      lastFullResubscribeAtMs: null
    }
  };
}

export function notePeerSignalState(input: NoteSignalStateInput) {
  const now = input.now ?? Date.now();
  const lastFailureReason = resolveLastFailureReason(input);

  return {
    ...input.state,
    dataChannelState: input.dataChannelState ?? input.state.dataChannelState,
    dataConnectionState: input.dataConnectionState ?? input.state.dataConnectionState,
    mediaConnectionState: input.mediaConnectionState ?? input.state.mediaConnectionState,
    dataIceState: input.dataIceState ?? input.state.dataIceState,
    mediaIceState: input.mediaIceState ?? input.state.mediaIceState,
    lastSignalStateAtMs: now,
    lastFailureReason
  };
}

export function observePeerTransport(input: ObserveTransportInput) {
  const now = input.now ?? Date.now();
  const nextSample: SupervisorSample = {
    timestampMs: now,
    candidateType: input.sample.candidateType,
    protocol: input.sample.protocol,
    currentRoundTripTimeMs: input.sample.currentRoundTripTimeMs,
    availableOutgoingBitrateKbps: input.sample.availableOutgoingBitrateKbps,
    packetLossRate: input.sample.packetLossRate ?? null,
    jitterMs: input.sample.jitterMs,
    mediaReceiveBitrateKbps: input.sample.mediaReceiveBitrateKbps,
    dataChannelState: input.diagnostics?.dataChannelState ?? null,
    dataConnectionState: input.diagnostics?.dataConnectionState ?? null,
    mediaConnectionState: input.diagnostics?.mediaConnectionState ?? null,
    dataIceState: input.diagnostics?.dataIceState ?? null,
    mediaIceState: input.diagnostics?.mediaIceState ?? null
  };
  const samples = [...input.state.samples, nextSample].filter(
    (sample) => now - sample.timestampMs <= supervisorWindowMs
  );
  const windowClassification = classifyTransportWindow(samples);

  let consecutiveDegradedWindows =
    windowClassification === "degraded" ? input.state.consecutiveDegradedWindows + 1 : 0;
  let consecutiveUnstableWindows =
    windowClassification === "unstable" || windowClassification === "failed"
      ? input.state.consecutiveUnstableWindows + 1
      : 0;
  let consecutiveHealthyWindows =
    windowClassification === "healthy" ? input.state.consecutiveHealthyWindows + 1 : 0;

  let transportScore = input.state.transportScore;
  if (windowClassification === "failed") {
    transportScore = "failed";
  } else if (windowClassification === "unstable") {
    transportScore = consecutiveUnstableWindows >= 2 ? "unstable" : transportScore;
  } else if (windowClassification === "degraded") {
    if (transportScore === "unstable") {
      transportScore = consecutiveHealthyWindows >= 2 ? "degraded" : transportScore;
    } else {
      transportScore = consecutiveDegradedWindows >= 2 ? "degraded" : transportScore;
    }
  } else {
    if (transportScore === "failed") {
      transportScore = consecutiveHealthyWindows >= 3 ? "degraded" : transportScore;
    } else if (transportScore === "unstable") {
      transportScore = consecutiveHealthyWindows >= 2 ? "degraded" : transportScore;
    } else if (transportScore === "degraded") {
      transportScore = consecutiveHealthyWindows >= 3 ? "healthy" : transportScore;
    } else {
      transportScore = "healthy";
    }
  }

  const observedTransportKind = resolveTransportKind(nextSample.candidateType);
  let healthyTransportSinceMs = input.state.healthyTransportSinceMs;
  let stableTransportKind = input.state.stableTransportKind;
  let preferredTransportKind = input.state.preferredTransportKind;
  if (transportScore === "healthy" && observedTransportKind) {
    if (input.state.lastObservedTransportKind !== observedTransportKind) {
      healthyTransportSinceMs = now;
    } else if (healthyTransportSinceMs === null) {
      healthyTransportSinceMs = now;
    }

    if (
      healthyTransportSinceMs !== null &&
      now - healthyTransportSinceMs >= stableTransportPersistWindowMs
    ) {
      stableTransportKind = observedTransportKind;
      preferredTransportKind = observedTransportKind;
      persistStableTransportKind(input.state.roomId, input.state.peerId, observedTransportKind, now);
    }
  } else {
    healthyTransportSinceMs = null;
  }

  if (
    (input.state.iceRestartCount >= 2 || input.state.hardRecreateCount >= 2) &&
    preferredTransportKind !== "relay"
  ) {
    preferredTransportKind = "relay";
  }

  return {
    ...input.state,
    samples,
    transportScore,
    stableTransportKind,
    preferredTransportKind,
    healthyTransportSinceMs,
    lastObservedTransportKind: observedTransportKind ?? input.state.lastObservedTransportKind,
    consecutiveDegradedWindows,
    consecutiveUnstableWindows,
    consecutiveHealthyWindows,
    lastTransportProgressAtMs:
      typeof input.sample.mediaReceiveBitrateKbps === "number" && input.sample.mediaReceiveBitrateKbps > 0
        ? now
        : input.state.lastTransportProgressAtMs
  };
}

export function recordPeerPlayoutProgress(
  state: PeerConnectionSupervisorState,
  now = Date.now()
) {
  return {
    ...state,
    lastPlayoutProgressAtMs: now
  };
}

export function canRunRecoveryAction(input: {
  state: PeerConnectionSupervisorState;
  action: RecoveryBudgetAction;
  generation?: string | null;
  now?: number;
}) {
  const now = input.now ?? Date.now();

  if (input.action === "soft") {
    const generationKey = input.generation ?? "default";
    const lastSoftAt = input.state.recoveryBudget.lastSoftAtByGeneration[generationKey] ?? null;
    return lastSoftAt === null || now - lastSoftAt >= softRecoveryBudgetMs;
  }

  if (input.action === "ice-restart") {
    return (
      input.state.recoveryBudget.lastIceRestartAtMs === null ||
      now - input.state.recoveryBudget.lastIceRestartAtMs >= iceRestartBudgetMs
    );
  }

  if (input.action === "hard-recreate") {
    return (
      input.state.recoveryBudget.lastHardRecreateAtMs === null ||
      now - input.state.recoveryBudget.lastHardRecreateAtMs >= hardRecreateBudgetMs
    );
  }

  return (
    input.state.recoveryBudget.lastFullResubscribeAtMs === null ||
    now - input.state.recoveryBudget.lastFullResubscribeAtMs >= fullResubscribeBudgetMs
  );
}

export function markRecoveryAction(input: {
  state: PeerConnectionSupervisorState;
  action: RecoveryBudgetAction;
  generation?: string | null;
  failureReason?: string | null;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const nextBudget: RecoveryBudgetState = {
    ...input.state.recoveryBudget,
    lastSoftAtByGeneration: {
      ...input.state.recoveryBudget.lastSoftAtByGeneration
    }
  };
  const generationKey = input.generation ?? "default";

  if (input.action === "soft") {
    nextBudget.lastSoftAtByGeneration[generationKey] = now;
  } else if (input.action === "ice-restart") {
    nextBudget.lastIceRestartAtMs = now;
  } else if (input.action === "hard-recreate") {
    nextBudget.lastHardRecreateAtMs = now;
  } else {
    nextBudget.lastFullResubscribeAtMs = now;
  }

  return {
    ...input.state,
    recoveryStage: input.action,
    lastRecoveryAction: input.action,
    lastFailureReason: input.failureReason ?? input.state.lastFailureReason,
    iceRestartCount:
      input.action === "ice-restart"
        ? input.state.iceRestartCount + 1
        : input.state.iceRestartCount,
    hardRecreateCount:
      input.action === "hard-recreate"
        ? input.state.hardRecreateCount + 1
        : input.state.hardRecreateCount,
    preferredTransportKind:
      input.action === "ice-restart" || input.action === "hard-recreate"
        ? input.state.iceRestartCount + input.state.hardRecreateCount + 1 >= 2
          ? "relay"
          : input.state.preferredTransportKind
        : input.state.preferredTransportKind,
    recoveryBudget: nextBudget
  };
}

export function resetRecoveryStage(
  state: PeerConnectionSupervisorState
): PeerConnectionSupervisorState {
  return state.recoveryStage === "idle"
    ? state
    : {
        ...state,
        recoveryStage: "idle"
      };
}

export function toSupervisorDiagnosticPatch(state: PeerConnectionSupervisorState) {
  return {
    transportScore: state.transportScore,
    stableTransportKind: state.stableTransportKind,
    lastFailureReason: state.lastFailureReason,
    lastRecoveryAction: state.lastRecoveryAction,
    iceRestartCount: state.iceRestartCount,
    hardRecreateCount: state.hardRecreateCount
  } as const;
}

export function resolvePreferredIceTransportPolicy(
  state: PeerConnectionSupervisorState | null | undefined
) {
  return state?.preferredTransportKind === "relay" ? "relay" : "all";
}

export function resolveTransportKind(candidateType: string | null | undefined): StableTransportKind | null {
  if (!candidateType) {
    return null;
  }

  return candidateType === "relay" ? "relay" : "direct";
}

function classifyTransportWindow(samples: SupervisorSample[]): PeerTransportScore {
  const latest = samples[samples.length - 1] ?? null;
  if (!latest) {
    return "healthy";
  }

  const iceFailed = [latest.dataIceState, latest.mediaIceState].some(
    (state) => state === "failed" || state === "closed"
  );
  const connectionFailed = [latest.dataConnectionState, latest.mediaConnectionState].some(
    (state) => state === "failed" || state === "closed"
  );
  if (iceFailed || connectionFailed) {
    return "failed";
  }

  const averageRttMs = averageOf(samples.map((sample) => sample.currentRoundTripTimeMs));
  const averageLossRate = averageOf(samples.map((sample) => sample.packetLossRate));
  const averageJitterMs = averageOf(samples.map((sample) => sample.jitterMs));
  const averageReceiveBitrateKbps = averageOf(
    samples.map((sample) => sample.mediaReceiveBitrateKbps)
  );
  const averageDataOpenRatio =
    samples.filter((sample) => sample.dataChannelState === "open").length / samples.length;
  const checkingRatio =
    samples.filter(
      (sample) =>
        sample.dataIceState === "checking" ||
        sample.mediaIceState === "checking" ||
        sample.dataConnectionState === "disconnected" ||
        sample.mediaConnectionState === "disconnected"
    ).length / samples.length;

  if (
    (typeof averageRttMs === "number" && averageRttMs >= 220) ||
    (typeof averageLossRate === "number" && averageLossRate >= 8) ||
    (typeof averageJitterMs === "number" && averageJitterMs >= 45) ||
    (typeof averageReceiveBitrateKbps === "number" && averageReceiveBitrateKbps <= 4) ||
    checkingRatio >= 0.75
  ) {
    return "unstable";
  }

  if (
    (typeof averageRttMs === "number" && averageRttMs >= 140) ||
    (typeof averageLossRate === "number" && averageLossRate >= 3) ||
    (typeof averageJitterMs === "number" && averageJitterMs >= 20) ||
    averageDataOpenRatio < 0.75 ||
    checkingRatio >= 0.4
  ) {
    return "degraded";
  }

  return "healthy";
}

function averageOf(values: Array<number | null>) {
  const resolved = values.filter((value): value is number => typeof value === "number");
  if (resolved.length === 0) {
    return null;
  }

  return resolved.reduce((sum, value) => sum + value, 0) / resolved.length;
}

function resolveLastFailureReason(input: NoteSignalStateInput) {
  if (input.lastFailureReason !== undefined) {
    return input.lastFailureReason;
  }

  const mediaConnectionState = input.mediaConnectionState as RoomMediaConnectionState | null | undefined;
  if (mediaConnectionState === "failed") {
    return "media-failed";
  }

  if (input.dataConnectionState === "failed") {
    return "data-failed";
  }

  if (input.mediaIceState === "failed" || input.dataIceState === "failed") {
    return "ice-failed";
  }

  return input.state.lastFailureReason;
}

function loadStableTransportKind(roomId: string, peerId: string, now: number) {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(buildStableTransportStorageKey(roomId, peerId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as {
      transportKind?: StableTransportKind;
      expiresAtMs?: number;
    };
    if (
      (parsed.transportKind !== "direct" && parsed.transportKind !== "relay") ||
      typeof parsed.expiresAtMs !== "number" ||
      parsed.expiresAtMs <= now
    ) {
      window.localStorage.removeItem(buildStableTransportStorageKey(roomId, peerId));
      return null;
    }

    return parsed.transportKind;
  } catch {
    window.localStorage.removeItem(buildStableTransportStorageKey(roomId, peerId));
    return null;
  }
}

function persistStableTransportKind(
  roomId: string,
  peerId: string,
  transportKind: StableTransportKind,
  now: number
) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    buildStableTransportStorageKey(roomId, peerId),
    JSON.stringify({
      transportKind,
      expiresAtMs: now + stableTransportTtlMs
    })
  );
}

function buildStableTransportStorageKey(roomId: string, peerId: string) {
  return `${storageKeyPrefix}:${roomId}:${peerId}`;
}
