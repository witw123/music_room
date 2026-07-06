# Client Update Check Design

## Goal

Music Room clients should tell users when a newer release is available. Desktop clients should offer an in-app download and install flow. Android clients should show a prompt that opens the GitHub Release page for APK download.

## Scope

- Desktop: Tauri updater integration, automatic background check, manual check entry, download/install/relaunch after user confirmation.
- Android: version comparison against the latest GitHub release and an external download prompt.
- Web browser: no automatic update checks.
- Release: keep using the existing `v*` GitHub Actions release flow and publish update metadata from the action.

## Architecture

- `apps/web/src/features/update/update-version.ts` owns pure version/tag parsing and comparison.
- `apps/web/src/features/update/github-release-updates.ts` owns GitHub latest-release parsing for Android.
- `apps/web/src/features/update/client-update-service.ts` selects desktop updater or Android release check based on runtime.
- `apps/web/src/components/ClientUpdateManager.tsx` runs the startup check and renders prompts.
- `apps/desktop/src-tauri` registers the Tauri updater and process plugins, with updater endpoints configured during package builds.

## User Experience

- Startup checks are quiet when there is no update or when the network fails.
- Manual checks report no update, failures, or update availability.
- Desktop update prompt shows the new version and lets the user install now or later.
- Android update prompt opens the GitHub Releases page for APK download.

## Release Requirements

- Desktop updater requires signed artifacts. GitHub Actions must receive `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- The `v0.2.8` tag can be moved to the final implementation commit so the existing release version is rebuilt by GitHub Actions.
