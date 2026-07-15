# TURN 外网媒体链路检查清单

最后更新：`2026-07-15`

本项目的跨网络播放质量取决于 WebRTC Media RTP 的实际 ICE 路径。控制 DataChannel 和媒体连接独立建立，但两者都依赖正确的信令、候选地址和 TURN 配置。房间不通过 WebRTC 传输音频文件或缓存分片。

## 必填配置

- `TURN_PUBLIC_HOST`：填写客户端可访问的公网域名或公网 IP，不得是 `localhost`、`127.0.0.1` 或内网地址
- `TURN_EXTERNAL_IP`：填写 coturn 对外出口的真实公网 IP；云主机/NAT 场景不能填容器 IP 或 VPC 内网 IP
- `TURN_PROTOCOLS=udp,tcp,tls`：优先 UDP，TCP/TLS 作为媒体恢复候选
- `TURN_MIN_PORT` / `TURN_MAX_PORT`：relay 端口段必须和 coturn、防火墙、安全组一致

## 端口开放

至少开放：

- UDP `3478`
- TCP `3478`
- TCP `5349`（TURN TLS）
- `TURN_MIN_PORT`-`TURN_MAX_PORT` 的 UDP relay 端口段

relay 端口段缺失时，外网设备可能无法建立稳定的 RTP 媒体链路，或只能在短时间内连接后进入 `reconnecting`。

## DNS / Cloudflare

- TURN 域名必须直接解析到 TURN 服务器公网 IP
- 使用 Cloudflare 时，TURN 记录必须设置为 **DNS-only**，不能启用橙云代理
- 不要把 `turn:` / `turns:` 服务放在只代理 HTTP/HTTPS 的 CDN 后面

## 客户端验证

进入房间后打开“成员与诊断”，逐个 peer 检查：

- `dataIceState` / `mediaIceState`
- `dataConnectionState` / `mediaConnectionState`
- candidate type：直连通常为 `host`/`srflx`，跨 NAT 可接受 `relay`
- media protocol：优先 UDP，必要时使用 TCP/TLS
- `currentRoundTripTimeMs`、`jitterMs`、`packetLossRate`
- `mediaReceiveBitrateKbps` / `mediaSendBitrateKbps`
- `senderTrackId` / `receiverTrackId`
- `remoteTrackStatus.hasSrcObject`、`lastAudioEvent` 和 `lastPlayAttemptResult`

## 期望现象

- 控制和媒体连接都达到 connected/connected 或对应的稳定状态
- RTP bitrate 持续大于零，`lastMediaPacketAt` 持续更新
- `remoteTrackId` 在非重连期间保持不变
- `bufferedAheadMs` 和 `scheduledAheadMs` 能覆盖调度保护窗口
- 没有持续增长的 `underrunCount`，limiter 后 peak 不超过 0dBFS

## 快速判断

- offer/answer 正常但 ICE failed：先检查 TURN 域名、relay 端口和 UDP 出口
- Media connected 但 RTP bitrate 为零：检查发送端 output Track、媒体协商方向和源端 AudioContext
- RTP 有数据但无声：检查远端 Track 绑定、`audio.play()`、浏览器自动播放策略和页面静音状态
- RTP 有数据且反复 underrun：检查源端 IndexedDB 读取、解码耗时、buffer ahead、jitter 和 packet loss
