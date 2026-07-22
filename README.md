# Music Room

[English](./README.md) | [中文](./README.zh-CN.md)

[![Node](https://img.shields.io/badge/Node.js-22.x-339933)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220)](https://pnpm.io/)

Music Room is a browser-first collaborative music-room application for listening to users' own local audio together. The monorepo contains the Next.js web app, NestJS server, and shared frontend/server contracts.

Current workspace version: `0.2.8`<br>
Documentation snapshot: `2026-07-23`

## Product Scope

The server owns accounts, rooms, permissions, queues, playback, realtime state, and track metadata. Audio files are not persisted by the server. Each browser stores the files and generated playback assets for that user's own imports in IndexedDB.

The room does not download or exchange audio assets between members. A track owner publishes the already prepared segmented Opus playback asset over the room's WebRTC media connection; listeners receive one RTP Opus stream. NetEase and QQ Music imports are temporarily proxied by the server, then converted into the same browser-local playback flow.

## Current Status

The core product loop is runnable and is in the "usable product, ongoing hardening" stage:

- `/` is the public website entry, and `/app` is the client workspace
- Registration/login, room creation/join/recovery, member permissions, away-room resume, shared queue, and host playback control are connected
- The client workspace includes rooms, provider search, playlists, favorite albums, profile, settings, and a persistent player
- The room workspace currently focuses on `Library`, `My Playlists`, and `Members`; the shared queue is managed from the room stage and player
- NetEase and QQ Music account binding, search, playlist/album browsing, and local import are implemented behind provider feature flags
- Playback uses one Segmented Opus/WebRTC path with a stable room audio session
- Diagnostics expose AudioContext, buffer, limiter, RTP, ICE, and track identity state
- The same responsive web application serves desktop and mobile browsers

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

- `apps/web`: Next.js web client, workspace, local asset preparation, playback, and WebRTC
- `apps/server`: NestJS API, room/provider services, persistence, and Socket.IO signaling
- `packages/shared`: shared contracts, types, and validation models
- `packages/opus-encode`: browser-side Ogg Opus encoder package used by the import pipeline
- `packages/config-*`: shared TypeScript and ESLint configuration

## Feature Overview

- Room creation, join, recovery, and exit
- Public website and `/app` client workspace split
- Shared playback queue, host controls, and playback synchronization
- Local audio import, personal library recovery, and playlist management
- Optional NetEase and QQ Music account binding, search, playlists, albums, lyrics, and local import
- Favorite albums, profile/settings workspace, theme preferences, and away-room resume
- Segmented Opus playback through a stable WebRTC RTP media track
- Member-level connection, media, playback, and audio diagnostics
- Server-issued short-lived TURN credentials with static ICE configuration fallback

The WebRTC `music-room-control` DataChannel carries control/health coordination only. It is not an audio asset or cache transfer channel.

## Quick Start

### Requirements

- Node.js 22.x
- pnpm 10.x
- PostgreSQL 16.x
- Redis 7.x
- Docker / Docker Compose (recommended for local dependencies)
- A modern browser with IndexedDB, Web Audio, and WebRTC support

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
pnpm dev
pnpm build
pnpm typecheck
pnpm test
pnpm e2e
pnpm check:toolchain
```

Additional checks:

```bash
pnpm lint
pnpm deploy:check
```

`pnpm e2e` starts the real server and web app, clears its isolated Redis database, and requires Redis at `redis://127.0.0.1:6379/15` unless `REDIS_URL` is overridden. `pnpm check:toolchain` enforces Node.js 22.x and pnpm 10.x. See the [local setup guide](./docs/engineering/setup.md) for the full dependency and migration flow.

## Web Origin Configuration

- The web client falls back to the current page origin at runtime, so the open-source repo does not need a production domain baked into the frontend bundle.
- `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_WS_URL` can point the browser app at a separately deployed server.

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

### Optional provider integrations

The current provider API supports NetEase and QQ Music. Both are disabled in `.env.example`. Enabling either provider requires the matching server flag and frontend build flag; production also requires a valid 32-byte hex or base64 cookie encryption key. Provider credentials remain encrypted on the server, and imported audio is not retained as a server-side library.

- NetEase: `NETEASE_ENABLED`, `NETEASE_COOKIE_ENCRYPTION_KEY`, `NEXT_PUBLIC_NETEASE_ENABLED`
- QQ Music: `QQMUSIC_ENABLED`, `QQMUSIC_COOKIE_ENCRYPTION_KEY`, `NEXT_PUBLIC_QQMUSIC_ENABLED`

## Connection And Playback Diagnostics

The `Members` diagnostics view reports:

- offer/answer/candidate signaling events
- control and media ICE/connection state
- `playbackAssetId`, media session key, source peer, and source ownership
- AudioContext state, buffered/scheduled audio, underruns, and decode errors
- limiter peak/RMS, RTP bitrate, jitter, packet loss, and codec details
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

Production releases use `Dockerfile.web`, `Dockerfile.server`, and the Compose definitions under `deploy/linux`. The current repository ships the responsive web application only; it does not build native desktop or mobile installers.

## Known Boundaries

- Playback depends on realtime signaling and the track owner's browser being online
- Redis unavailability causes realtime-dependent playback control requests to fail
- A listener cannot play a track that it has not uploaded locally while its owner is offline
- Provider availability, upstream platform login state, and music copyright restrictions can make external imports unavailable
- Browser-level long-running WebRTC coverage, real-device audio measurements, and unified production observability are still being expanded

## License

[MIT](./LICENSE)
