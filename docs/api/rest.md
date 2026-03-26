# REST API 草案

## 会话

- `POST /v1/guest-sessions`
- `GET /v1/guest-sessions/me`

## 房间

- `POST /v1/rooms`
- `POST /v1/rooms/{roomId}/join`
- `POST /v1/rooms/{roomId}/leave`
- `GET /v1/rooms/{roomId}`

## 歌单

- `GET /v1/playlists`
- `POST /v1/playlists`
- `PATCH /v1/playlists/{playlistId}`
- `DELETE /v1/playlists/{playlistId}`
- `POST /v1/playlists/{playlistId}/favorite`
- `POST /v1/playlists/{playlistId}/collaborators`

## 队列

- `GET /v1/rooms/{roomId}/queue`
- `POST /v1/rooms/{roomId}/queue`
- `PATCH /v1/rooms/{roomId}/queue/{queueItemId}`
- `DELETE /v1/rooms/{roomId}/queue/{queueItemId}`

