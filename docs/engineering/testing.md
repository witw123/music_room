# 测试策略

最后更新：`2026-03-28`

## 当前状态

- `已完成`
  - `packages/shared` 基础 schema 测试
  - `apps/server` 房间服务关键测试
  - `apps/server` 房间控制器和网关测试
  - `apps/web` P2P 纯逻辑测试
  - `apps/web` chunk hash 与整曲重组校验测试
  - 全仓 `typecheck`、`build`、`test`
- `未完成`
  - 服务端控制器集成测试
  - WebSocket 实时测试
  - 前端组件测试
  - E2E 自动化测试
  - P2P/IndexedDB 测试

## 已落地测试

## 1. shared

- schema 约束测试

## 2. server

已覆盖：

- 仅房主可控制播放
- 仅房主或点歌人可删除队列项
- 房主离房后自动转移房主身份
- 歌单重新导回房间队列
- 最近活跃房间恢复
- 房间码加入后的快照广播
- 房间删除后的离房分支
- WebSocket 订阅时立即回推快照
- 缺失房间时回推 `room.snapshot.missing`
- Redis 远端实例快照转发

## 待补测试

## 1. 服务端控制器与集成测试

- 游客身份创建
- 建房、入房、离房
- 队列增删
- 播放接口权限
- 歌单保存和删除
- 最后一名成员离房的删除分支

## 2. WebSocket 测试

- `room.subscribe`
- `room.unsubscribe`
- `room.snapshot`
- Redis 跨实例广播不重复回放

## 3. 前端测试

- `已完成`
  - P2P 缺块选择和可用性汇总纯逻辑
  - 分片 hash 校验和整曲重组校验纯逻辑
- `未完成`
  - 房间状态映射
  - 播放器交互
  - 歌单工作流

## 4. E2E

- 创建身份
- 创建房间
- 导入曲目
- 加歌、播放、seek
- 保存歌单并导回房间
- 第二位成员通过房间码加入

## 5. P2P 专项测试

- WebRTC 建链成功率
- DataChannel 分片收发
- IndexedDB 缓存命中
- 弱网重试

## 最近测试优先级

1. 服务端控制器集成测试
2. WebSocket 实时测试
3. 前端基础组件测试
4. E2E 主流程测试
