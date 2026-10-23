# Soqaro

<p align="center">
  <b>跨平台多端协同听歌与音乐房应用</b><br>
  支持私有本地音乐及多平台音源导入，基于 WebRTC RTP Opus 实现毫秒级低延迟实时同步收听。
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

## 客户端下载

当前版本：[v1.0.0](https://github.com/witw123/soqaro/releases/tag/v1.0.0)（发布于 2026-10-23，支持桌面端自动更新）

| 平台 | 架构 | 文件格式 | 下载链接 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| Windows | x64 | NSIS 安装包 (`.exe`) | [Soqaro_1.0.0_x64-setup.exe](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_1.0.0_x64-setup.exe) | 桌面置顶歌词与系统媒体控制 (SMTC) |
| Windows | x64 | WiX 安装包 (`.msi`) | [Soqaro_1.0.0_x64_en-US.msi](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_1.0.0_x64_en-US.msi) | 企业分发与静默安装 |
| macOS | Universal | DMG 镜像 (`.dmg`) | [Soqaro_1.0.0_universal.dmg](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_1.0.0_universal.dmg) | 原生适配 Apple Silicon 与 Intel |
| macOS | Universal | 更新归档 (`.app.tar.gz`) | [Soqaro_universal.app.tar.gz](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_universal.app.tar.gz) | 客户端内置自动更新包 |
| Linux | x86_64 | AppImage | [Soqaro_1.0.0_amd64.AppImage](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_1.0.0_amd64.AppImage) | 通用便携免安装执行包 |
| Linux | x86_64 | Debian (`.deb`) | [Soqaro_1.0.0_amd64.deb](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_1.0.0_amd64.deb) | 适用于 Ubuntu / Debian / Deepin 等 |
| Linux | x86_64 | RPM (`.rpm`) | [Soqaro-1.0.0-1.x86_64.rpm](https://github.com/witw123/soqaro/releases/latest/download/Soqaro-1.0.0-1.x86_64.rpm) | 适用于 Fedora / RHEL / openSUSE 等 |
| Android | Universal | APK 安装包 (`.apk`) | [Soqaro-Android-v1.0.0.apk](https://github.com/witw123/soqaro/releases/latest/download/Soqaro-Android-v1.0.0.apk) | 原生 MediaSession 与后台服务常驻保活 |
| Web | 通用浏览器 | PWA 在线应用 | [在线使用](https://soqaro.witw.top/app) | 支持 Chrome / Edge / Safari 等主流浏览器 |

> **系统安装说明**  
> - **macOS**：首次打开如遇系统 Gatekeeper 拦截提示，可在终端执行 `sudo xattr -cr /Applications/Soqaro.app`。  
> - **Linux AppImage**：需先赋予执行权限：`chmod +x Soqaro_1.0.0_amd64.AppImage`。  
> - **Android**：生产包经由 CI 正式签名，首次安装请在系统弹窗中允许来自当前应用源的安装。

---

## 核心特性

- **多端生态覆盖**：包含 Next.js 15 Web/PWA、Tauri 2 跨平台桌面端（Windows / macOS / Linux）与 Capacitor 7 原生 Android 客户端。
- **极低延迟同步**：基于 WebRTC RTP Opus 实时广播与分段 Opus 调度引擎，实现跨端毫秒级同步收听。
- **本地优先架构**：用户音频资产保存在各自设备本地（IndexedDB 与沙盒目录），服务端不持久化私有音频文件。
- **多源音频支持**：支持本地曲库、网易云音乐、QQ 音乐与哔哩哔哩（多 P 视频音频）导入与播放，网络波动时支持监听端自动离线回退。
- **多元协同模式**：提供多人点歌协作房、房主审批电台房及轻量级实时表情互动通道。
- **双语对齐歌词**：支持 LRC 滚动歌词与 YRC 逐字精准高亮，内置双语对照、罗马音音译与桌面悬浮歌词窗。
- **系统媒体集成**：深度接入 Windows SMTC、Android 原生 MediaSession、系统锁屏与通知栏媒体控制。
- **收敛视觉规范**：遵循 Anti-AI-Slop 设计准则，采用极简几何声波曲线与高对比度实体表面，杜绝过度渐变与光晕干扰。

---

## 快速开始

### 本地运行

```bash
# 1. 安装依赖
pnpm install

# 2. 初始化环境与数据库服务（PowerShell 下复制命令为 Copy-Item .env.example .env）
cp .env.example .env
docker compose up -d postgres redis
pnpm --filter @soqaro/server db:push

# 3. 启动开发服务（Web: 3000, API: 3001）
pnpm dev
```

### 常用脚本

```bash
pnpm build          # Monorepo 全量构建
pnpm lint           # ESLint 代码规范检查
pnpm typecheck      # TypeScript 静态类型检查
pnpm test           # 运行单元测试
pnpm desktop:dev    # 启动桌面端开发窗口
pnpm mobile:sync    # 同步 Web 构建产物至 Android 原生工程
```

---

## 模块划分

- `apps/web`：Next.js 15 Web 客户端、PWA、音频准备引擎与 WebRTC 核心
- `apps/desktop`：Tauri 2 跨平台桌面客户端（Rust + SMTC + 桌面悬浮歌词）
- `apps/mobile`：Capacitor 7 原生 Android 客户端（MediaSession + 后台保活）
- `apps/server`：NestJS 11 API 服务端与 Socket.IO 信令网关
- `packages/shared`：前后端通用模型与 TypeScript 类型定义
- `packages/opus-encode`：浏览器端分段 Opus 音频编码包

---

## 工程文档

- [系统整体架构设计](./docs/architecture/overview.md)
- [播放同步链路原理解析](./docs/architecture/playback-sync.md)
- [API 与 WebSocket 协议说明](./docs/api/README.md)
- [Docker 生产环境部署指南](./docs/deployment/deployment.md)
- [TURN 网络穿透配置清单](./docs/deploy/turn-network-checklist.md)

---

## 开源协议

本项目基于 [MIT License](./LICENSE) 协议开源。
