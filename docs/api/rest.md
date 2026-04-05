# REST API

最后更新：`2026-04-03`

## 认证方式

- 已登录接口通过请求头 `x-session-token` 传递会话令牌
- 当前主路径不再是旧的 `sessionId` query 参数文档

## 认证

### `POST /v1/auth/register`

- 注册账号并返回 `AuthSession`

### `POST /v1/auth/login`

- 登录并返回 `AuthSession`

### `POST /v1/auth/logout`

- 注销当前会话

### `GET /v1/auth/me`

- 读取当前会话

## 健康检查

### `GET /health`

- 存活检查

### `GET /health/readiness`

- 就绪检查

## 房间

### `POST /v1/rooms`

- 创建房间

### `GET /v1/rooms`

- 列出当前用户可访问的房间
- 公开房间列表默认只返回仍有在线成员的房间
- 当前用户自己可恢复的房间仍会返回，即使此时全员离线

### `GET /v1/rooms/recent/active`

- 获取最近活动房间

### `GET /v1/rooms/{roomId}/recover`

- 恢复指定房间

### `GET /v1/rooms/{roomId}`

- 获取房间快照

### `POST /v1/rooms/join-by-code`

- 按房间码加入房间

### `POST /v1/rooms/{roomId}/join`

- 按房间 ID 加入房间

### `POST /v1/rooms/{roomId}/leave`

- 离开房间
- 普通成员离开后会从成员列表移除
- 房主离开后仍保留在房间成员列表中，状态变为离线
- 房间不会因为无人在线自动销毁

### `DELETE /v1/rooms/{roomId}`

- 删除房间
- 仅房主可执行

### `POST /v1/rooms/{roomId}/tracks`

- 注册本地曲目元数据
- 服务端只收元数据，不接收音频文件本体

### `DELETE /v1/rooms/{roomId}/tracks/{trackId}`

- 删除曲库曲目

## 队列

### `GET /v1/rooms/{roomId}/queue`

- 获取当前房间队列

### `POST /v1/rooms/{roomId}/queue`

- 加入队列
- 当前行为是“只入队，不自动播放”

### `DELETE /v1/rooms/{roomId}/queue/{queueItemId}`

- 删除队列项

### `PATCH /v1/rooms/{roomId}/queue/reorder`

- 重排队列

## 播放控制

### `PATCH /v1/rooms/{roomId}/playback`

支持动作：

- `play`
- `pause`
- `seek`
- `next`
- `prev`

请求体关键字段：

- `action`
- `trackId` 或 `queueItemId`
- `positionMs`
- `expectedVersion`

说明：

- `expectedVersion` 必填
- 服务端会用 `queueVersion` 拒绝过期控制
- 房主控制权限和速率限制在服务端校验

## Realtime / ICE

### `GET /v1/realtime/ice-config`

- 获取当前会话可用的 ICE 配置
- 返回：
  - `iceServers`
  - `ttlSeconds`
  - `source`

`source` 当前可能是：

- `ephemeral`
- `static`
- `stun-only`

## 歌单

### `GET /v1/playlists`

- 获取我的歌单

### `POST /v1/playlists`

- 创建歌单

### `PATCH /v1/playlists/{playlistId}`

- 更新歌单标题、描述、标签、封面、曲目列表

### `DELETE /v1/playlists/{playlistId}`

- 删除歌单

### `POST /v1/playlists/{playlistId}/import-to-room`

- 将歌单导回房间队列

### `POST /v1/playlists/from-room`

- 将当前房间队列保存为歌单
