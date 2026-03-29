# Music Room 完整优化建议

> 检查时间：2026-03-29

---

## 一、质量检查结果

| 检查项 | 状态 | 详情 |
|--------|------|------|
| `typecheck` | ✅ 通过 | web / server / shared 三包全部通过 |
| `test` | ✅ 通过 | 25 个测试全部通过（server:15, web:9, shared:1） |
| `build` | ✅ 通过 | Next.js + NestJS 构建成功 |

---

## 二、按优先级分类的问题汇总

### P0 — 安全问题（必须修复）

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| S1 | JWT token 为占位符，永不验证 | `auth.service.ts:16` | `token: "replace-with-jwt"` |
| S2 | 无任何 REST 端点的身份认证 | 所有 controller | 仅靠 sessionId 可被伪造 |
| S3 | WebSocket CORS 允许任意 origin | `signaling.gateway.ts:25` | `origin: "*"` |
| S4 | joinCode 用 `Math.random()` 生成 | `room.service.ts:393` | 可预测，不够安全 |
| S5 | 生产 docker-compose JWT_SECRET 硬编码 | `docker-compose.yml:47` | `replace-me` |
| S6 | 生产 PostgreSQL 密码硬编码为 `postgres` | 多处 | 安全风险 |
| S7 | `prisma db push` 在 Dockerfile 中用于生产 | `Dockerfile.server:33` | 应改为 `migrate deploy` |
| S8 | 歌单列表/详情无权限校验 | `playlist.service.ts` | 任意 session 可查看任意歌单 |

### P1 — 内存泄漏与资源管理

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| L1 | `URL.createObjectURL()` 永不释放 | `music-room-app.tsx:369,564,825` | 三处创建但无 `revokeObjectURL` |
| L2 | 音频元素 listeners 未清理 | `music-room-app.tsx:1393-1401` | audio 元素引用丢失后 listener 仍存在 |
| L3 | Redis subscribe handlers 永不注销 | `redis.service.ts:117-132` | handler closure 注册后从未移除 |

### P1 — 类型安全

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| T1 | Socket.IO client 全部 `any[]` | `socket-io-client.d.ts:2-4` | 事件 payload 全部无类型 |
| T2 | WebRTC 双重类型断言 | `mesh.ts:67,76,83,165,192` | `as unknown as T` 绕过类型检查 |
| T3 | JSON.parse 无 schema 验证 | `mesh.ts:202` | 畸形消息可导致崩溃 |
| T4 | Prisma JSON 字段无运行时校验 | `schema.prisma` | playback/members/tracks 等列 |
| T5 | 控制器 body 参数无 DTO | 所有 controller | 裸对象直接传入 |

### P1 — 架构与代码质量

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| A1 | 1413 行巨型组件 | `music-room-app.tsx` | 应拆分为 5+ 个子组件 |
| A2 | RoomService 做太多（3 种存储 + 权限 + 队列） | `room.service.ts` | 违反单一职责 |
| A3 | 10+ 处重复的 snapshot 发射逻辑 | 各 controller | 每次 mutation 后重复 |
| A4 | SignalingGateway 用 `ModuleRef.get()` 反模式 | `signaling.gateway.ts:122,140` | 应通过 constructor 注入 |
| A5 | 3 个空服务（Playback/Queue/Track） | `*.service.ts` | 仅骨架，无实际逻辑 |
| A6 | DomainError 定义了但从未使用 | `domain.error.ts` | 服务层全部抛 plain Error |
| A7 | Dead code: `room-store.ts` + `use-room-session.ts` | `web/src` | 定义但未被 `MusicRoomApp` 使用 |

### P1 — 测试覆盖

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| C1 | P2PMesh 类本身无测试 | `mesh.test.ts` 存在但为空 |
| C2 | MusicRoomApp 组件无测试 | 无 `.test.tsx` 文件 |
| C3 | IndexedDB 操作无测试 | 无 `indexeddb.test.ts` |
| C4 | PlaylistService/PlaybackService/QueueService/TrackService 无测试 | 对应 `.spec.ts` 不存在 |
| C5 | 所有 controller（除 Room）无测试 | Auth/Playback/Queue/Playlist/Health |
| C6 | Vitest 环境为 `node` 但 P2P 使用浏览器 API | `vitest.config.ts` | 应为 `jsdom` 或 `happy-dom` |

### P2 — 性能问题

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| P1 | IndexedDB 复合索引查询效率低 | `indexeddb.ts:101-112,90-99` | 先加载全部 pieces 再内存过滤 |
| P2 | `availabilitySummary` 每次渲染重复计算 | `music-room-app.tsx:880-890` | 应 `useMemo` |
| P3 | 房间 track 列表无虚拟化 | `music-room-app.tsx:1039-1064` | 大量曲目时性能问题 |
| P4 | 大组件无代码分割 | `music-room-app.tsx` | 应 `React.lazy()` |

