# Diagnostics View Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw and contradictory cache-playback diagnostics with one precise view model, a compact default summary, and human-readable developer details.

**Architecture:** Add a pure presentation selector beside the room diagnostic components. Both `MembersPanel` and `MeshStatusPanel` consume its derived audibility, cache, transfer, sync, and link states instead of independently interpreting raw telemetry. Runtime diagnostic collection remains unchanged so playback recovery keeps all of its existing inputs.

**Tech Stack:** TypeScript, React 19, Vitest, Next.js 15, Tailwind CSS

---

## File Structure

- Create `apps/web/src/components/room/diagnostics-view-model.ts`: pure status derivation, freshness checks, readable labels, and two-layer field models.
- Create `apps/web/src/components/room/diagnostics-view-model.test.ts`: behavioral coverage for audibility, cache readability, transfer freshness, sync precision, and link counts.
- Modify `apps/web/src/components/room/MembersPanel.tsx`: use the shared status result and remove the raw PCM/audio field dump.
- Modify `apps/web/src/components/room/MembersPanel.test.ts`: update member playback expectations to match the authoritative selector.
- Modify `apps/web/src/components/room/MeshStatusPanel.tsx`: render compact summary plus four developer-detail groups; remove IDs and raw implementation fields.
- Modify `apps/web/src/components/room/MeshStatusPanel.test.ts`: verify exact summary fields, detail groups, zero DataChannel behavior, and absence of internal identifiers.

### Task 1: Build the pure diagnostic view model

**Files:**
- Create: `apps/web/src/components/room/diagnostics-view-model.ts`
- Create: `apps/web/src/components/room/diagnostics-view-model.test.ts`

- [ ] **Step 1: Write failing audibility and cache tests**

Create fixtures where `activeSource="lossless-local"` has no PCM output, where browser permission is pending, where PCM has decoded and scheduled output, and where `262/262` visible pieces still have `pcmContiguousChunkCount=0`. Assert the labels are respectively `等待 PCM 数据`, `等待音频授权`, `正在发声`, and `已声明完整分片 · PCM 尚未读取`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm --dir apps/web exec vitest run src/components/room/diagnostics-view-model.test.ts`

Expected: FAIL because `buildDiagnosticsViewModel` does not exist.

- [ ] **Step 3: Implement minimal typed status derivation**

Export these stable contracts:

```ts
export type DiagnosticTone = "neutral" | "success" | "warning" | "danger";

