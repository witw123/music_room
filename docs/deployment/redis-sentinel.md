# Redis Sentinel / HA

最后更新：`2026-07-07`

## 当前范围

当前仓库已经补齐两部分：

- 服务端支持通过 Sentinel 发现 Redis master
- 提供了一份本地/样例用的 Sentinel compose：`deploy/linux/docker-compose.redis-sentinel.yml`

这是一套基础 HA 样例，用于把当前单点 Redis 提升到 Sentinel 发现 master 的部署形态。

## 服务端环境变量

单机模式：

```env
REDIS_MODE=single
REDIS_URL=redis://redis:6379
REDIS_DB=0
```

Sentinel 模式：

```env
REDIS_MODE=sentinel
REDIS_SENTINELS=redis-sentinel-1:26379,redis-sentinel-2:26379,redis-sentinel-3:26379
REDIS_SENTINEL_MASTER_NAME=mymaster
REDIS_USERNAME=
REDIS_PASSWORD=replace-with-a-real-redis-password
REDIS_SENTINEL_USERNAME=
REDIS_SENTINEL_PASSWORD=
REDIS_DB=0
```

## 启动 Sentinel 样例

```bash
docker compose -f deploy/linux/docker-compose.redis-sentinel.yml up -d
```

然后把服务端环境切到：

```env
REDIS_MODE=sentinel
REDIS_SENTINELS=127.0.0.1:26379
REDIS_SENTINEL_MASTER_NAME=mymaster
REDIS_PASSWORD=replace-with-a-real-redis-password
```

## 与主服务编排组合

生产环境更常见的方式是：

1. Redis Sentinel 集群独立部署
2. `server` 通过 `REDIS_MODE=sentinel` 指向 Sentinel 节点
3. `web` 不直接连接 Redis
4. `server` readiness 中检查 Redis 连接模式和可用性

当前服务端 readiness 响应会带上 `redisMode`，便于确认当前 Redis 连接模式。

## 建议

- 短期：先把 Sentinel 跑起来，验证 failover 后服务端仍能恢复连接
- 中期：补 Sentinel 断连恢复测试和告警
- 长期：再考虑更完整的 Redis 托管或 Cluster 方案