### P2 — Redis 使用问题

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| R1 | Redis key 前缀无常量，分散字符串字面量 | `room.service.ts` | `music-room:rooms:*` 等 |
| R2 | TTL 硬编码在 service 内 | `room.service.ts:26-27` | 应移至配置 |
| R3 | 两个独立 Redis 客户端无协调 | `redis.service.ts:7-14` |  |
| R4 | Redis 不可用时所有方法静默失败 | `redis.service.ts` 全文 | 无错误日志，可能丢消息 |

### P2 — 数据库

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| D1 | `RoomState.updatedAt` 无索引 | `schema.prisma` | 查询依赖但未建索引 |
| D2 | `Playlist.ownerId` / `roomId` 无索引 | `schema.prisma` |  |
| D3 | PrismaService 过度封装（getter 返回 this 转换） | `prisma.service.ts:25-35` | 无谓的 any cast |
| D4 | 多记录操作无事务 | `persistRecord()` | Redis 成功后 Prisma 失败会不一致 |
| D5 | Prisma 不可用时无状态调和机制 | `room.service.ts` | 内存与持久化分裂脑 |

### P2 — P2P 实现

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| W1 | 只有 STUN，无 TURN | `mesh.ts:148` | 对称 NAT 用户无法建立连接 |
| W2 | `pendingPieceRequests` timeout 在 `destroy()` 时未清理 | `mesh.ts` | 内存泄漏 |
| W3 | peer 断连后不清理旧连接 | `mesh.ts` | 直接尝试新建而不先关闭 |
| W4 | P2P 测试仅为 helper 纯函数，Mesh 类无覆盖 | `index.test.ts` | `mesh.test.ts` 实际无 Mesh 测试 |

### P2 — API 合约与文档

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| K1 | `room.snapshot.missing` 事件未在 schema 定义 | `events.ts` | gateway 发射但 schema 无 |
| K2 | `room.join` 在 schema 但实现用 `room.subscribe` | `events.ts` vs `ws-client.ts` | 文档与实现不一致 |
| K3 | `p2pDataMessageSchema` 未导出且未使用 | `events.ts` + `index.ts` | 死代码 |
| K4 | `piece.availability` 仅 relay 不存储处理 | `signaling.gateway.ts:74-81` |  |
| K5 | `queue.update` / `playback.update` 在 schema 但未实现 | `events.ts` |  |
| K6 | 多处 REST endpoint 缺少请求/响应 body schema | `rest.md` | 文档不完整 |
| K7 | WebSocket 无错误响应格式文档 | `websocket-events.md` |  |
| K8 | `TrackPieceInfo` / `TrackAvailability` 文档有但未使用 | `shared-models.md` |  |
| K9 | nginx 无 TLS 配置 | `music-room.conf` | HTTPS/WSS 无法终止 |
| K10 | 生产环境变量命名不一致 | `docker-compose.yml` vs `.env.production.example` | NEXT_PUBLIC_API_BASE_URL vs http://server:3001 |

---

## 三、推荐修复顺序

### 第一批：安全修复（1-2 天）

1. 修复/移除 `replace-me` JWT secret
2. 将 `prisma db push` 改为 `prisma migrate deploy`
3. 生产密码改为环境变量注入
4. `Math.random()` joinCode 改为 `crypto.randomUUID()`
5. 添加 JWT 验证中间件或迁移到 session-based auth
6. 歌单增加 ownerId 校验

### 第二批：内存泄漏修复（1 天）

1. 所有 `URL.createObjectURL()` 调用配套 `URL.revokeObjectURL()`
2. 修复 audio element listener 泄漏
3. Redis subscribe handler 注销逻辑
4. `pendingPieceRequests` timeout 在 `destroy()` 时清理

### 第三批：类型安全（1-2 天）

1. 重写 `socket-io-client.d.ts`，为每个事件定义 payload 类型
2. 为所有 controller 添加 DTO（class-validator）
3. `persistRecord()` 添加 Prisma transaction
4. Redis key 前缀和 TTL 提取为常量

### 第四批：架构重构（2-3 天）

1. 拆分 `MusicRoomApp` 为 5+ 个子组件
2. RoomService 拆分（提取 QueueService / PlaybackService 实际逻辑）
3. 抽取重复 snapshot 发射逻辑为 decorator 或 service method
4. SignalingGateway 改为 constructor 注入 RoomService

### 第五批：测试覆盖（持续）

1. 添加 P2PMesh 单元测试
2. 添加 MusicRoomApp 组件测试（RTL）
3. 补全 PlaylistService / QueueService / PlaybackService 测试
4. 修复 vitest.config.ts 环境为 jsdom

---

## 四、验证方式

修复完成后，运行以下命令验证：

```bash
# 类型检查
npx pnpm typecheck

# 测试
npx pnpm test

# 构建
npx pnpm build

# Docker 启动验证
docker compose up --build
# 访问 http://localhost:3000 和 http://localhost:3001/health
```

---

## 五、长期建议

1. **Phase 3 P2P 收尾**：完整分片协议、peer 调度、TURN 接入
2. **Phase 4 补齐**：协作歌单、E2E、观测告警（Sentry + metrics）
3. **文档同步**：REST/WebSocket 文档与实际实现对齐
4. **IndexedDB 回收策略**：缓存满时淘汰旧数据
