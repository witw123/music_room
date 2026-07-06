# Client Update Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add client update checks where desktop can download/install updates and Android can open the APK download page.

**Architecture:** Put runtime-neutral parsing in small tested TypeScript modules, expose a client update service to React, and register Tauri updater/process plugins in the desktop shell. Extend the release workflow so GitHub Actions signs updater artifacts and publishes update metadata with the installers.

**Tech Stack:** Next.js/React, Vitest, Tauri 2, GitHub Actions, GitHub Releases.

---

### Task 1: Version And Release Parsing

**Files:**
- Create: `apps/web/src/features/update/update-version.ts`
- Create: `apps/web/src/features/update/github-release-updates.ts`
- Create: `apps/web/src/features/update/update-version.test.ts`
- Create: `apps/web/src/features/update/github-release-updates.test.ts`

- [ ] Write tests for `normalizeReleaseVersion`, `compareReleaseVersions`, and latest release asset parsing.
- [ ] Run the new tests and confirm they fail because the modules do not exist.
- [ ] Implement the pure helpers.
- [ ] Run the tests again and confirm they pass.

### Task 2: Runtime Update Service

**Files:**
- Modify: `apps/web/src/lib/desktop-api.ts`
- Create: `apps/web/src/features/update/client-update-service.ts`

- [ ] Add tested service behavior by using the Task 1 helpers for Android and dynamic Tauri plugin imports for desktop.
- [ ] Keep startup failures silent and return structured results for manual checks.

### Task 3: React Prompt

**Files:**
- Create: `apps/web/src/components/ClientUpdateManager.tsx`
- Modify: `apps/web/src/components/Providers.tsx`
- Modify: `apps/web/src/components/RoomsHomePage.tsx`

- [ ] Add a global startup update check in `Providers`.
- [ ] Add a manual "检查更新" entry in the app home header.
- [ ] Render desktop install and Android download prompts without blocking normal app use.

### Task 4: Tauri Updater Wiring

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `apps/desktop/src-tauri/capabilities/default.json`
- Modify: `apps/desktop/scripts/run-tauri.mjs`
- Modify: `apps/desktop/scripts/collect-bundles.mjs`
- Modify: `.github/workflows/release-desktop.yml`

- [ ] Register `tauri-plugin-updater` and `tauri-plugin-process`.
- [ ] Add updater permissions to desktop capability.
- [ ] Add endpoint and public key configuration to Tauri config.
- [ ] Let the build script inject the release endpoint and signer public key from environment variables.
- [ ] Collect updater metadata files into `apps/desktop/release`.
- [ ] Pass signing secrets through GitHub Actions.

### Task 5: Verification And Release

**Files:**
- Modify: release tag `v0.2.8`

- [ ] Run targeted Vitest tests.
- [ ] Run web typecheck.
- [ ] Run desktop Cargo check.
- [ ] Commit the implementation.
- [ ] Move `v0.2.8` to the implementation commit and force-push the tag.
- [ ] Watch the `Release Clients` GitHub Action and verify it publishes all installers and updater metadata.
