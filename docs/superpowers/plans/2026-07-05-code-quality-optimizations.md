# Code Quality Optimizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the highest-ROI maintenance risks from the Music Room code quality report without destabilizing playback or P2P runtime behavior.

**Architecture:** Start with low-risk safety nets: lint rule restoration, tracked build-cache cleanup, and type-only contract extraction. Then add focused tests for uncovered feature boundary modules and extract pure P2P frame helpers only if typecheck and mesh tests stay controlled.

**Tech Stack:** TypeScript, React, Next.js, Vitest, ESLint flat config, pnpm workspace.

---

## File Structure

- Modify `eslint.config.mjs`: restore selected lint rules for `apps/web` incrementally.
- Modify `.gitignore`: ignore TypeScript build cache files if not already ignored.
- Modify `apps/web/src/features/room/hooks/room-runtime-types.ts`: host shared room runtime diagnostic/ref types.
- Modify `apps/web/src/features/room/hooks/use-room-data-mesh.ts`: replace repeated `any` signatures with shared types.
- Modify `apps/web/src/features/room/hooks/use-room-realtime-connection.ts`: use the same shared types for runtime wiring.
- Create `apps/web/src/features/cache/cache-policy.test.ts`: assert exported cache policy flags.
- Create `apps/web/src/features/player/index.test.ts`: assert player feature boundary export.
- Create `apps/web/src/features/playlist/index.test.ts`: assert playlist feature boundary export.
- Optionally create `apps/web/src/features/p2p/piece-frame-codec.ts` and test it after the safer tasks pass.

## Task 1: Lint And Build Cache Safety Nets

**Files:**
- Modify: `eslint.config.mjs`
- Modify: `.gitignore`

- [x] **Step 1: Restore selected warning/error rules**

Set `react-hooks/exhaustive-deps` to `warn`, keep `@typescript-eslint/no-unused-vars` as `error` for `apps/web`, and set `@typescript-eslint/no-explicit-any` to `warn`.

- [x] **Step 2: Ignore TypeScript build cache**

Add `*.tsbuildinfo` and `**/*.tsbuildinfo` only if the patterns are missing.

- [x] **Step 3: Verification**

Run `pnpm --filter @music-room/web lint`. If the repo already has many warnings because `--max-warnings=0` is configured, capture the warning count and do not widen the change just to silence unrelated legacy warnings.

## Task 2: Shared Room Runtime Types

**Files:**
- Modify: `apps/web/src/features/room/hooks/room-runtime-types.ts`
- Modify: `apps/web/src/features/room/hooks/use-room-data-mesh.ts`
- Modify: `apps/web/src/features/room/hooks/use-room-realtime-connection.ts`

- [x] **Step 1: Define shared diagnostic and transport helper types**

Add narrow aliases for peer diagnostic events, transport-health patching, supervisor state patches, piece transfer windows, and playback recovery recommendations. Prefer structural types already used by the hooks; do not change runtime behavior.

- [x] **Step 2: Replace cross-hook `any` at the input boundary**

Update the two room hooks to consume the shared aliases for `recordPeerDiagnosticRef`, `updateDataTransportStatsRef`, `connectionSupervisorStatesRef`, `withResolvedTransportHealth`, `withSupervisorDiagnosticPatch`, `getPieceTransferRates`, `pieceTransferRatesRef`, and `getPeerMedianRttMs`.

- [x] **Step 3: Verification**

Run focused typecheck or full web typecheck. If pnpm is blocked by dependency approval, use the local TypeScript binary directly and record the blocker.

## Task 3: Feature Boundary Tests

**Files:**
- Create: `apps/web/src/features/cache/cache-policy.test.ts`
- Create: `apps/web/src/features/player/index.test.ts`
- Create: `apps/web/src/features/playlist/index.test.ts`

- [x] **Step 1: Write failing tests**

Add tests that import the existing exports and assert their public values. If they pass immediately because exports already exist, keep them as coverage tests because this task is closing an explicit coverage gap rather than changing behavior.

- [x] **Step 2: Verification**

Run the three new tests with Vitest, then run the existing related web test target if available.

## Task 4: P2P Pure Codec Extraction

**Files:**
- Modify: `apps/web/src/features/p2p/mesh.ts`
- Create: `apps/web/src/features/p2p/piece-frame-codec.ts`
- Create or modify: `apps/web/src/features/p2p/mesh.test.ts`

- [x] **Step 1: Locate already-pure frame helpers**

Move only helpers that are already independent of `P2PMesh` instance state, such as piece-frame build/decode/fragment assembly helpers. Keep public behavior identical.

- [x] **Step 2: Re-export or import without changing callers**

Wire `mesh.ts` to import the helper functions. Avoid changing P2PMesh class behavior in the same task.

- [x] **Step 3: Verification**

Run `apps/web/src/features/p2p/mesh.test.ts` and full web typecheck.

## Task 5: Completion Review

**Files:**
- Inspect: `git diff --stat`
- Inspect: `git diff`

- [x] **Step 1: Confirm scope**

Verify no unrelated user changes were reverted, especially the pre-existing `progressive-pcm-engine.ts` and test edits.

- [x] **Step 2: Final verification**

Run the strongest available combination of lint, typecheck, and focused tests. Report exact commands and blockers.
