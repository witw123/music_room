# 路线图

最后更新：`2026-10-23`

路线图以当前单一 Segmented Opus/WebRTC 架构与 1.0.0 正式发布版本为基线。已删除的资产传输、缓存下载和旧播放实现不再列为待办，也不通过 feature flag 保留。

## 已完成：基础与 MVP

- [x] Monorepo、pnpm workspace、Turborepo
- [x] Web 前端、Server 服务端和共享 schema（`@soqaro/*`）
- [x] Docker Compose、本地 PostgreSQL、Redis、coturn 配置
- [x] 账号注册、登录、登出
- [x] 房主建房、房间码加入、最近房间恢复
- [x] 官网 `/` 与客户端入口 `/app`
- [x] 响应式工作区：房间、provider 搜索、歌单、收藏、个人资料和设置
- [x] 本地曲目导入、个人 IndexedDB 曲库恢复
- [x] 网易云 / QQ 音乐 / B 站（哔哩哔哩）provider 账号绑定、跨平台搜索、分 P 浏览与导入
- [x] 房间共享队列和房主/成员播放控制
- [x] 播放、暂停、下一首、上一首、seek
- [x] 歌单保存、重命名、删除和重新导入房间
- [x] Socket.IO 房间快照、patch、presence 和信令
- [x] WebRTC 控制 DataChannel 与独立媒体 RTP 连接
- [x] 暂离房间恢复、成员权限和主题设置

## 已完成：单一播放链路与多人听歌体系

- [x] 上传阶段生成 2 秒分段 Opus 播放资产
- [x] IndexedDB 分段 Opus 读取、解码和调度
- [x] 共享 AudioContext / MediaStreamAudioDestinationNode 输出总线
- [x] 稳定 output Track 与监听端单一 `audio.srcObject`
- [x] session key、media epoch、playback revision 和 source peer 生命周期
- [x] single-flight sync、timeline generation、unit 去重和调度窗口
- [x] source fade、underrun 静音/恢复、limiter 和音频诊断
- [x] 删除 PCM、MSE、FLAC progressive、旧 orchestrator 和运行时 fallback
- [x] 删除房间缓存下载、手动缓存 UI、P2P 资产传输和 availability 协议
- [x] 多人听歌准入原则：仅认源成员分发资产，杜绝监听端第三方偷跑播放
- [x] 自动资产准备（Automatic Asset Preparation）与后台预转码调度
- [x] 资产失效检测与异常状态降级（Disruption & Recovery）及源成员快速恢复

## 已完成：跨平台客户端与自动化交付

- [x] Tauri 2 跨平台桌面端（Windows / macOS / Linux）：系统级媒体控制（SMTC / MPRIS / Now Playing）与独立悬浮歌词
- [x] Capacitor 7 移动原生端（Android）：前台媒体播放常驻服务、锁屏/通知栏控制与原生返回键优先级栈
- [x] GitHub Actions 全平台自动化发布矩阵（`release-apps.yml`）：单点 `create-release` 协调并行打包分发 `.exe`, `.msi`, `.dmg`, `.app.tar.gz`, `.AppImage`, `.deb`, `.rpm`, `.apk`
- [x] Tauri 桌面端自动更新体系：内置签名校验与 `latest.json` 发布通道
- [x] Android 生产密钥签名流程（`soqaro-release.jks`）与语义化版本自动推导 `versionCode`
- [x] Anti-AI-slop 克制收敛设计系统落地与根除大面积辉光/假拟物样式
- [x] 官方规范中英文 README 与表格化多平台直连下载 UI

## 进行中：Realtime 与发布稳态

- [ ] Redis 房间状态快照和重连补偿加强
- [ ] 多实例下事件顺序与单写权威边界验证
- [ ] 服务端重启后的完整房间恢复
- [ ] TURN、ICE restart、媒体恢复和 source owner 离线场景的浏览器集成测试
- [ ] 双 Chromium context 长时间播放、切歌、seek、成员进出和快速音量变化回归
- [ ] 真实设备上的 limiter、RMS、jitter、packet loss 和 underrun 指标采集
- [ ] 发布 smoke check、客户端错误收集和媒体链路告警

## 产品层待办

- [ ] 协作歌单的更完整权限与前端回归
- [ ] 更完整的成员权限模型
- [ ] 操作审计和房间事件历史
- [ ] 移动端手势交互与触控体验进一步调优

## 当前优先顺序

1. 先证明重连、source owner 离线和媒体会话恢复的行为稳定
2. 再补真实 WebRTC/Media 长时间 E2E 与弱网测试
3. 再补统一观测、告警和发布 smoke check
4. 最后处理歌单协作细节、审计和更完整权限模型
