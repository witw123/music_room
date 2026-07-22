# 06 · 顶层组件编排重构归档

状态：`历史提案，不代表当前实现`

本文件原本讨论顶层房间组件的瘦身和旧下载器装配。旧缓存下载器和相关 UI 已删除，当前房间主 UI 为 `Library / My Playlists / Members`；共享 Queue 由房间舞台和播放器承载。

新增 UI 或运行时修改应保持以下边界：

- 页面组件负责展示和交互装配
- 房间 realtime、播放媒体会话和 WebRTC peer 生命周期保持独立
- 成员/presence/普通快照变化不能造成媒体 effect 重建
- 共享协议以 `packages/shared` schema 为唯一来源
