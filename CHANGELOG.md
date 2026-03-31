# 更新日志

本文档记录项目对外发布的重要变更。

## [Unreleased]

### 调整

- 桌面端从 Electron 迁移为 Tauri 2，保留远程前端壳模式
- 桌面端生产环境继续默认加载 `https://witw.top`
- 桌面端 GitHub Actions 构建链路切换为 Tauri Windows、macOS、Linux 打包
- Web 端桌面桥接从 `window.electron` 迁移为 Tauri `invoke`

## [0.2.2] - 2026-03-31

### 调整

- 桌面端从 Electron 正式迁移为 Tauri 2
- 桌面端本地构建链路切换为 Rust + Tauri CLI
- GitHub Actions 桌面端构建链路切换为 Tauri Windows、macOS、Linux 打包
- Web 端桌面桥接从 `window.electron` 迁移为 Tauri `invoke`

### 修复

- 修复 Windows 下 Tauri 本地构建目录和打包脚本兼容问题
- 修复桌面安装包收集路径，统一输出到 `apps/desktop/release`

## [0.2.1] - 2026-03-31

### 新增

- 新增 Android 客户端壳与 APK 构建链路
- GitHub Release 新增 Android 安装包产物

### 调整

- 统一仓库工作区版本号到 `0.2.1`
- Release 现已覆盖 Windows、macOS、Linux、Android 四个平台

### 修复

- 修复 Android Gradle Wrapper 在 GitHub Actions 中缺少执行权限的问题
- 修复自动发版中 Android 构建失败的问题

## [0.1.0] - 2026-03-31

### 新增

- 提供基于 Next.js 的 Web 前端
- 提供基于 NestJS 的后端服务
- 提供桌面客户端壳
- 支持房间创建、加入与最近房间恢复
- 支持播放队列、歌单、聊天与实时同步

### 调整

- 桌面端生产模式默认加载 `https://witw.top`
- 桌面客户端不内置本地 Next.js runtime
- 桌面客户端不内置本地后端服务

### 修复

- 修复 Windows 桌面端打包流程
- 修复 monorepo 场景下桌面构建兼容问题
- 修复桌面端重复打包与产物清理问题
