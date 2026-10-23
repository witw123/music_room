# Soqaro

<p align="center">
  <b>跨平台多端协同听歌与音乐房应用</b><br>
  面向私有本地音乐与多源流媒体的高保真协同收听平台，基于 WebRTC RTP Opus 实现毫秒级低延迟同步。
</p>

<p align="center">
  <a href="./README.md"><b>简体中文</b></a> · <a href="./README.en.md"><b>English</b></a>
</p>

<p align="center">
  <a href="https://github.com/witw123/soqaro/releases/latest"><img src="https://img.shields.io/github/v/release/witw123/soqaro?style=flat-square&color=24292e&label=Release" alt="Release"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-24292e?style=flat-square" alt="License"></a>
  <a href="https://github.com/witw123/soqaro/releases/latest"><img src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android%20%7C%20Web-24292e?style=flat-square" alt="Platforms"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-22.x-24292e?style=flat-square" alt="Node.js"></a>
  <a href="https://pnpm.io/"><img src="https://img.shields.io/badge/pnpm-10.x-24292e?style=flat-square" alt="pnpm"></a>
</p>

---

## 软件下载

当前稳定版本：[Soqaro v1.0.0](https://github.com/witw123/soqaro/releases/tag/v1.0.0)（发布于 2026-10-23，支持桌面端自动更新）

| 操作系统 | 架构 | 安装包类型 | 下载直链 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| Windows | x64 | NSIS 安装程序 (`.exe`) | [Soqaro_1.0.0_x64-setup.exe](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_1.0.0_x64-setup.exe) | 桌面置顶歌词与系统媒体控制 (SMTC) |
| Windows | x64 | WiX 安装包 (`.msi`) | [Soqaro_1.0.0_x64_en-US.msi](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_1.0.0_x64_en-US.msi) | 企业分发与静默安装 |
| macOS | Universal | DMG 镜像 (`.dmg`) | [Soqaro_1.0.0_universal.dmg](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_1.0.0_universal.dmg) | 原生适配 Apple Silicon 与 Intel 架构 |
| macOS | Universal | 更新归档 (`.app.tar.gz`) | [Soqaro_universal.app.tar.gz](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_universal.app.tar.gz) | 客户端内置自动更新校验包 |
| Linux | x86_64 | AppImage | [Soqaro_1.0.0_amd64.AppImage](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_1.0.0_amd64.AppImage) | 通用便携免安装执行包 |
| Linux | x86_64 | Debian (`.deb`) | [Soqaro_1.0.0_amd64.deb](https://github.com/witw123/soqaro/releases/latest/download/Soqaro_1.0.0_amd64.deb) | 适用于 Ubuntu / Debian / Deepin 等 |
| Linux | x86_64 | RPM (`.rpm`) | [Soqaro-1.0.0-1.x86_64.rpm](https://github.com/witw123/soqaro/releases/latest/download/Soqaro-1.0.0-1.x86_64.rpm) | 适用于 Fedora / RHEL / openSUSE 等 |
| Android | Universal | APK 安装包 (`.apk`) | [Soqaro-Android-v1.0.0.apk](https://github.com/witw123/soqaro/releases/latest/download/Soqaro-Android-v1.0.0.apk) | 原生 MediaSession 与后台服务常驻保活 |
| Web | 现代浏览器 | PWA 在线应用 | [在线访问](https://soqaro.witw.top/app) | 浏览器即开即用，支持 PWA 离线安装 |

> [!NOTE]
> **安装与运行说明**  
> - **macOS**：首次打开如遇系统 Gatekeeper 拦截提示，可在终端执行 `sudo xattr -cr /Applications/Soqaro.app` 放行。  
> - **Linux**：AppImage 文件需在运行前赋予执行权限：`chmod +x Soqaro_1.0.0_amd64.AppImage`。  
> - **Android**：生产发布包已签名，首次安装请在系统弹窗中允许来自当前应用源的安装。

---

## 功能特性

### 实时协同与声学引擎
- **毫秒级同步广播**：基于 WebRTC RTP Opus 实时广播与分段 Opus 调度引擎，曲目拥有者作为单一音频源，全房间成员低延迟同步收听。
- **本地优先架构**：用户音频资产严格保存在客户端本地 IndexedDB 与指定沙盒目录，服务端零音频数据沉淀。
- **离线无缝回退**：集成网易云音乐、QQ 音乐与哔哩哔哩（多 P 视频音频）；源成员离线时自动切换至监听端备用流。

### 多端原生系统集成
- **全平台客户端**：提供基于 Next.js 15 的响应式 Web/PWA、基于 Tauri 2 的跨平台桌面端及基于 Capacitor 7 的原生 Android 端。
- **系统媒体桥接**：深度接入 Windows SMTC、Android 原生 MediaSession、锁屏播控通知与系统快捷键。
- **后台常驻保活**：Android 端持有前台服务、WLAN 锁与部分唤醒锁，保障息屏与切后台时持续协同不中断。

### 歌词与交互系统
- **高精度双语歌词**：支持标准 LRC 滚动歌词与 YRC 逐字精准高亮，内置双语对照、罗马音音译与桌面悬浮置顶歌词。
- **沉浸与悬浮视效**：提供移动端沉浸全屏歌词界面，以及桌面端置顶透明背景悬浮歌词窗。
- **多元协同模式**：提供多人协作共享队列模式、房主审批电台点歌模式及实时信令表情互动通道。
- **收敛视觉规范**：遵循 Anti-AI-Slop 设计准则，采用极简几何声波曲线与高对比度实体表面，杜绝过度渐变与光晕干扰。

---

## 系统架构

```text
[ 本地音乐 / 在线音源导入 ]
            │
            ▼
[ 客户端本地 IndexedDB ] (分段 Opus 编码缓存)
            │
            ▼
[ SegmentedOpusEngine ] (本地音频调度引擎)
            │
            ▼
[ WebRTC RTP 广播 ] ─── (通过服务端信令协同) ───► [ 房间各监听端单一音频总线 ]
```

---

## 快速开始

### 依赖环境

| 组件 | 最低版本要求 | 用途说明 |
| :--- | :--- | :--- |
| Node.js | 22.x | 前端与后端运行环境 |
| pnpm | 10.x | Monorepo 包管理器 |
| PostgreSQL | 16.x | 用户、房间与元数据持久化 |
| Redis | 7.x | 实时播放状态与信令协调 |
| Docker | 推荐 | 本地开发容器化运行数据库与中间件 |

### 本地开发

```bash
# 1. 安装依赖
pnpm install

# 2. 初始化环境配置与中间件容器（PowerShell 下复制命令为 Copy-Item .env.example .env）
cp .env.example .env
docker compose up -d postgres redis
pnpm --filter @soqaro/server db:push

# 3. 启动开发服务器（Web: 3000, Server: 3001）
pnpm dev
```

### 常用指令

```bash
pnpm build          # Monorepo 全量构建
pnpm lint           # ESLint 代码规范检查
pnpm typecheck      # TypeScript 静态类型检查
pnpm test           # 运行单元测试
pnpm desktop:dev    # 启动桌面端开发窗口
pnpm mobile:sync    # 同步 Web 构建产物至 Android 原生工程
```

---

## 仓库结构

```text
soqaro/
├── apps/
│   ├── web/          # Next.js 15 Web 客户端、PWA、音频准备引擎与 WebRTC 核心
│   ├── desktop/      # Tauri 2 跨平台桌面客户端（Rust + SMTC + 桌面悬浮歌词）
│   ├── mobile/       # Capacitor 7 原生 Android 客户端（MediaSession + 后台保活）
│   └── server/       # NestJS 11 API 服务端与 Socket.IO 信令网关
├── packages/
│   ├── shared/       # 前后端通用模型、Zod 校验与 TypeScript 类型定义
│   ├── opus-encode/  # 浏览器端分段 Opus 音频编码包
│   └── config-*/     # Monorepo 统一 TypeScript 与 ESLint 规范配置
├── docs/             # 完整技术架构文档、API 协议与部署手册
└── deploy/           # 生产部署配置模版（Docker Compose、Nginx、coturn）
```

---

## 工程文档

- [系统架构概览](./docs/architecture/overview.md)
- [播放同步链路原理解析](./docs/architecture/playback-sync.md)
- [REST API 与 WebSocket 协议说明](./docs/api/README.md)
- [Docker 生产环境部署指南](./docs/deployment/deployment.md)
- [TURN 网络穿透配置清单](./docs/deploy/turn-network-checklist.md)

---

## 开源协议

本项目基于 [MIT License](./LICENSE) 协议开源。
