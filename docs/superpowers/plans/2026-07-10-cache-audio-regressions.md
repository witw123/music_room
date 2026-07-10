# Cache Audio Regressions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 FLAC 边缓存无声、缓存搜索框白底和完整缓存诊断误报。

**Architecture:** 保持现有播放与缓存架构，在 WebCodecs 配置边界使用已规范化配置，在播放意图模型中增加实际发声后的宽松身份匹配，在诊断视图模型中以真实音频元素输出为准。缓存页仅调整搜索框控件样式。

**Tech Stack:** TypeScript、React、WebCodecs、Vitest、Tailwind CSS

---

### Task 1: WebCodecs FLAC 配置

**Files:**
- Modify: `apps/web/src/features/playback/progressive-pcm-engine.ts`
- Modify: `apps/web/src/features/playback/progressive-pcm-engine.test.ts`

- [ ] 编写失败测试，模拟 `isConfigSupported()` 返回与原始对象不同的规范化配置。
- [ ] 运行定向测试并确认失败原因是 `configure()` 未使用规范化配置。
- [ ] 实现支持配置解析，并使用返回的 `support.config` 配置解码器。
- [ ] 运行 PCM 引擎定向测试。

### Task 2: 完整缓存发声状态

**Files:**
- Modify: `apps/web/src/components/room/diagnostics-view-model.ts`
- Modify: `apps/web/src/components/room/diagnostics-view-model.test.ts`
- Modify: `apps/web/src/features/playback/playback-start-intent.ts`
- Modify: `apps/web/src/features/playback/playback-start-intent.test.ts`
- Modify: `apps/web/src/features/playback/playback-orchestrator/playback-start-intent-controller.ts`

- [ ] 编写失败测试，证明实际播放的 Blob 音源应覆盖 `fullLocalReady=false` 和待处理意图。
- [ ] 编写失败测试，证明实际启动的同曲目音频可在 revision 落后时消费意图。
- [ ] 调整诊断可听判断和播放意图身份匹配。
- [ ] 在播放成功路径消费已由实际发声满足的意图。
- [ ] 运行两个定向测试文件。

### Task 3: 缓存页暗色搜索框

**Files:**
- Modify: `apps/web/src/components/room/CacheTabPanel.tsx`
- Create: `apps/web/src/components/room/CacheTabPanel.test.ts`

- [ ] 编写失败的源约束测试，要求搜索框使用明确深色背景和暗色控件配色。
- [ ] 修改搜索框样式并运行定向测试。

### Task 4: 验证与提交

- [ ] 运行 Web 类型检查、lint、全量测试和生产构建。
- [ ] 检查差异不包含 `apps/desktop/src-tauri/Cargo.toml`。
- [ ] 提交并推送 `main`。
