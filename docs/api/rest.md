# REST API

最后更新：`2026-03-28`

## 状态说明

- `已实现`：可以直接调用。
- `计划中`：文档存在，但代码尚未落地。

## 已实现接口

## 会话

- `POST /v1/guest-sessions`
  - 创建游客身份。

## 健康检查

- `GET /health`
  - 容器和服务探活。

## 房间

- `POST /v1/rooms`
  - 创建房间。
- `GET /v1/rooms?sessionId={sessionId}`
  - 查询某个会话的可恢复房间列表。
- `GET /v1/rooms/recent/active?sessionId={sessionId}`
  - 获取某个会话最近活跃房间。
- `GET /v1/rooms/{roomId}/recover?sessionId={sessionId}`
  - 仅当该会话属于房间成员时恢复房间快照。
- `GET /v1/rooms/{roomId}`
  - 获取房间快照。
- `POST /v1/rooms/join-by-code`
  - 通过房间码加入。
- `POST /v1/rooms/{roomId}/join`
  - 直接按房间 ID 加入。
- `POST /v1/rooms/{roomId}/leave`
  - 离开房间。
- `POST /v1/rooms/{roomId}/tracks`
  - 注册本地曲目元数据。

## 队列

- `GET /v1/rooms/{roomId}/queue`
  - 获取房间队列。
- `POST /v1/rooms/{roomId}/queue`
  - 添加队列项。
- `DELETE /v1/rooms/{roomId}/queue/{queueItemId}?sessionId={sessionId}`
  - 删除队列项。
  - 仅房主或点歌人可删。

## 播放

- `PATCH /v1/rooms/{roomId}/playback`
  - `action`: `play | pause | seek | next`
  - `sessionId`: 必填，服务端校验是否为房主。

## 歌单

- `GET /v1/playlists?ownerId={ownerId}`
  - 列出歌单。
- `POST /v1/playlists`
  - 创建歌单。
- `PATCH /v1/playlists/{playlistId}`
  - 修改歌单。
- `DELETE /v1/playlists/{playlistId}?ownerId={ownerId}`
  - 删除歌单。
- `POST /v1/playlists/from-room`
  - 从当前房间队列保存歌单。
- `POST /v1/playlists/{playlistId}/import-to-room`
  - 把歌单重新导入当前房间队列。

## 尚未实现接口

- `GET /v1/guest-sessions/me`
- `POST /v1/playlists/{playlistId}/favorite`
- `POST /v1/playlists/{playlistId}/collaborators`
- `PATCH /v1/rooms/{roomId}/queue/{queueItemId}`
