# Soqaro

[中文](./README.md) | [English](./README.en.md)

[![Release](https://img.shields.io/github/v/release/witw123/soqaro?color=2563eb&label=Release&logo=github)](https://github.com/witw123/soqaro/releases/latest)
[![License](https://img.shields.io/badge/License-MIT-emerald.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android%20%7C%20Web-blue)](https://github.com/witw123/soqaro/releases/latest)
[![Node](https://img.shields.io/badge/Node.js-22.x-339933?logo=node.js)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220?logo=pnpm)](https://pnpm.io/)

Soqaro 是一款跨平台多端协同听歌与音乐房应用，支持用户收听私有本地音乐及导入的多平台音频，并在多成员之间实现极低延迟的毫秒级实时同步收听。仓库采用全栈 Monorepo 架构，包含 Next.js 15 Web 前端、Tauri 2 桌面客户端（Windows / macOS / Linux）、Capacitor 7 移动端（Android）、NestJS 11 后端服务以及前后端强类型共享模型与协议。

当前版本：`1.0.0`<br>
文档快照：`2026-10`

---

## 客户端下载

> **最新稳定版本**：[Soqaro v1.0.0](https://github.com/witw123/soqaro/releases/tag/v1.0.0)（正式版，发布于 2026-10-23）  
> 桌面端支持内置自动更新与签名校验；所有安装包均由 GitHub Actions 官方流水线构建、签名并发布。

| 平台 / 系统 | 适用架构 | 安装包类型 | 下载直链 | 运行环境与功能特性 |
| :--- | :--- | :--- | :--- | :--- |
| **🪟 Windows** | x64 (64位) | **NSIS 安装包** (`.exe`) | [📥 点击下载 (.exe)](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_1.0.0_x64-setup.exe) | 推荐 Windows 用户首选；支持系统媒体传输控制 (SMTC) 与桌面悬浮置顶歌词 |
| **🪟 Windows** | x64 (64位) | **WiX 独立包** (`.msi`) | [📥 点击下载 (.msi)](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_1.0.0_x64_en-US.msi) | 企业分发、系统静默安装或组策略部署场景专用 |
| **🍎 macOS** | Universal<br>(Apple Silicon & Intel) | **DMG 镜像** (`.dmg`) | [📥 点击下载 (.dmg)](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_1.0.0_universal.dmg) | 推荐 macOS 用户首选；拖入 Applications 即可使用，原生适配 M1~M4 与 Intel |
| **🍎 macOS** | Universal | **更新归档包** (`.app.tar.gz`) | [📥 点击下载 (.tar.gz)](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_universal.app.tar.gz) | 客户端内置自动更新备用校验归档 |
| **🐧 Linux** | x86_64 (amd64) | **AppImage** | [📥 点击下载 (.AppImage)](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_1.0.0_amd64.AppImage) | 免安装开箱即用，赋予可执行权限后直接双击运行 |
| **🐧 Linux** | x86_64 (amd64) | **Debian 包** (`.deb`) | [📥 点击下载 (.deb)](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_1.0.0_amd64.deb) | 适用于 Ubuntu / Debian / Linux Mint / Deepin / UOS 等 |
| **🐧 Linux** | x86_64 (amd64) | **RPM 包** (`.rpm`) | [📥 点击下载 (.rpm)](https://github.com/witw123/soqaro/releases/latest/download/Soqaro-1.0.0-1.x86_64.rpm) | 适用于 Fedora / RHEL / CentOS / openSUSE 等 |
| **🤖 Android** | arm64 / universal | **APK 安装包** (`.apk`) | [📥 点击下载 (.apk)](https://github.com/witw123/soqaro/releases/latest/download/Soqaro-Android-v1.0.0.apk) | 正式签名包；支持原生 MediaSession、系统锁屏与通知栏歌词播控、后台常驻保活 |
| **🌐 Web / PWA** | 现代主流浏览器 | **Web 在线工作区** | [🚀 立即访问使用](https://soqaro.witw.top/app) | 支持 Chrome / Edge / Safari / Firefox，即开即用，支持一键安装为 PWA 应用 |

<details>
<summary><b>各平台运行提示与疑难解答（点击展开）</b></summary>

- **macOS 首次打开提示“应用已损坏”或“未受信任”**：  
  由于本项目为开源发布，未集成苹果高额年费开发者证书，系统 Gatekeeper 机制可能会弹出拦截提示。请在“终端（Terminal）”中执行以下命令移除隔离标记即可正常打开：
  ```bash
  sudo xattr -cr /Applications/Soqaro.app
  ```
- **Linux AppImage 权限设置**：  
  下载后请确保文件具有可执行权限：
  ```bash
  chmod +x Soqaro_1.0.0_amd64.AppImage
  ./Soqaro_1.0.0_amd64.AppImage
  ```
- **Android 安装提示“未知来源应用”**：  
  本安装包由 GitHub CI 自动化正式签名（非临时 Debug 证书），安装时允许系统授予安装权限即可安全运行。
</details>

---

## 项目定位与核心理念

Soqaro 聚焦于用户本地私有音频和已导入外部曲目的多人协作收听：

1. **私有资产不落盘服务端**：服务端仅管理用户会话、房间准入、权限控制、播放队列、实时协同信令和曲目元数据；用户的原始音频文件与分段 Opus 播放资产仅保存在各自客户端本机的 IndexedDB / 本地沙盒目录中，绝不在服务端留存备份。
2. **极低延迟的实时广播**：曲目拥有者将本地准备完毕的分段 Opus 资产解码并通过 WebRTC 媒体通道广播；房间内其他监听成员统一接收唯一的 RTP Opus 音频流，实现跨设备、跨地域的毫秒级低延迟同步。
3. **多音源聚合与智能回退**：集成网易云音乐、QQ 音乐与 B 站（分 P 视频及音频），经服务端临时流代理后直接转化为客户端本地分段资产；当曲目拥有者网络断开时，在线音源自动激活监听端无缝回退（Offline Fallback）机制，确保持续收听。

---

## 核心功能与特性概览

- **全平台客户端完备生态**：
  - **响应式 Web / PWA**：自适应桌面端与移动端浏览器，即开即用，支持离线缓存；
  - **Tauri 2 跨平台桌面端**：深度集成 Windows SMTC 系统媒体控制、独立桌面悬浮置顶歌词、原生媒体快捷键与应用内静默自动更新；
  - **Capacitor 7 原生移动端**：原生 Android MediaSession 状态绑定、后台常驻前台服务保活（唤醒锁 + Wi-Fi 锁）、通知栏与锁屏歌词控制；
  - **系统媒体桥接（System Media Bridge）**：统一抹平各操作系统原生媒体控制 API 差异。
- **多元房间形态与协同控制**：
  - **标准协作房**：多成员协作点歌入队、细粒度播放权限管理（`player` 权限）、毫秒级实时时钟同步；
  - **点歌房 / 电台模式**：房主掌控主播放器，观众可检索曲库并向点歌收件箱投递歌曲，由房主集中审批入队；
  - **实时动态交互**：全房间轻量级悬浮表情互动（Reactions）与信令联动；
  - **多设备登录隔离**：基于设备会话独立识别媒体源，彻底杜绝多端同账号并发导致的媒体流抢占与中断。
- **克制优雅的 Anti-AI-Slop 视觉设计**：
  - 彻底清理低质 AI 模板、过度霓虹发光（`--accent-glow`）、大圆角、彩色发光光斑与假拟物组件；
  - 极简几何声波曲线与精致黑胶唱片质感舞台，高信息密度与舒适对比度；
  - 100% 实体高对比表面，消除在复杂动效下的文字辨识障碍；
  - 顶部通知系统：默认极简铃铛图标，未读公告采用容器查询单位（`100cqw`）实现平稳跑马灯滚动。
- **专业级歌词引擎**：
  - 支持标准 LRC 滚动歌词与网易云 YRC 逐字精准高亮；
  - 双语翻译歌词与罗马音音译歌词并排渲染，行内语义高亮精准分离；
  - 移动端沉浸式全屏歌词（点击空白处平滑切换专辑封面）与桌面端独立悬浮置顶歌词；
  - 客户端多级 IndexedDB 智能歌词缓存。
- **跨平台搜索与智能匹配**：
  - 通用 `SearchBar` 组件，深度优化移动端拼音 IME 合成事件，杜绝文本覆盖与刷新抖动；
  - 即时联想建议（Autocomplete）、热门关键词与本地搜索历史；
  - 支持跨本地曲库、网易云音乐、QQ 音乐与 B 站（支持多 P 选集浏览与提取）聚合检索，高精度打分算法自动为无词歌曲匹配正版歌词。
- **实时声学链路与端到端诊断**：
  - 提供 AudioContext 状态、缓冲队列、Limiter 峰值/RMS、RTP 码率、网络抖动、丢包率及 Track Identity 实时诊断面板；
  - 支持动态短期 TURN 凭证下发与静态 ICE 弹性穿透。

---

## 架构拓扑链路

```text
本地音乐 / 在线音源导入
  -> 本地 IndexedDB 分段 Opus 资产
  -> SegmentedOpusEngine 播放调度引擎
  -> 共享 AudioContext 输出总线
  -> MediaStreamAudioDestinationNode
  -> WebRTC RTP Opus 实时媒体流广播
  -> 房间监听成员接收端单一 audio.srcObject
```

更多技术文档与设计细节：

- [项目状态与特性跟踪](./docs/engineering/status.md)
- [系统整体架构说明](./docs/architecture/overview.md)
- [播放同步引擎原理解析](./docs/architecture/playback-sync.md)
- [工程路线图与发布计划](./docs/engineering/roadmap.md)
- [测试策略与用例规范](./docs/engineering/testing.md)
- [本地开发环境搭建指南](./docs/engineering/setup.md)

---

## 仓库结构说明

```text
soqaro/
├── apps/
│   ├── web/          # Next.js 15 Web 客户端、PWA、音频准备引擎与 WebRTC 核心
│   ├── desktop/      # Tauri 2 跨平台桌面端（Rust + 系统媒体控制 + 悬浮歌词）
│   ├── mobile/       # Capacitor 7 Android 移动端（原生 MediaSession + 后台保活）
│   └── server/       # NestJS 11 API 服务端、Socket.IO 信令网关、Prisma ORM
├── packages/
│   ├── shared/       # 前后端共享协议、TypeScript 类型定义与 Zod 校验模型
│   ├── opus-encode/  # 浏览器端分段 Ogg Opus 编码与哈希处理包
│   └── config-*/     # Monorepo 共享 TypeScript / ESLint 配置
├── docs/             # 完整技术架构、API 文档与部署手册
└── deploy/           # 生产部署配置模版（Nginx、Docker Compose、coturn）
```

---

## 快速开始

### 环境要求

- Node.js `22.x`
- pnpm `10.x`
- PostgreSQL `16.x`
- Redis `7.x`
- Docker / Docker Compose（推荐用于一键运行数据库与中间件依赖）
- 现代主流浏览器（支持 IndexedDB、Web Audio 与 WebRTC）
- （可选）Rust / Cargo 工具链（用于 Tauri 桌面端本地开发与调试）
- （可选）Android Studio（用于 Capacitor 移动端调试）

### 本地开发

```bash
# 1. 安装依赖
pnpm install

# 2. 准备环境变量文件（PowerShell 下请使用 Copy-Item .env.example .env）
cp .env.example .env

# 3. 启动本地数据库与缓存容器
docker compose up -d postgres redis

# 4. 同步数据库 Schema
pnpm --filter @soqaro/server db:push

# 5. 启动全栈开发服务（Web + Server）
pnpm dev
```

默认访问端口：

- Web 前端：`http://localhost:3000`
- API 服务端：`http://localhost:3001`
- 服务健康检查：`http://localhost:3001/health`

本地主要功能入口：

- 产品落地页：`/`
- 客户端工作区：`/app`
- 用户认证页：`/auth`
- 房间发现大厅：`/rooms`

### 常用开发与构建指令

```bash
# 核心开发与测试
pnpm dev                  # 并行启动 Web 与 Server 开发服务器
pnpm build                # 全局 Monorepo 编译构建
pnpm typecheck            # TypeScript 静态类型检查
pnpm test                 # 单元测试 (Vitest + Jest)
pnpm e2e                  # Playwright 端到端全链路测试

# 桌面端开发 (Tauri 2)
pnpm desktop:dev          # 启动桌面端热重载开发窗口
pnpm desktop:build        # 构建桌面端安装包（跨平台打包推荐使用 GitHub Actions）

# 移动端开发 (Capacitor 7)
pnpm mobile:sync          # 同步 Web 构建产物至 Android 工程
pnpm --filter @soqaro/mobile open:android  # 在 Android Studio 中打开原生工程

# 代码质量规范与检查
pnpm lint                 # 运行 ESLint 静态代码检查
pnpm check:toolchain      # 校验 Node.js 与 pnpm 版本契约
pnpm deploy:check         # 部署前置环境契约检测
```

---

## 生产部署指南

本项目提供了完整的 Docker 容器化生产部署方案：

- 根目录 `docker-compose.yml`：开发与本地环境快速拉起；
- `deploy/linux` 目录：包含生产级 Nginx 配置模版、coturn TURN 穿透服务配置及生产 Docker Compose 编排；
- 详见[生产部署手册](./docs/deployment/deployment.md)与 [TURN 网络配置检查清单](./docs/deploy/turn-network-checklist.md)。

部署注意事项：

- Nginx 仅用于反向代理 Web、API 与 WebSocket 端口；
- **不要**将 TURN 穿透流量经由 Nginx 代理，请直接将 coturn 端口（默认 `3478/udp`、`3478/tcp`、`5349/tcp` 及中继 UDP 端口段）暴露至公网；
- 生产环境建议开启 Cloudflare Turnstile 防刷人机验证保护。

---

## 开源协议

本项目采用 [MIT 许可证](./LICENSE) 开源。
