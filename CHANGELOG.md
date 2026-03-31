# 更新日志

本文档记录项目对外发布的重要变更。

## [Unreleased]

### 新增

- 新增 `apps/mobile`，引入基于 Capacitor 的 Android 客户端外壳
- 新增 Android 打包脚本，可输出 `Music.Room-Android.apk`
- GitHub Actions 发版流程新增 Android 构建与上传

### 调整

- GitHub Release 现支持统一上传 Windows、macOS、Linux、Android 客户端安装包
- Android 客户端默认连接 `https://witw.top`

## [0.1.0] - 2026-03-31

### 新增

- 提供基于 Next.js 的 Web 前端
- 提供基于 NestJS 的后端服务
- 提供基于 Electron 的桌面端前端壳
- 支持房间创建、加入与最近房间恢复
- 支持播放队列、歌单、聊天与实时同步

### 调整

- 桌面端生产模式默认加载 `https://witw.top`
- 桌面安装包不再内置本地 Next.js runtime
- 桌面安装包不再内置本地后端服务

### 修复

- 修复 Windows 下 Electron 打包流程
- 修复 pnpm workspace 场景下 `electron-builder` 的构建兼容性
- 修复桌面端重复打包与产物清理问题
