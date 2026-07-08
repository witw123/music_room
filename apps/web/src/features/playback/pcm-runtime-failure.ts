// Pure decision helpers for PCM cache-playback runtime failures.
//
// Extracted from use-progressive-runtime.ts so the failure/retry policy can be
// reasoned about and tested in isolation, independent of the large runtime hook.

/**
 * Failures that should latch: the same track will not be retried with the PCM
 * engine until it changes, because the failure is not transient (decoder
 * problems that will recur on the same input).
 */
export function shouldLatchPcmRuntimeFailure(reason: string | null | undefined) {
  return (
    reason === "engine-failed" ||
    reason === "decoder-unavailable" ||
    reason === "decoder-config-failed" ||
    reason === "encoded-audio-chunk-unavailable" ||
    reason === "decoder-flush-failed" ||
    reason === "wav-decode-failed"
  );
}

/**
 * Whether the PCM runtime should be retried for the current track after a prior
 * failure. Always retry on a different track; for the same track only retry if
 * the previous failure was transient (non-latching).
 */
export function shouldRetryPcmRuntimeAfterFailure(input: {
  currentTrackId: string | null | undefined;
  failureTrackId: string | null | undefined;
  failureReason: string | null | undefined;
}) {
  if (!input.currentTrackId || !input.failureTrackId) {
    return true;
  }

  return (
    input.currentTrackId !== input.failureTrackId ||
    !shouldLatchPcmRuntimeFailure(input.failureReason)
  );
}

/**
 * Collapse the current sync blocked reason into a failure reason. The decoder's
 * last error is diagnostic history, so it only refines a current generic engine
 * failure; a recovered sync must not relatch an old decode error.
 */
export function resolvePcmRuntimeFailureReason(input: {
  blockedReason: string | null | undefined;
  lastDecodeError: string | null | undefined;
}) {
  if (!input.blockedReason) {
    return null;
  }

  if (input.blockedReason === "engine-failed" && input.lastDecodeError) {
    return input.lastDecodeError;
  }

  return input.blockedReason;
}
