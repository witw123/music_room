---
target: current frontend
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 5
timestamp: 2026-07-30T15-58-21Z
slug: apps-web-src-components-productlandingpage-tsx
---
⚠️ DEGRADED: single-context (no sub-agent tool exposed; browser-control plugin unavailable, local Playwright fallback used)

# Music Room 前端界面审查

审查范围：
- 主要目标：`apps/web/src/components/ProductLandingPage.tsx`
- 代表性界面：`AuthPage`、`RoomsHomePage`、`RoomWorkspace`、`RoomDashboardView`、底部播放器与全局导航
- 设计依据：`DESIGN.md`、产品文档、design-taste-frontend、Impeccable critique/audit 规则

## Design Read

Reading this as: 面向音乐极客的实时协作听歌产品，包含营销、认证和 Operate 型房间工作区，采用低光、技术化、空间化的声学视觉语言，依托自定义暗色 token 系统和舞台/工作区双区布局。

当前建议的界面拨盘：
- 营销页：DESIGN_VARIANCE 7 / MOTION_INTENSITY 5 / VISUAL_DENSITY 3
- 房间工作区：DESIGN_VARIANCE 5 / MOTION_INTENSITY 5 / VISUAL_DENSITY 6

## Design Health Score

| # | 启发式原则 | 分数 | 关键问题 |
|---|---|---:|---|
| 1 | 系统状态可见性 | 2/4 | 播放、连接、加载状态有基础表达，但认证配置失败和网络依赖在首屏不够可见。 |
| 2 | 系统与现实世界匹配 | 3/4 | 房间、队列、房主、音源、歌词和播放舞台都贴合产品模型；营销页技术承诺偏多。 |
| 3 | 用户控制与自由 | 3/4 | 有离开、暂离、返回、关闭对话框、播放器控制和主题切换；移动固定层可能压缩内容。 |
| 4 | 一致性与标准 | 2/4 | 主工作区 token 较完整，但营销、认证、管理端存在硬编码颜色、字体和圆角体系漂移。 |
| 5 | 错误预防 | 2/4 | 表单校验、权限和 Turnstile 前置检查不错；占位链接和无证据性能数字会制造错误预期。 |
| 6 | 识别而非回忆 | 3/4 | 导航、标签、房间码、播放器控件有文字或辅助标签；诊断信息仍要求用户理解较多技术术语。 |
| 7 | 灵活高效 | 3/4 | 桌面/移动分支、紧凑播放器、可折叠侧栏和自定义布局提供了弹性。 |
| 8 | 美观与极简 | 3/4 | 黑底、电蓝、单一舞台和薄边框形成鲜明品牌；营销页的静态预览与重复信息降低了克制感。 |
| 9 | 错误恢复 | 2/4 | 有用户可读错误转换和图片回退；认证/网络错误后的下一步指引仍较弱。 |
| 10 | 帮助与文档 | 1/4 | 主要流程缺少上下文帮助，房间码、权限、音源所有权和诊断状态依赖用户自行理解。 |
| **总分** |  | **24/40** | **方向明确，但仍未达到可放心发布的完成度。** |

## Design Specificity Verdict

### LLM assessment

结果明显为 Music Room 定制：实时房间码、Vinyl 播放舞台、本地文件、WebRTC 状态和共享队列共同组成了产品自己的视觉语法，不是换个文案就能套到普通 SaaS 的模板。`DESIGN.md` 对“播放是视觉重心”和“stage/workspace 双区”的判断也确实落进了 `RoomDashboardView` 与 `RoomStage`。

但营销页首屏的 `ProductRoomPreview` 是手写的静态伪产品截图，和真实房间组件分开维护；这会让产品最重要的证明材料在迭代后最容易失真。英文营销短语和“下一代”式表达也削弱了本来很好的技术声誉感。

### Deterministic detector

Impeccable detector 在 `apps/web/src/components` 和 `apps/web/src/app` 发现 13 个候选项：
- `broken-image` 4 个：发现页及 provider 详情页的外部图片。结合源码，这些组件有 `onError` 和 fallback，属于静态扫描无法推断动态 URL 的误报风险，不应直接当成已发生的破图。
- `border-accent-on-rounded` 2 个：营销预览的唱针和真实唱针，属于有意表达唱针/唱头的边缘高光，低风险。
- `gray-on-color` 1 个：队列按钮只在 hover 时使用红色背景，扫描器把 hover 背景和默认文字拼在一起，基本是误报。
- `side-tab` 2 个、`overused-font` 2 个：只出现在独立管理端，属于独立运维界面的局部风格，不影响主工作区判断。
- `layout-transition` 2 个：`globals.css:342` 的侧栏宽度和 `globals.css:435` 的内容左内边距会触发布局重排，属于真实但低优先级的技术问题。

