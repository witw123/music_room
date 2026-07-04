// Pure decision helpers for PCM cache-playback runtime failures.
//
// Extracted from use-progressive-runtime.ts so the failure/retry policy can be
// reasoned about and tested in isolation, independent of the large runtime hook.

/**
 * Failures that should latch: the same track will not be retried with the PCM
 * engine until it changes, because the failure is not transient (decoder or
 * cache problems that will recur on the same input).
 */
export function shouldLatchPcmRuntimeFailure(reason: string | null | undefined) {
  return (
    reason === "engine-failed" ||
    reason === "decoder-unavailable" ||
    reason === "decoder-config-failed" ||
    reason === "encoded-audio-chunk-unavailable" ||
    reason === "decoder-flush-failed" ||
    reason === "cache-read-failed" ||
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
 * Collapse a sync blocked reason and the decoder's last error into a single
 * failure reason. A generic "engine-failed" is replaced with the more specific
 * decoder error when available.
 */
export function resolvePcmRuntimeFailureReason(input: {
  blockedReason: string | null | undefined;
  lastDecodeError: string | null | undefined;
}) {
  if (input.blockedReason === "engine-failed" && input.lastDecodeError) {
    return input.lastDecodeError;
  }

  return input.blockedReason ?? input.lastDecodeError ?? null;
}
