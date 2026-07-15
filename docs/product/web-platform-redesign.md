# Web 平台当前设计基线

最后更新：`2026-07-15`
当前版本：`0.2.8`

## 文档状态

本文件取代早期包含房间缓存下载、成员资产传输和四个主 Tab 的 Web 改版提案。以下内容描述当前产品实际边界，不是新的协议或运行时方案。

## 站点结构

| 路由 | 用途 |
| --- | --- |
| `/` | 产品介绍页 |
| `/auth` | 登录和注册 |
| `/app` | 客户端工作区/房间大厅 |
| `/rooms` | 房间与最近房间入口 |
| `/room/[roomId]` | 房间工作区 |

所有页面由同一个 Next.js Web 应用提供，桌面与移动浏览器使用同一套响应式布局。

## 房间工作区

房间页面以当前播放舞台、底部播放器和工作区为核心。工作区主视图为：

- `Queue`：共享队列、点歌、重排、删除和播放控制
- `Library`：房间曲库、个人本地导入和加入队列
- `Members`：成员、连接、媒体和播放诊断

不存在 `Cache`/`Download` 一级页面。IndexedDB 保存当前用户自己上传的歌曲及本地生成的资产；它不代表房间可下载内容，也不显示成员间缓存状态。

## 音频与状态表达

界面应围绕当前唯一播放链路表达状态：

```text
IndexedDB segmented Opus
  -> SegmentedOpusEngine
  -> shared AudioContext
  -> WebRTC RTP Opus
  -> listener audio.srcObject
```

普通用户可见的播放状态包括当前歌曲、播放/暂停、同步状态、源拥有者在线状态和缓冲状态。详细诊断显示：

- AudioContext state
- `playbackAssetId` / `mediaSessionKey`
- `outputTrackId` / `remoteTrackId`
- buffered/scheduled ahead 和 underrun
- limiter peak/RMS
- ICE、RTP bitrate、jitter、packet loss 和最近事件

## 产品边界

- 音频文件不上传到服务端
- 房间只同步元数据、队列、播放状态、presence 和 WebRTC 信令
- `music-room-control` DataChannel 只承载控制/健康协调
- 音频通过独立 WebRTC RTP Opus Track 发送
- 曲目拥有者是当前播放源；拥有者离线时播放暂停
- 不提供缓存下载、缓存导出、成员间音频资产传输或播放 fallback

## 交互原则

- 首屏优先显示真实可操作的房间和播放状态，不把功能站做成营销页
- 播放控制使用稳定尺寸，避免缓冲、错误文本或图标变化造成布局跳动
- 成员/presence 更新不应让播放器重建、清空远端 `srcObject` 或替换 Track
- `waiting`/`stalled` 恢复只重试 `audio.play()`，不要求用户退房重进
- 诊断面板给出可操作的连接、音频解锁、源在线和媒体恢复信息
- 桌面和移动布局保持同一信息架构，移动端使用折叠面板和安全区适配

## 验收标准

- 用户可以从 `/app` 创建或加入房间
- 房间内可以导入本地音频、加入队列、播放、暂停、seek、切歌和重排
- 用户刷新后可以恢复自己上传的个人曲库
- 两个浏览器 context 可以建立控制和媒体连接并连续播放
- 成员加入/离开、presence、普通快照和音量变化不会中断媒体会话
- 非媒体会话变化时 `outputTrackId`、`remoteTrackId` 和 `audio.srcObject` 保持稳定
- 缺片、解码等待、RTP 丢包和媒体重连有可观测状态
- UI 不出现缓存下载、资产互传或旧播放 fallback 的入口和文案
