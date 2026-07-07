# 桌面端迁移说明（归档）

最后更新：`2026-07-07`

这份文档原本对应旧的 Electron 方案，现已归档。

## 当前事实

- 桌面端已经迁移到 Tauri 2
- 当前桌面壳目录是 [apps/desktop](/e:/code/music_room/apps/desktop)
- 打包脚本依赖 `MUSIC_ROOM_PUBLIC_ORIGIN`
- 桌面端不再内嵌本地 Node 服务，也不再沿用旧的 Electron 设计

## 现在应该参考哪里

- 项目总览：[docs/README.md](/e:/code/music_room/docs/README.md)
- 当前状态：[docs/engineering/status.md](/e:/code/music_room/docs/engineering/status.md)
- 部署说明：[docs/deployment/deployment.md](/e:/code/music_room/docs/deployment/deployment.md)
