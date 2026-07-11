# Music Room

[English](./README.md) | [中文](./README.zh-CN.md)

[![Release](https://img.shields.io/github/v/release/witw123/music_room)](https://github.com/witw123/music_room/releases)
[![License](https://img.shields.io/github/license/witw123/music_room)](./LICENSE)
[![Node](https://img.shields.io/badge/Node.js-22.x-339933)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220)](https://pnpm.io/)

Music Room is a collaborative music-room project for listening to local music together. The repository is a monorepo that includes the web client, NestJS server, desktop shell, mobile shell, and shared frontend/server contracts.

## Product Scope

Music Room focuses on collaborative playback of users' own local audio files. The server keeps room, queue, realtime, and metadata state while audio data stays on client devices.

The current goals are:

- Let users listen together using their own local audio files
- Build a complete room experience with a shared queue, P2P chunks, and local cache playback
- Keep audio files off the server while still providing stable collaborative playback

## Current Status

The core loop is already runnable. The project is in a "usable product, ongoing hardening" stage:

- `/` is the public website entry, and `/app` is the client workspace
- Registration/login, room creation/join/recovery, shared queue, and host playback control are connected
- The room workspace currently focuses on `Queue`, `Library`, `Cache`, and `Members`
- P2P chunk cache and progressive local playback for MP3/FLAC are integrated
- The desktop app has moved to Tauri 2, and the mobile app currently provides a Capacitor Android shell
- Desktop and Android clients can check for updates from inside the app

More details:

- [Project status](./docs/engineering/status.md)
- [Roadmap](./docs/engineering/roadmap.md)
- [Testing strategy](./docs/engineering/testing.md)

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

- `apps/web`: Next.js web client
- `apps/server`: NestJS API, room service, and WebSocket signaling
- `apps/desktop`: Tauri desktop app
- `apps/mobile`: Capacitor mobile shell
- `packages/shared`: Shared contracts, types, and validation models

## Feature Overview

- Room creation, join, recovery, and exit
- Public website and `/app` client workspace split
- Shared playback queue, host controls, and playback sync
- Local audio import, library management, and playlist management
- P2P chunk cache sync
- WebRTC data-channel chunk relay
- Manual cache, cache restore to library, and cache export
- Member-level connection and cache diagnostics
- Server-issued short-lived TURN credentials with frontend fallback to static ICE config
- Client update checks for desktop and Android shells

## Quick Start

### Requirements

- Node.js 22.x
- pnpm 10.x
- PostgreSQL
- Redis
- Docker / Docker Compose

### Local Development

```bash
pnpm install
cp .env.example .env
pnpm dev
```

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
pnpm dev
pnpm build
pnpm typecheck
pnpm test
pnpm e2e
pnpm check:toolchain
pnpm pack:desktop
pnpm pack:mobile
```

`pnpm e2e` starts the real server and web app, and requires local Redis at `redis://127.0.0.1:6379/15`. `pnpm check:toolchain` enforces Node.js 22.x and pnpm 10.x to avoid drift between local development, CI, and deployment environments.

## Shell Origin Configuration

- The web client falls back to the current page origin at runtime, so the open-source repo does not need a production domain baked into the frontend bundle.
- Desktop and mobile shells use `MUSIC_ROOM_PUBLIC_ORIGIN` at build/package time.
- If `MUSIC_ROOM_PUBLIC_ORIGIN` is not set, desktop and mobile packaging fails fast instead of producing a client pointed at `https://example.com`.
- Official `0.2.9` client packages are expected to target `https://musicroom.witw.top`.

Examples:

```bash
# Desktop dev / pack
MUSIC_ROOM_PUBLIC_ORIGIN=https://musicroom.witw.top pnpm --filter @music-room/desktop dev
MUSIC_ROOM_PUBLIC_ORIGIN=https://musicroom.witw.top pnpm --filter @music-room/desktop pack

# Mobile shell sync / pack
MUSIC_ROOM_PUBLIC_ORIGIN=https://musicroom.witw.top pnpm --filter @music-room/mobile android:sync
MUSIC_ROOM_PUBLIC_ORIGIN=https://musicroom.witw.top pnpm --filter @music-room/mobile pack
```

## WebRTC / TURN Configuration

The frontend first requests short-lived ICE configuration from the server:

- `GET /v1/realtime/ice-config`

The response includes:

- `iceServers`
- `ttlSeconds`
- `source`
  - `ephemeral`
  - `static`
  - `stun-only`

Default behavior:

- Prefer short-lived TURN credentials returned by the server
- Fall back to static `NEXT_PUBLIC_TURN_*` / `NEXT_PUBLIC_WEBRTC_ICE_SERVERS` if the endpoint is unavailable
- Use STUN only if TURN is unavailable

### Key Environment Variables

Server:

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

Frontend fallback:

- `NEXT_PUBLIC_STUN_URL`
- `NEXT_PUBLIC_TURN_URL`
- `NEXT_PUBLIC_TURN_USERNAME`
- `NEXT_PUBLIC_TURN_CREDENTIAL`
- `NEXT_PUBLIC_WEBRTC_ICE_SERVERS`

## Connection And Cache Diagnostics

The member page's "connection and cache diagnostics" panel reports:

- Per-peer `offer / answer / candidate` send/receive events
- Data-channel ICE state and connection state
- Per-peer cache availability, piece transfer rate, request RTT, and timeout rate
- Local progressive/full-cache playback engine state and buffer window
- Recent event stream and error summary

Diagnostic rules of thumb:

- `offer / answer` exists, but no candidates or ICE never reaches `connected`: check TURN, network egress, and firewall rules first
- Data channel is open but no pieces arrive: check cache availability announcements and source peer membership
- Pieces arrive but playback waits: check local buffer window, PCM/MSE engine state, and browser audio unlock

## Docker Deployment

This repository provides:

- Root-level `docker-compose.yml` for development
- Linux production template in [deploy/linux](./deploy/linux)
- Deployment documentation in [docs/deployment/deployment.md](./docs/deployment/deployment.md)

Production recommendations:

- Use Nginx only for Web / API / WebSocket reverse proxying
- Do not route TURN through Nginx; expose TURN ports directly
- Open at least:
  - `3478/udp`
  - `3478/tcp`
  - `5349/tcp`
- If coturn runs behind NAT, configure the public domain or `external-ip` correctly

More deployment details:

- [Deployment guide](./docs/deployment/deployment.md)
- [Risks and constraints](./docs/deployment/risks.md)
- [Observability](./docs/deployment/observability.md)

## Releases

Desktop and Android installers are published through:

- [GitHub Releases](https://github.com/witw123/music_room/releases)

Current release titles use `Music Room vX.Y.Z`. Release assets include:

- Windows `.exe` / `.msi`
- macOS `.dmg`
- Linux `.AppImage` / `.deb` / `.rpm`
- Android `.apk`
- Tauri desktop updater manifest `latest.json`

Update behavior:

- Desktop shells use the Tauri updater manifest to prompt the user to download and install signed updates.
- Android shells check the latest GitHub Release and prompt the user to download the newest APK.

## Known Boundaries

- Playback control depends on realtime availability; playback APIs fail directly when Redis is unavailable
- The room workspace currently focuses on `Queue / Library / Cache / Members`; playlist backend capabilities remain available but are not the default primary entry
- Browser-level E2E, real WebRTC integration tests, and unified observability are still being expanded

## License

[MIT](./LICENSE)