## Overall Impression

视觉方向是对的：它有安静、低光、技术但不冷的音乐空间感，首屏也能让人理解“多人共享一个播放房间”。最大机会不是再加装饰，而是把真实产品状态、可信的产品证据和所有入口的设计语言收拢到同一条体验线上。

## What's Working

1. `DESIGN.md`、CSS token 和房间组件之间有真实关联，电蓝被用作状态信号而非整页染色。
2. 营销首屏的舞台/队列/成员/传输信息组合，能在一张画面里解释产品模型；桌面与移动首屏均无水平溢出。
3. 房间工作区具备 loading、empty、error、tabs、权限和 reduced-motion 等工程意识，`RoomDashboardView` 的 tab 语义和 `VinylAuraVisualizer` 的节流/降级思路是可靠基础。

## Priority Issues

### [P1] 营销页仍暴露占位链接和无效法律入口

**证据**：`ProductLandingPage.tsx:8`、`:374-381` 与 `TopBar.tsx:42` 使用 `https://example.test/music-room`；Privacy 和 Terms 使用 `#`。

**为什么重要**：GitHub 是首屏公开入口，当前点击会把用户带到测试域名；Privacy/Terms 看起来像正式链接却不产生有效导航，直接损伤可信度。

**修复**：替换为真实仓库和真实政策路径；在内容还未准备好前隐藏这三个入口，不要把占位 URL 发布到用户可见 UI。

**建议命令**：`/impeccable harden`、`/impeccable clarify`

### [P1] 首屏产品预览是静态伪截图，不能成为真实产品证据

**证据**：`ProductLandingPage.tsx:57-227` 手写了队列、唱片、成员和诊断卡片；`Night Drive`、`room_27A4`、`< 50ms Sync` 等内容都是固定值。

**为什么重要**：这违反 taste skill 对 div-based fake screenshots 的禁用规则，也会让营销页与真实 `RoomStage`/`RoomDashboardView` 的布局、状态和文案逐渐分叉。用户看到的是“看起来像产品”的模型，而不是产品本身。

**修复**：优先复用真实 room 组件的只读 demo 状态并固定容器尺寸；如果隔离真实运行时成本太高，就使用明确标注的真实截图或生成的产品 bitmap，不要继续维护第二套伪 UI。

**建议命令**：`/impeccable document`、`/impeccable polish`

### [P1] 性能承诺和营销文案缺少证据，且有明显的 AI/占位腔调

**证据**：`ProductLandingPage.tsx:11` 的 `< 50ms Sync` 在产品文档和实现中没有对应测量证据；`:25-28` 的“极低延迟的毫秒级状态同步”和“绝非简单的单机播放器加聊天室”继续放大承诺；`AuthPage.tsx:189-192` 的“我们致力于满足音乐极客”是未完成句，`:196-198` 的“互利共赢的歌曲控制”不自然。

**为什么重要**：技术产品的信任来自可验证的状态和边界，不是更大的形容词。认证页则是第一次真正建立信任的地方，碎片化文案会让整体体验显得像生成内容。

**修复**：删除未经测量的 50ms 数字；把“实时同步”改成可验证的功能描述，性能数字只放进房间诊断并标明测量口径；重写认证页为短、完整、功能性的中文。

**建议命令**：`/impeccable clarify`、`/impeccable critique`

### [P1] 主工作区的多层固定 UI 需要一次移动端层级审计

**证据**：`RoomWorkspace.tsx:155-156` 为房间主区预留约 11rem 底部空间；`BottomPlayer.tsx:236` 在移动端固定紧凑播放器；`MobileAppNavigation.tsx:35` 固定 4.5rem 底部导航；`globals.css:410` 又为首页内容预留 12rem。

**为什么重要**：房间是产品核心，播放器和主导航同时常驻时，真正可见的舞台/曲库高度会显著缩短。任何未覆盖的滚动容器都可能被两层固定元素遮挡，尤其是歌词、列表尾部和对话框触发区。

