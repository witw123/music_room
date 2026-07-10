type RoomPlaybackClockCalibrationInput = {
  serverNow: string | null | undefined;
  requestStartedAtMs: number;
  responseReceivedAtMs: number;
};

type RoomPlaybackClockState = {
  offsetMs: number;
  bestRoundTripMs: number | null;
  calibratedAtMs: number | null;
};

const roomPlaybackClockState: RoomPlaybackClockState = {
  offsetMs: 0,
  bestRoundTripMs: null,
  calibratedAtMs: null
};

const calibrationRefreshMs = 60_000;

export function calibrateRoomPlaybackClock(input: RoomPlaybackClockCalibrationInput) {
  const serverNowMs = input.serverNow ? new Date(input.serverNow).getTime() : Number.NaN;
  const roundTripMs = input.responseReceivedAtMs - input.requestStartedAtMs;
  if (
    !Number.isFinite(serverNowMs) ||
    !Number.isFinite(roundTripMs) ||
    roundTripMs < 0
  ) {
    return false;
  }

  const shouldAcceptSample =
    roomPlaybackClockState.bestRoundTripMs === null ||
    roundTripMs <= roomPlaybackClockState.bestRoundTripMs ||
    roomPlaybackClockState.calibratedAtMs === null ||
    input.responseReceivedAtMs - roomPlaybackClockState.calibratedAtMs >= calibrationRefreshMs;
  if (!shouldAcceptSample) {
    return false;
  }

  const clientMidpointMs = input.requestStartedAtMs + roundTripMs / 2;
  roomPlaybackClockState.offsetMs = serverNowMs - clientMidpointMs;
  roomPlaybackClockState.bestRoundTripMs = roundTripMs;
  roomPlaybackClockState.calibratedAtMs = input.responseReceivedAtMs;
  return true;
}

export function getRoomPlaybackClockNowMs(clientNowMs = Date.now()) {
  return clientNowMs + roomPlaybackClockState.offsetMs;
}

export function getRoomPlaybackClockSnapshot() {
  return { ...roomPlaybackClockState };
}

export function resetRoomPlaybackClockForTests() {
  roomPlaybackClockState.offsetMs = 0;
  roomPlaybackClockState.bestRoundTripMs = null;
  roomPlaybackClockState.calibratedAtMs = null;
}
