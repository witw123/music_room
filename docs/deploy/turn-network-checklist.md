# TURN 外网链路检查清单

本项目的外网缓存速度取决于 WebRTC 实际 ICE 路径。内网常见 `host/srflx + udp` 直连会很快；外网如果落到 `relay/tcp`，缓存吞吐会明显下降，调度器会优先保护 active 播放 chunk。

## 必填配置

- `TURN_PUBLIC_HOST`：填写客户端可访问的公网域名或公网 IP，不得是 `localhost`、`127.0.0.1` 或内网地址。
- `TURN_EXTERNAL_IP`：填写 coturn 对外出口的真实公网 IP；云主机/NAT 场景不能填容器 IP 或 VPC 内网 IP。
- `TURN_PROTOCOLS=udp,tcp,tls`：优先 UDP，TCP/TLS 作为媒体 ICE 恢复的可用候选。
- `TURN_MIN_PORT` / `TURN_MAX_PORT`：relay 端口段必须和 coturn 配置、防火墙、安全组保持一致。

## 端口开放

至少开放：

- UDP `3478`
- TCP `3478`
- TCP `5349`（TURN TLS）
- `TURN_MIN_PORT`-`TURN_MAX_PORT` 的 UDP relay 端口段

如果 relay 端口段缺失，外网设备将无法建立稳定的媒体链路。媒体 RTP 与 DataChannel 已拆分，TCP/TLS 只作为媒体恢复候选，原文件 bulk 传输仍会在媒体 degraded 时暂停。

## DNS / Cloudflare

- TURN 域名必须直接解析到 TURN 服务器公网 IP。
- 使用 Cloudflare 时，TURN 记录必须设置为 **DNS-only**，不能启用橙云代理。
- 不要把 `turn:` / `turns:` 服务放在只代理 HTTP/HTTPS 的 CDN 后面。

## 客户端验证

进入房间后打开 Mesh 诊断面板，逐个 peer 检查：

- 数据路径：优先 `host` / `srflx`；跨 NAT 外网可接受 `relay`。
- 协议：媒体优先 `udp`，必要时可切换 `tcp/tls`；DataChannel bulk 在 relay/TCP 或媒体 degraded 时暂停。
- RTT：`<=120ms` 适合高速缓存；`>=250ms` 会被调度器降级；`>=400ms` 会被视为严重慢链路。
- DataChannel bufferedAmount：长期高于 `512KB` 说明发送端堆积，background 缓存会被限流。
- piece download/upload rate：聚合速率达到 2-3MB/s 时才能稳定支撑大体积歌曲快速补齐。

## 期望现象

- `fast-direct`：非 relay、非 tcp、RTT ≤ 120ms、下载 ≥ 4000kbps，允许更高 bulk 水位和更大分片。
- `relay-udp`：可用但限流，优先保障 critical chunk。
- `constrained/severe`：高 RTT、高丢包或低速率时，background 缓存暂停，RTP 音频优先；不通过降低 Opus 码率掩盖容量不足。