**修复**：建立统一的 `--mobile-player-height`、`--mobile-nav-height`、safe-area offset；用同一套 bottom inset 驱动页面和 tabpanel；在 390x844、430x932 上逐个检查舞台、曲库、歌词、队列抽屉和对话框底部可达性。

**建议命令**：`/impeccable adapt`、`/impeccable audit`

### [P2] 营销页和认证页没有真正复用全局主题/字体 token

**证据**：`globals.css:1-90` 和 `tailwind.config.ts:10-12` 定义的是系统字体；`layout.tsx:27-30` 加载了 `Plus_Jakarta_Sans` 变量但 `font-sans` 没有使用它。`ProductLandingPage.tsx:235`、`AuthPage.tsx:179`、`:184`、`:214` 又直接写死黑底和白色层级；管理端 `admin.module.css:17`、`:241` 单独使用 Inter。

**为什么重要**：当前主界面、认证页、管理端像三个相邻但未完全对齐的产品。主题切换能力存在于全局，但营销/认证硬编码会让它无法成为真正共享的设计系统。

**修复**：决定“全产品始终暗色”还是“营销/认证也响应主题”，然后用 CSS token 贯彻；移除未使用的字体加载或让字体变量真正进入 `font-sans`，记录管理端是否是有意独立。

**建议命令**：`/impeccable extract`、`/impeccable typeset`

## Persona Red Flags

### First-timer

- 首屏 CTA 进入认证页后，左侧价值说明不完整，右侧按钮依赖异步安全验证配置；配置失败时用户需要先触发操作才看到明确下一步。
- “去注册”只是底部低对比度文本按钮，首次用户不容易确认这就是主要入口之一。

### Power user / host

- 房间同时承载播放舞台、曲库、我的歌单、成员和诊断，三项 tab 只是第一层；诊断字段和权限状态需要较多领域知识。
- 桌面侧栏、房间顶部设置、播放器队列和诊断面板的 z-index 分散在多个文件中，复杂操作时需要验证键盘焦点和 Escape 关闭路径。

### Mobile listener

- 播放器和底部导航同时固定，房间内容通过多处 padding 预留空间；在小屏上最重要的唱片、当前曲名和曲库尾部都需要真实滚动测试。
- 小字号的技术元数据和低透明度副文案适合氛围，但在户外或低质量屏幕上会降低扫描速度。

## Minor Observations

- `ProductLandingPage` 的长 feature body 和四张 architecture 卡片更像技术说明页，营销页可以把首屏后的信息压缩成 3 个可验证能力，再把架构移到独立文档。
- 主导航使用了六个同权重入口；“发现”与“歌单/收藏”在新用户心智中不是同一层级，移动端尤其需要确认是否真的都值得常驻。
- 手写 SVG 图标数量很多。仓库当前没有 lucide 依赖，因此不建议为了审查立刻引入新库；后续触碰导航时应统一图标来源和描边规格。
- `globals.css:340-343` 和 `:433-435` 的宽度/内边距动画是 detector 唯一较明确的性能类真问题，侧栏折叠时应避免不必要的布局重排。

## Questions to Consider

- 首屏真正要证明的是“实时同步能力”还是“房间里的听感和氛围”？现在两者都写了，但没有一个可验证的主证据。
- 如果把伪产品预览替换成真实只读 room surface，哪些信息必须保留，哪些只是装饰性的技术标签？
- 移动端常驻播放器和底部导航是否都需要同时存在，还是可以把其中一层收进沉浸式播放器？
- Music Room 是否要正式支持浅色主题？如果不支持，设置中的主题切换和全局浅色 token 是否应该收窄范围？

## Evidence Notes

- 本轮运行了 Impeccable detector，出口码为 2，共 13 个候选项，并逐条结合源码判定误报或低优先级。
- 使用本地 Playwright 对营销首页和认证页做了 1440x1000、390x844 的首屏检查；四个页面均无水平溢出。营销首页返回 200，认证页返回 200。
- 认证页在未启动后端时出现 `/v1/auth/me`、认证配置相关请求 404；这属于本地运行环境限制，不能替代生产联调结果。
- 项目首次直接启动 Next 时缺少 `apps/web/node_modules/next` 链接，改用 pnpm store 的 Next 包和 `NODE_PATH` 后才完成视觉检查；项目依赖安装状态应在 CI/开发文档中固定。
