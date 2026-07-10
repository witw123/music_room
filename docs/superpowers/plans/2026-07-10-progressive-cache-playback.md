# Progressive Cache Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep first-play progressive audio stable through cache completion and make FLAC WebCodecs decoding reliable with large metadata.

**Architecture:** Playback source initialization remains keyed by the existing playback surface and format, not asynchronous cache readiness. FLAC parsing separates the real audio offset from a canonical STREAMINFO-only decoder description and reports concrete decoder failures.

**Tech Stack:** TypeScript, React, WebCodecs AudioDecoder, Vitest, Next.js

---

### Task 1: Lock Playback Source To The Surface

**Files:**
- Modify: `apps/web/src/components/music-room-app.test.ts`
- Modify: `apps/web/src/components/room/hooks/use-room-page-derived.ts`

- [ ] Change the existing cache-readiness test to require identical initialization keys for the same surface before and after cache completion.
- [ ] Run `pnpm --filter @music-room/web exec vitest run src/components/music-room-app.test.ts` and verify the assertion fails.
- [ ] Remove cache readiness from `getPlaybackSourceInitializationKey()` while retaining surface, track, hash, format, and engine identity.
- [ ] Run the focused test and verify same-surface stability plus next-surface reinitialization pass.

### Task 2: Canonicalize FLAC Decoder Metadata

**Files:**
- Modify: `apps/web/src/features/playback/progressive-flac.test.ts`
- Modify: `apps/web/src/features/playback/progressive-flac.ts`

- [ ] Add a test where STREAMINFO is followed by an incomplete PICTURE block and require parsing to wait.
- [ ] Add a complete large-metadata test requiring the decoder description to be exactly `fLaC + final STREAMINFO header + 34-byte payload` while `audioOffset` remains after all metadata.
- [ ] Run `pnpm --filter @music-room/web exec vitest run src/features/playback/progressive-flac.test.ts` and verify the new assertions fail.
- [ ] Require a complete metadata chain and construct the canonical 42-byte decoder description.
- [ ] Run the focused FLAC tests and verify they pass.

### Task 3: Preserve Decoder Failure Detail

**Files:**
- Modify: `apps/web/src/features/playback/progressive-pcm-engine.test.ts`
- Modify: `apps/web/src/features/playback/progressive-pcm-engine.ts`

- [ ] Change the rejecting-flush regression to require the original error message in `lastDecodeError` and `blockedReason`.
- [ ] Run the focused PCM test and verify it fails with the generic current value.
- [ ] Format flush rejection diagnostics as `decoder-flush-failed: <message>` unless the AudioDecoder error callback already supplied a more specific error.
- [ ] Run all PCM engine tests and verify progressive readiness, concurrency, and failure behavior pass.

### Task 4: Full Verification

**Files:**
- Verify all modified files.

- [ ] Run Web typecheck and lint.
- [ ] Run the Web suite with at most two workers to avoid Windows worker memory exhaustion.
- [ ] Run `pnpm --filter @music-room/web build`.
- [ ] Run `git diff --check` and inspect the final diff for unrelated changes.
