# 部署方案

## 组件

- Web: Next.js 应用
- Server: NestJS API + WebSocket
- Database: PostgreSQL
- Cache: Redis
- Reverse Proxy: Nginx 或云负载均衡

## 建议方式

- 使用 Docker 打包 Web 与 Server
- PostgreSQL 与 Redis 优先使用托管服务
- 反向代理统一处理 TLS 和路由

## 环境变量

- `PORT`
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_WS_URL`
- `NEXT_PUBLIC_STUN_URL`

