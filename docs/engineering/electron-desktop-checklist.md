# Electron 桌面化实施清单

## 目标与默认范围
- 在仓库中新增 `apps/desktop` 作为 Electron 桌面壳，继续复用 `apps/web`、`apps/server`、`packages/shared`
- 第一阶段只做“桌面壳 + 现有 Web 业务复用”
- 不重写播放器、不迁移房间业务到主进程
- 离线安装包模式下由 Electron 主进程拉起本地 Web 与本地 API
- 文档定位为实施说明和验收清单，不承担营销介绍用途

## 目录结构
```text
apps/
  desktop/
    assets/
    src/
      main/
      preload/
      shared/
    electron-builder.yml
    package.json
    tsconfig.json
```

## 依赖清单
- `electron`
- `electron-builder`
- `electronmon`
- `esbuild`
- `concurrently`
- `wait-on`
- `typescript`

## 新增脚本清单
根目录：
- `dev:desktop`: 同时启动 `server`、`web`、`desktop`
- `build:desktop`: 构建 `web` 与 `desktop`
- `pack:desktop`: 打包 Electron 桌面应用

`apps/desktop`：
- `dev`
- `build`
- `typecheck`
- `pack`

## 第一阶段必须完成项
1. 建立 `apps/desktop` 骨架
2. 配置 Electron 主进程与 preload
3. 接入 workspace 脚本和打包配置
4. 让桌面端在开发模式加载现有 `apps/web`
5. 抽出前端桌面能力封装层
6. 接入文件选择、版本读取、外链打开
7. 产出本地 Web standalone 与本地 API runtime
8. 让打包后的桌面应用自动拉起本地 runtime
9. 验证登录、进房、上传、播放、同步

## 第二阶段增强项
- 托盘与后台驻留
- 自动更新
- 本地日志落盘与崩溃采集
- `showItemInFolder`
- 更完整的桌面菜单和快捷键
- 数据目录迁移与首次启动向导

## Electron 约束
- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- 渲染层只通过 preload 白名单 API 调用桌面能力
- 不暴露通用 IPC，不暴露任意文件系统访问，不暴露任意命令执行

## Preload 白名单 API
- `pickAudioFiles()`
- `readAudioFile(path)`：当前版本为让现有 Web 上传链路可复用而补充
- `getAppVersion()`
- `openExternal(url)`
- `showItemInFolder(path)`：已预留
- `writeDesktopLog(level, message)`：已预留

## 离线运行形态
- 打包时构建 `apps/web` 的 Next standalone 产物
- 打包时构建 `apps/server` 的 Nest 运行产物
- Electron 启动后在本机拉起：
  - Web: `127.0.0.1:3180`
  - API / WebSocket: `127.0.0.1:3181`
- 前端桌面包内固定使用本地 API / WS 地址
- 服务端默认启用 fallback auth 持久化，Redis/Prisma 不可用时允许降级启动

## 前端适配原则
- 优先复用浏览器原生上传与播放流程
- 桌面模式下仅在文件选择和系统能力处做条件分支
- WebRTC、IndexedDB、P2P 分片、播放器时钟同步继续留在渲染层
- 不引入第二套桌面 UI

## 已知风险点
- Next standalone 在 monorepo 下依赖 `outputFileTracingRoot`
- Prisma 与 Redis 仍然可能在本机缺失，需要继续验证 fallback 行为是否足够覆盖桌面版
- 音频、WebRTC、分片同步仍需在 Windows/macOS 真机验证

## 验收项
- Electron 能正常打开首页
- 开发模式可连接本地 `apps/web`
- 单实例策略有效
- preload 仅暴露白名单接口
- 渲染层无法直接访问 Node
- 登录、进房、上传、播放、队列、最近房间不退化
- 多成员同步播放仍可工作
- 成员进出、最小化恢复、大文件分片同步不出现明显回退

## 发布前检查项
- 确认 `MUSIC_ROOM_DESKTOP_RENDERER_URL` 或本地 renderer 产物路径
- Windows 安装包生成与安装验证
- macOS 安装包生成与签名策略确认
- 回归上传、播放、P2P、聊天、最近房间
- 检查外链、安全策略、单实例与 DevTools 开关
## Current Direction
- 开发模式：桌面壳加载本地 `apps/web`
- 生产模式：桌面壳通过 `MUSIC_ROOM_DESKTOP_RENDERER_URL` 加载远程前端
- 生产安装包不再内置 Next.js runtime
- 生产安装包不再内置本地 API runtime
