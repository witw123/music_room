# Music Room

[English](./README.md) | [中文](./README.zh-CN.md)

[![Node](https://img.shields.io/badge/Node.js-22.x-339933)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220)](https://pnpm.io/)

Music Room is a multi-client collaborative music-room application for listening to users' own local audio and imported tracks together in real time. The monorepo contains the Next.js Web client, Tauri 2 desktop app, Capacitor 7 mobile app, NestJS server, and shared frontend/server contracts.

Current workspace version: `0.3.2`<br>
Documentation snapshot: `2026-09`

## Product Scope

The server owns accounts, rooms, permissions, queues, playback, realtime state, and track metadata. Audio files are not persisted by the server. Each client stores the files and generated playback assets for that user's own imports locally in IndexedDB (with optional local directory backup via the File System Access API where supported).

The room does not download or exchange audio assets between members. A track owner publishes the already prepared segmented Opus playback asset over the room's WebRTC media connection; listeners receive one RTP Opus stream. NetEase and QQ Music imports are temporarily proxied by the server, then converted into the same client-local playback flow.

## Current Status

The core product loop is stable and runnable across Web, desktop, and mobile platforms:

- **Multi-Client Ecosystem**:
  - Responsive Web Client: adaptive desktop and mobile browser experience with PWA support
  - Desktop Client (Tauri 2): Windows SMTC (System Media Transport Controls) integration, desktop floating lyrics window, and native media shortcut keys
  - Mobile Client (Capacitor 7): native Android MediaSession integration, background audio playback, notification drawer, and lock-screen media controls
  - System Media Bridge: unified bridge connecting playback state to Windows SMTC, Android MediaSession, and Web MediaSession API
- **Room Modes & Collaboration**:
  - Standard Room: collaborative shared queue, playback permissions (`player` permission), and realtime WebRTC audio broadcast
  - Request Room / Radio Mode: host controls playback; guests search tracks and submit song requests to the host inbox for approval
  - Live Interaction: real-time floating emoji reactions toolbar synchronized across room members
  - Multi-Device Playback Source Isolation: media sources are isolated by device session to prevent audio stalls when the same user logs in on multiple devices
- **Lyrics System**:
  - Standard LRC scrolling lyrics and NetEase YRC verbatim/word-by-word lyrics (via `lyric_new`)
  - Bilingual translated lyrics and romanized pronunciation lyrics displayed in parallel
  - Mobile immersive fullscreen lyrics (tap outside to smoothly toggle album artwork) and desktop floating lyrics overlay
  - Unified multi-tier lyrics caching in IndexedDB
- **Search & Discovery**:
  - Universal `SearchBar` component with robust mobile Chinese IME composition handling, resolving text overwrites and clobbering issues
  - Real-time search suggestions (autocomplete), hot search keywords, and local search history
  - Cross-platform search across local library, NetEase Cloud Music, and QQ Music (songs, albums, playlists)
- **Playback Architecture**:
  - SegmentedOpusEngine + shared AudioContext + WebRTC RTP broadcast (track owner is the single media source)
  - Seamless offline fallback for provider tracks when the track owner disconnects
  - Low-overhead server watchdog with targeted active-room polling to prevent unnecessary CPU load
- **Diagnostics Panel**:
  - Real-time diagnostics for AudioContext state, buffer queues, limiter peak/RMS, RTP bitrate, jitter, packet loss, and Track Identity

The playback path is:

```text
IndexedDB segmented Opus
  -> SegmentedOpusEngine
  -> shared AudioContext output bus
  -> MediaStreamAudioDestinationNode
  -> WebRTC RTP Opus
  -> one listener audio.srcObject
```

More details:

- [Project status](./docs/engineering/status.md)
- [Architecture overview](./docs/architecture/overview.md)
- [Playback synchronization](./docs/architecture/playback-sync.md)
- [Roadmap](./docs/engineering/roadmap.md)
- [Testing strategy](./docs/engineering/testing.md)
- [Local development setup](./docs/engineering/setup.md)

## Documentation

Recommended reading order:

- [Documentation overview](./docs/README.md)
- [API documentation overview](./docs/api/README.md)
- [REST API](./docs/api/rest.md)
- [WebSocket events](./docs/api/websocket-events.md)
- [Shared models](./docs/api/shared-models.md)
- [Testing playbook](./docs/api/testing-playbook.md)
- [Deployment guide](./docs/deployment/deployment.md)

## Repository Layout

- `apps/web`: Next.js 15 Web client, responsive workspace, local asset preparation, playback engine, and WebRTC
- `apps/desktop`: Tauri 2 cross-platform desktop client with Windows SMTC and desktop lyrics
- `apps/mobile`: Capacitor 7 mobile client with native Android MediaSession and background playback service
- `apps/server`: NestJS 11 API, room/provider services, Prisma ORM, persistence, and Socket.IO signaling
- `packages/shared`: Shared contracts, TypeScript type definitions, and Zod validation models
- `packages/opus-encode`: Browser-side Ogg Opus encoder package used by the import pipeline
- `packages/config-*`: Monorepo shared TypeScript and ESLint configuration

## Feature Overview

- **Multi-Client Architecture**: Web client, Tauri 2 desktop app, Capacitor 7 mobile app
- **System Media Integration**: Windows SMTC, Android MediaSession notification/lock-screen controls, and Web MediaSession API
- **Room Modes**: Standard collaborative room, Request/Radio room (guest requests + host approval), and live emoji reactions
- **Playback Control & Sync**: Shared playback queue, player permission control, WebRTC RTP broadcast, and provider offline fallback
- **Lyrics Experience**: Synced LRC, NetEase YRC verbatim lyrics, bilingual translations, romanized lyrics, mobile immersive view, and desktop floating lyrics
- **Audio Asset Management**: Local audio import, personal library recovery, playlist management, and local directory sync
- **Online Provider Integration**: Optional NetEase and QQ Music account binding, search, playlists, albums, and local import
- **Personalization**: Favorite albums, profile/settings workspace, themes, away-room resume, and client update checker
- **End-to-End Diagnostics**: Connection, signaling, ICE state, Web Audio scheduling, and RTP stream quality metrics
- **Resilient Traversal**: Server-issued short-lived TURN credentials with static ICE configuration fallback

The WebRTC `music-room-control` DataChannel carries control/health coordination only. It is not an audio asset or cache transfer channel.

## Quick Start

### Requirements

- Node.js 22.x
- pnpm 10.x
- PostgreSQL 16.x
- Redis 7.x
- Docker / Docker Compose (recommended for local database and service dependencies)
- A modern browser with IndexedDB, Web Audio, and WebRTC support
- (Optional) Rust / Cargo toolchain (for Tauri desktop development)
- (Optional) Android Studio / Xcode (for Capacitor mobile development)

### Local Development

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres redis
pnpm --filter @music-room/server db:push
pnpm dev
```

On PowerShell, use `Copy-Item .env.example .env` for the second command. The local template uses development-only authentication fallback storage, but PostgreSQL is still needed for normal room and metadata persistence and Redis is needed for realtime playback control.

Default addresses:

- Web: `http://localhost:3000`
- Server: `http://localhost:3001`
- Health: `http://localhost:3001/health`

Development entries:

- Website: `/`
- Client workspace: `/app`
- Login page: `/auth`
- Room entry: `/rooms`

### Common Commands

```bash
# Development and build
pnpm dev                  # Start Web and Server development servers
pnpm build                # Build all packages and apps in the monorepo
pnpm typecheck            # Run TypeScript typechecks
pnpm test                 # Run unit tests (Vitest + Jest)
pnpm e2e                  # Run end-to-end tests (Playwright)

# Desktop client (Tauri 2)
pnpm desktop:dev          # Launch Tauri desktop development window
pnpm desktop:build        # Build desktop installer packages

# Mobile client (Capacitor 7)
pnpm mobile:sync          # Sync Web build artifacts to Android / iOS projects
pnpm --filter @music-room/mobile open:android  # Open project in Android Studio
pnpm --filter @music-room/mobile open:ios      # Open project in Xcode

# Code quality and deployment checks
pnpm lint                 # Run ESLint across packages
pnpm check:toolchain      # Verify Node.js and pnpm versions
pnpm deploy:check         # Pre-deployment environment check
```

`pnpm e2e` starts the real server and web app, clears its isolated Redis database, and requires Redis at `redis://127.0.0.1:6379/15` unless `REDIS_URL` is overridden. `pnpm check:toolchain` enforces Node.js 22.x and pnpm 10.x. See the [local setup guide](./docs/engineering/setup.md) for the full dependency and migration flow.

## Web Origin Configuration

- The web client falls back to the current page origin at runtime, so the open-source repo does not need a production domain baked into the frontend bundle.
- `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_WS_URL` can point the browser app at a separately deployed server.

## Cloudflare Turnstile

Login and registration pages use Cloudflare Turnstile for bot protection. It is disabled by default in development; production environments require it to be enabled and validate the secret key on server startup.

After creating a site in the Cloudflare Turnstile dashboard, set the following environment variables:

- `TURNSTILE_ENABLED=true`
- `TURNSTILE_SITE_KEY`: Public site key for frontend rendering
- `TURNSTILE_SECRET_KEY`: Server secret key configured strictly on the API server

Verification requests are sent directly from the API server to Cloudflare; the frontend never touches `TURNSTILE_SECRET_KEY`. Restart the `server` container after modifying production environment variables.

## WebRTC / TURN Configuration

The frontend first requests short-lived ICE configuration from `GET /v1/realtime/ice-config`.

The response contains `iceServers`, `ttlSeconds`, and a `source` of `ephemeral`, `static`, or `stun-only`.

Default behavior:

- Prefer short-lived TURN credentials returned by the server
- Fall back to static `NEXT_PUBLIC_TURN_*` / `NEXT_PUBLIC_WEBRTC_ICE_SERVERS` if the endpoint is unavailable
- Use STUN only if TURN is unavailable

Important server variables:

- `TURN_ENABLED`
- `TURN_PUBLIC_HOST`
- `TURN_PUBLIC_HOST_USE_APP_DOMAIN`
- `TURN_PUBLIC_HOST_USE_REQUEST_HOST`
- `TURN_PORT`
- `TURN_TLS_PORT`
- `TURN_SHARED_SECRET`
- `TURN_REALM`
- `TURN_PROTOCOLS`
- `TURN_TTL_SECONDS`

Frontend static ICE fallback variables:

- `NEXT_PUBLIC_STUN_URL`
- `NEXT_PUBLIC_TURN_URL`
- `NEXT_PUBLIC_TURN_USERNAME`
- `NEXT_PUBLIC_TURN_CREDENTIAL`
- `NEXT_PUBLIC_WEBRTC_ICE_SERVERS`

### Optional Provider Integrations

The current provider API supports NetEase and QQ Music. Both are disabled in `.env.example`. Enabling either provider requires the matching server flag and frontend build flag; production also requires a valid 32-byte hex or base64 cookie encryption key. Provider credentials remain encrypted on the server, and imported audio is not retained as a server-side library.

- NetEase: `NETEASE_ENABLED`, `NETEASE_COOKIE_ENCRYPTION_KEY`, `NEXT_PUBLIC_NETEASE_ENABLED`
- QQ Music: `QQMUSIC_ENABLED`, `QQMUSIC_COOKIE_ENCRYPTION_KEY`, `NEXT_PUBLIC_QQMUSIC_ENABLED`

## Connection And Playback Diagnostics

The `Members` diagnostics view reports:

- offer/answer/candidate signaling events
- control and media ICE/connection state
- `playbackAssetId`, media session key, source peer, and source ownership
- AudioContext state, buffered/scheduled audio, underruns, and decode errors
- Limiter peak/RMS, RTP bitrate, jitter, packet loss, and codec details
- local output track and remote track identity

Diagnostic rules of thumb:

- No ICE connection: check TURN, network egress, firewall, and candidate selection
- Media connected but no sound: check AudioContext unlock, source owner presence, remote track binding, and `audio.play()` results
- Buffering or crackle: check buffered/scheduled ahead, underruns, limiter peak/RMS, RTP jitter, and packet loss
- A member/presence snapshot refresh must not by itself change output or remote Track identity

## Docker Deployment

This repository provides:

- Root-level `docker-compose.yml` for development
- Linux production template in [deploy/linux](./deploy/linux)
- Deployment documentation in [docs/deployment/deployment.md](./docs/deployment/deployment.md)

Production recommendations:

- Use Nginx only for Web / API / WebSocket reverse proxying
- Do not route TURN through Nginx; expose TURN ports directly
- Keep the production deployment at one `server` instance; multi-instance room authority is not yet supported
- Open at least `3478/udp`, `3478/tcp`, and `5349/tcp`, plus the configured TURN relay range
- If coturn runs behind NAT, configure the public domain or `external-ip` correctly

More deployment details:

- [Deployment guide](./docs/deployment/deployment.md)
- [TURN network checklist](./docs/deploy/turn-network-checklist.md)
- [Risks and constraints](./docs/deployment/risks.md)
- [Observability](./docs/deployment/observability.md)

## Releases

Production releases support a multi-platform release matrix:

- **Web & Server**: Containerized deployment via `Dockerfile.web`, `Dockerfile.server`, and Docker Compose in `deploy/linux`
- **Desktop Client**: Generate Windows (.exe / .msi), macOS (.dmg), or Linux installers using `pnpm desktop:build`
- **Mobile Client**: Synchronize build assets with `pnpm mobile:sync`, then package Android APK / AAB with Android Studio or iOS app with Xcode

## Known Boundaries

- Playback depends on realtime signaling and the track owner's client being online (owner is the only media source)
- Redis unavailability causes realtime-dependent playback control requests to fail
- Local-upload tracks pause when their owner is offline; provider tracks can continue via listener-side offline fallback
- Provider availability, upstream platform login state, and music copyright restrictions can make external imports unavailable
- Production deployment remains single-server; multi-instance room authority is not yet supported
- Browser-level long-running WebRTC coverage, real-device audio measurements, and unified production observability are still being expanded

## License

[MIT](./LICENSE)

