# Soqaro

<p align="center">
  <b>Multi-client collaborative listening workspace</b><br>
  Listen to local and multi-source audio together in real time over WebRTC RTP Opus with millisecond-level synchronization.
</p>

<p align="center">
  <a href="./README.md"><b>简体中文</b></a> · <a href="./README.en.md"><b>English</b></a>
</p>

<p align="center">
  <a href="https://github.com/witw123/soqaro/releases/latest"><img src="https://img.shields.io/github/v/release/witw123/soqaro?style=flat-square&color=black&label=Release" alt="Release"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-black?style=flat-square" alt="License"></a>
  <a href="https://github.com/witw123/soqaro/releases/latest"><img src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android%20%7C%20Web-black?style=flat-square" alt="Platforms"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-22.x-black?style=flat-square" alt="Node.js"></a>
  <a href="https://pnpm.io/"><img src="https://img.shields.io/badge/pnpm-10.x-black?style=flat-square" alt="pnpm"></a>
</p>

---

## Client Downloads

Current version: [v1.0.0](https://github.com/witw123/soqaro/releases/tag/v1.0.0) (Released 2026-10-23, with in-app auto-update support)

| Platform | Architecture | Package Type | Direct Download Link | Description |
| :--- | :--- | :--- | :--- | :--- |
| Windows | x64 | NSIS Setup (`.exe`) | [Soqaro_1.0.0_x64-setup.exe](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_1.0.0_x64-setup.exe) | Floating lyrics overlay and Windows SMTC integration |
| Windows | x64 | WiX Package (`.msi`) | [Soqaro_1.0.0_x64_en-US.msi](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_1.0.0_x64_en-US.msi) | Enterprise distribution and silent installation |
| macOS | Universal | DMG Image (`.dmg`) | [Soqaro_1.0.0_universal.dmg](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_1.0.0_universal.dmg) | Native Apple Silicon (M1-M4) and Intel x86_64 bundle |
| macOS | Universal | Update Archive (`.app.tar.gz`) | [Soqaro_universal.app.tar.gz](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_universal.app.tar.gz) | In-app auto-updater archive |
| Linux | x86_64 | AppImage | [Soqaro_1.0.0_amd64.AppImage](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_1.0.0_amd64.AppImage) | Portable, standalone executable package |
| Linux | x86_64 | Debian (`.deb`) | [Soqaro_1.0.0_amd64.deb](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_1.0.0_amd64.deb) | Ubuntu, Debian, Linux Mint, Deepin, etc. |
| Linux | x86_64 | RPM (`.rpm`) | [Soqaro-1.0.0-1.x86_64.rpm](https://github.com/witw123/soqaro/releases/latest/download/Soqaro-1.0.0-1.x86_64.rpm) | Fedora, RHEL, openSUSE, etc. |
| Android | Universal | APK Package (`.apk`) | [Soqaro-Android-v1.0.0.apk](https://github.com/witw123/soqaro/releases/latest/download/Soqaro-Android-v1.0.0.apk) | Native MediaSession, lockscreen controls, and background service |
| Web | Modern Browsers | PWA Web App | [Launch Web App](https://soqaro.witw.top/app) | Chrome, Edge, Safari, Firefox; installable as a PWA |

> **Installation Notes**  
> - **macOS**: If blocked by Gatekeeper on first open, run `sudo xattr -cr /Applications/Soqaro.app` in Terminal.  
> - **Linux AppImage**: Grant execution permission with `chmod +x Soqaro_1.0.0_amd64.AppImage`.  
> - **Android**: Release APK is signed; allow installation from your browser or file manager when prompted.

---

## Core Features

- **Multi-Client Architecture**: Next.js 15 Web/PWA, Tauri 2 cross-platform desktop (Windows / macOS / Linux), and Capacitor 7 native Android app.
- **Low-Latency Sync**: WebRTC RTP Opus audio broadcast paired with a Segmented Opus engine for millisecond-level multi-peer synchronization.
- **Local-First Audio Storage**: User audio assets remain exclusively on client devices (IndexedDB and local directories); zero audio stored on the server.
- **Multi-Source Audio**: Import and play local tracks, NetEase Cloud Music, QQ Music, and Bilibili (multi-part media); automatic listener-side offline fallback when the track owner disconnects.
- **Collaborative Room Modes**: Standard collaborative shared queue, host-moderated request/radio mode, and synchronized live emoji reactions.
- **Bilingual Verbatim Lyrics**: LRC scrolling and YRC word-by-word synchronized highlighting with translations, romanized pronunciations, and desktop floating lyrics.
- **Native Media Integrations**: System Media Transport Controls (Windows SMTC), Android MediaSession, notification controls, and system lockscreen widgets.
- **Anti-AI-Slop Aesthetics**: Restrained, high-information-density UI with clean geometric soundwave visualizers and solid, high-contrast surfaces.

---

## Quick Start

### Local Development

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment and launch databases
cp .env.example .env
docker compose up -d postgres redis
pnpm --filter @soqaro/server db:push

# 3. Start development servers (Web: 3000, API: 3001)
pnpm dev
```

### Common Commands

```bash
pnpm build          # Monorepo full build
pnpm lint           # ESLint static code checks
pnpm typecheck      # TypeScript type checking
pnpm test           # Run unit tests
pnpm desktop:dev    # Launch Tauri desktop development window
pnpm mobile:sync    # Sync Web build artifacts to Android project
```

---

## Monorepo Layout

- `apps/web`: Next.js 15 Web client, PWA, audio preparation engine, and WebRTC core
- `apps/desktop`: Tauri 2 desktop client (Rust + SMTC + floating lyrics)
- `apps/mobile`: Capacitor 7 native Android client (MediaSession + background persistence)
- `apps/server`: NestJS 11 API server and Socket.IO signaling gateway
- `packages/shared`: Shared contracts, models, and TypeScript type definitions
- `packages/opus-encode`: Browser-side Ogg Opus encoder package

---

## Documentation

- [Architecture Overview](./docs/architecture/overview.md)
- [Playback Synchronization Architecture](./docs/architecture/playback-sync.md)
- [API and WebSocket Protocols](./docs/api/README.md)
- [Production Deployment Guide](./docs/deployment/deployment.md)
- [TURN Network Checklist](./docs/deploy/turn-network-checklist.md)

---

## License

This project is licensed under the [MIT License](./LICENSE).
