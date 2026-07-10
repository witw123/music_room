# Cache Tab Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将缓存 Tab 重做为状态准确、信息精简、桌面与移动端均易操作的双列表页面。

**Architecture:** 新增纯 `cache-tab-view-model.ts` 集中派生状态、筛选和格式化，`CacheTabPanel.tsx` 只负责渲染与歌曲级异步交互。继续使用现有 `tracks`、`availabilitySummary`、`cacheLibraryTracks`、`manualCacheTasks` 和回调，不修改后端或 IndexedDB 数据格式。

**Tech Stack:** React 19、TypeScript、Tailwind CSS、Vitest

---

### Task 1: 缓存页状态派生

**Files:**
- Create: `apps/web/src/components/room/cache-tab-view-model.ts`
- Create: `apps/web/src/components/room/cache-tab-view-model.test.ts`

- [ ] **Step 1: 编写失败测试**

覆盖失败不被离线覆盖、`ready` 显示正在完成、未知分片不显示 `0/0`、房间歌曲筛选和已在曲库判断。

- [ ] **Step 2: 验证测试失败**

Run: `pnpm --filter @music-room/web test -- src/components/room/cache-tab-view-model.test.ts`

Expected: FAIL，因为状态派生模块尚不存在。

- [ ] **Step 3: 实现最小状态派生模块**

导出 `deriveRoomCacheRow`、`filterRoomCacheRows`、`formatCacheSize`、`formatCachedAt` 和缓存筛选类型。状态优先级严格遵循设计规格，并只在下载状态显示有效速度与缓冲。

- [ ] **Step 4: 验证测试通过**

Run: `pnpm --filter @music-room/web test -- src/components/room/cache-tab-view-model.test.ts`

Expected: PASS。

### Task 2: 重做缓存页面

**Files:**
- Modify: `apps/web/src/components/room/CacheTabPanel.tsx`

- [ ] **Step 1: 实现紧凑概览与筛选**

概览显示缓存歌曲数、总大小、进行中任务数；房间歌曲使用四段筛选，本机缓存提供搜索框。

- [ ] **Step 2: 实现房间歌曲紧凑列表**

使用状态派生结果渲染歌名、来源、时长、进度、有效速度/缓冲和单一主操作。删除内部诊断字段，下载中只显示暂停，失败和暂停显示恢复操作。

- [ ] **Step 3: 实现本机缓存列表与逐项交互**

按 `动作:fileHash` 记录独立 Promise 状态；添加、导出和删除期间仅锁定对应歌曲。已加入当前曲库时禁用添加按钮，删除使用行内二次确认。

- [ ] **Step 4: 处理响应式布局与无数据状态**

桌面使用对齐的横向列表，移动端自然换行；空筛选结果、空缓存库和无其他成员歌曲分别显示准确提示。

### Task 3: 聚焦验证

**Files:**
- Test: `apps/web/src/components/room/cache-tab-view-model.test.ts`
- Verify: `apps/web/src/components/room/CacheTabPanel.tsx`

- [ ] **Step 1: 运行缓存页定向测试**

Run: `pnpm --filter @music-room/web test -- src/components/room/cache-tab-view-model.test.ts`

- [ ] **Step 2: 运行静态质量检查**

Run: `pnpm --filter @music-room/web typecheck`

Run: `pnpm --filter @music-room/web lint`

- [ ] **Step 3: 运行 Web 全量测试与构建**

Run: `pnpm --filter @music-room/web test`

Run: `pnpm --filter @music-room/web build`

- [ ] **Step 4: 检查最终差异并提交**

确保仅包含缓存页、状态派生、测试和计划文档，不包含用户已有的桌面 Cargo 配置改动。
