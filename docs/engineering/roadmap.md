# 路线图

最后更新：`2026-07-23`

路线图以当前单一 Segmented Opus/WebRTC 架构为基线。已删除的资产传输、缓存下载和旧播放实现不再列为待办，也不通过 feature flag 保留。

## 已完成：基础与 MVP

- [x] Monorepo、pnpm workspace、Turborepo
- [x] Web 前端、Server 服务端和共享 schema
- [x] Docker Compose、本地 PostgreSQL、Redis、coturn 配置
- [x] 账号注册、登录、登出
- [x] 房主建房、房间码加入、最近房间恢复
- [x] 官网 `/` 与客户端入口 `/app`
- [x] 响应式工作区：房间、provider 搜索、歌单、收藏、个人资料和设置
- [x] 本地曲目导入、个人 IndexedDB 曲库恢复
- [x] 网易云/QQ 音乐 provider 账号绑定、搜索和本地导入
- [x] 房间共享队列和房主播放控制
- [x] 播放、暂停、下一首、上一首、seek
- [x] 歌单保存、重命名、删除和重新导入房间
- [x] Socket.IO 房间快照、patch、presence 和信令
- [x] WebRTC 控制 DataChannel 与独立媒体 RTP 连接
- [x] 暂离房间恢复、成员权限和主题设置

## 已完成：单一播放链路

- [x] 上传阶段生成 2 秒分段 Opus 播放资产
- [x] IndexedDB 分段 Opus 读取、解码和调度
- [x] 共享 AudioContext / MediaStreamAudioDestinationNode 输出总线
- [x] 稳定 output Track 与监听端单一 `audio.srcObject`
- [x] session key、media epoch、playback revision 和 source peer 生命周期
- [x] single-flight sync、timeline generation、unit 去重和调度窗口
- [x] source fade、underrun 静音/恢复、limiter 和音频诊断
- [x] 删除 PCM、MSE、FLAC progressive、旧 orchestrator 和运行时 fallback
- [x] 删除房间缓存下载、手动缓存 UI、P2P 资产传输和 availability 协议

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
- [ ] 浏览器兼容性基线与移动端音频解锁提示优化

## 当前优先顺序

1. 先证明重连、source owner 离线和媒体会话恢复的行为稳定
2. 再补真实 WebRTC/Media 长时间 E2E 与弱网测试
3. 再补统一观测、告警和发布 smoke check
4. 最后处理歌单协作细节、审计和更完整权限模型