export type DiagnosticsViewModel = {
  audibility: { label: string; detail: string; tone: DiagnosticTone };
  playbackMode: string;
  cache: {
    visibleChunks: number;
    totalChunks: number;
    pcmContiguousChunks: number | null;
    progressLabel: string;
    aheadLabel: string;
    healthLabel: string;
    tone: DiagnosticTone;
  };
  sync: { label: string; detail: string; tone: DiagnosticTone };
  transfer: { active: boolean; downloadLabel: string; uploadLabel: string; sampleLabel: string };
  dataLink: { openCount: number; label: string; detail: string; tone: DiagnosticTone };
  activeIssue: string | null;
};
```

Use `pcmDecodedSegmentCount`, `pcmScheduledSegmentCount`, `pcmAudioContextState`, and `pcmDirectOutputConnected` to prove PCM output. Give pending permission and explicit failures higher priority than generic PCM waiting. Treat visible cache completion and PCM continuity as separate facts.

- [ ] **Step 4: Add transfer, sync, and zero-link tests**

Cover rates `0`, positive rates with a fresh sample, positive rates older than 6 seconds, average drift with a fresh diagnostic, missing drift, and `dataReadyCount=0` while `connectedPeersCount>0`.

- [ ] **Step 5: Implement freshness and readable severity rules**

Use the existing six-second diagnostic freshness boundary. A transfer is active only when a fresh rate is greater than zero. Sync has no valid sample when drift is absent or stale; use existing playback drift policy boundaries where available, otherwise keep thresholds localized and named in the selector.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `pnpm --dir apps/web exec vitest run src/components/room/diagnostics-view-model.test.ts`

Expected: all view-model tests pass.

### Task 2: Make the member status consume the shared model

**Files:**
- Modify: `apps/web/src/components/room/MembersPanel.tsx`
- Modify: `apps/web/src/components/room/MembersPanel.test.ts`

- [ ] **Step 1: Write failing member-status tests**

Add cases proving that `lossless-local` without scheduled PCM is not reported as audible, an explicit pause is not a fault, zero transfer rate is not “分片传输中”, and a complete announcement uses “已声明完整分片”.

- [ ] **Step 2: Run member tests and verify RED**

Run: `pnpm --dir apps/web exec vitest run src/components/room/MembersPanel.test.ts`

Expected: at least the complete-announcement or zero-rate assertion fails against current wording.

- [ ] **Step 3: Replace duplicated playback interpretation**

Route `getPlaybackStatus` through the pure selector. Keep presence-state handling, but remove the duplicate `getLocalAudioPlaybackIssue` implementation and the raw audio/PCM metric grid from each local member card.

- [ ] **Step 4: Render a compact local summary**

Show actual playback, readable mode, visible/total pieces, PCM continuous pieces, buffer health, sync status, and one active issue. Do not render raw `readyState`, `src`, `srcObject`, paused, muted, volume, scheduler enum, or repeated PCM errors.

- [ ] **Step 5: Run member tests and verify GREEN**

Run: `pnpm --dir apps/web exec vitest run src/components/room/MembersPanel.test.ts src/components/room/diagnostics-view-model.test.ts`

Expected: all focused tests pass.

### Task 3: Rebuild advanced diagnostics as two layers

**Files:**
- Modify: `apps/web/src/components/room/MeshStatusPanel.tsx`
- Modify: `apps/web/src/components/room/MeshStatusPanel.test.ts`

- [ ] **Step 1: Write failing component source/behavior tests**

Assert the summary includes actual playback, playback mode, cache readability, buffer, sync, active issue, and exact DataChannel count. Assert developer details contain `音频与 PCM`, `缓存传输`, `同步`, and `数据链路`. Assert rendered/source text excludes `playbackSurfaceKey`, `playbackTimelineKey`, raw peer IDs, `readyState`, `srcObject`, and raw scheduler/recovery enums.

- [ ] **Step 2: Run component tests and verify RED**

Run: `pnpm --dir apps/web exec vitest run src/components/room/MeshStatusPanel.test.ts`

Expected: FAIL because the current component renders the raw field grid and `dataReadyCount || connectedPeersCount`.

- [ ] **Step 3: Implement the default summary layer**

Render the shared view model in a compact unframed summary grid. Replace the Data count fallback with the exact open-channel count. Hide the issue row when `activeIssue` is null.

- [ ] **Step 4: Implement the developer-detail layer**

Group only readable metrics into four `DiagnosticBlock`s. Map diagnostics to member nickname/role; use `房间成员` when mapping fails. Remove peer IDs from cards and recent events. Translate connection/recovery enums to readable Chinese labels before rendering.

- [ ] **Step 5: Remove obsolete UI props and helpers**

Narrow `LocalMemberPanelState["cachePlayback"]` to fields consumed by the selector and developer detail. Delete unused formatters and raw-field JSX. Keep shared runtime schema untouched unless repository-wide search proves a field has no non-UI consumer.

- [ ] **Step 6: Run component and selector tests and verify GREEN**

Run: `pnpm --dir apps/web exec vitest run src/components/room/MeshStatusPanel.test.ts src/components/room/MembersPanel.test.ts src/components/room/diagnostics-view-model.test.ts`

Expected: all focused tests pass.

### Task 4: Verify the complete Web application

**Files:**
- Modify only files required by failures attributable to this diagnostic refactor.

- [ ] **Step 1: Review the final diff for scope and internal identifiers**

Run:

```powershell
git diff --check
rg -n "playbackSurfaceKey|playbackTimelineKey|peer\.peerId|readyState|srcObject" apps/web/src/components/room/MembersPanel.tsx apps/web/src/components/room/MeshStatusPanel.tsx
```

Expected: clean diff and no forbidden rendered fields.

- [ ] **Step 2: Run all Web tests**

Run: `pnpm --dir apps/web exec vitest run --maxWorkers=2`

Expected: all test files and tests pass.

- [ ] **Step 3: Run static verification**

Run:

```powershell
pnpm --filter @music-room/web typecheck
pnpm --filter @music-room/web lint
pnpm --filter @music-room/web build
```

Expected: all commands exit zero; only existing Next.js warnings are allowed.

- [ ] **Step 4: Commit and push**

```powershell
git add apps/web/src/components/room docs/superpowers/plans/2026-07-10-diagnostics-view-model.md
git commit -m "精简并校准缓存播放诊断"
git push origin main
```

Expected: `HEAD` and `origin/main` resolve to the same commit.
