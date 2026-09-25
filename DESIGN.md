# Music Room Design System

Last updated: `2026-09-24`

## Purpose

This document defines how Music Room looks and feels across the marketing landing page, responsive web workspace, desktop app, and mobile interfaces.

Music Room is not a generic streaming product. It is a real-time collaborative listening workspace for local and multi-source music. The UI feels like a hybrid of:

- a focused, low-distraction audio stage
- a precise collaboration console
- a high-contrast, technical audio dashboard

The product feels calm, exact, and immersive. Avoid playful consumer tropes and AI-generated decorative visual clutter.

## Core Design Mandate (Anti-AI-Slop & Restraint)

The UI must follow strict principles of restraint, clarity, and convention:

1. **Restrained, Conventional, and Minimalist by Default**:
   - Element sizing and spacing are derived from interface type, information density, platform conventions, and visual hierarchy. Never arbitrarily enlarge components.
   - Secondary actions, settings, toggles, and tool buttons must never fight for visual focus with primary playback controls.
2. **Universal Icon Metaphors**:
   - Core functions must use universally recognizable icons from established icon sets or platform standards (Lucide, system iconography). Never invent idiosyncratic glyphs just for false differentiation.
3. **Hierarchy via Structure over Noise**:
   - Express hierarchy through positioning, logical grouping, subtle contrast, hover interactions, tooltips, dividers, and discrete state feedback.
   - **Strictly eliminate**: exaggerated dimensions, heavy saturated color blocks, neon aura glows (`--accent-glow`), decorative radial gradient blobs (`blur-2xl/3xl`), artificial sparkles/starbursts, thick borders, heavy drop-shadows, and marketing-template layouts.
4. **Opaque & Contrast-First Overlays**:
   - Menus, dropdowns, dialogs, and popovers must use 100% solid, opaque surfaces (`bg-background-secondary border-surface-border`) to prevent text from blending into dynamic stage backgrounds or visualizers.
5. **Self-Auditing for Density**:
   - After implementing UI elements, compare them against adjacent screen elements. If anything feels loud, heavy, oversized, or dilutes information density, actively scale it down.

## Color Tokens

Default palette tokens:

| Token | Value | Usage |
| --- | --- | --- |
| `--background` | `#09090b` | global app background |
| `--background-secondary` | `#121215` | bottom player, opaque menus, dialog containers |
| `--foreground` | `#fafafa` | primary text |
| `--foreground-muted` | `#a1a1aa` | secondary text |
| `--surface` | `rgba(255,255,255,0.03)` | subtle elevated cards, list items |
| `--surface-hover` | `rgba(255,255,255,0.08)` | hover surfaces |
| `--surface-border` | `rgba(255,255,255,0.10)` | default crisp borders |
| `--accent` | `#0070f3` | active controls, playback progress, key signal |
| `--accent-hover` | `#3291ff` | hover state for accent actions |
| `--success` | `#4ade80` | connected/live states |
| `--warning` | `#facc15` | degraded link states |
| `--danger` | `#f87171` | destructive actions |

### Color Rules

- Keep the canvas deep black (`#09090b`).
- Use blue as a functional signal line, active edge, or playback indicator—never as a broad neon glow or background wash.
- Completely avoid decorative neon glows (`--accent-glow`), rainbow gradients, and saturated color washouts.
- Use green and yellow strictly for live diagnostics, link status, and state telemetry.

## Typography

### Font Roles

- Primary UI font: a modern neutral sans, optimized for dense interface reading.
- Secondary/system font: monospace for room codes, counters, connection state, timestamps, and diagnostics.

### Typographic Tone

- Headlines are bold, tight, and compressed in feeling.
- Body text is short, calm, and functional.
- Monospace labels should feel like instrumentation, not decoration.

### Rules

- Use strong contrast for page titles and current track names.
- Keep supporting copy at medium or low contrast.
- Avoid oversized paragraphs.
- Prefer concise Chinese UI copy with occasional English technical labels when useful.

## Layout Principles

### Primary Product Layout

The core room layout is a two-zone composition:

- Stage zone: current track, room identity, playback aura, room context
- Workspace zone: library, personal playlists, members, and diagnostics

The stage should dominate attention first. The workspace should feel structured and operational.

### Spatial Behavior

- Use large rounded corners on major containers.
- Keep generous outer spacing on desktop.
- Use sticky controls where continuity matters, especially top bars, tab bars, and the bottom player.
- Let the workspace panel feel like a raised dock attached to the stage.

### Density Strategy

- Marketing pages: cinematic, spacious, strong hierarchy
- Room stage: immersive, centered, minimal copy
- Library/personal-playlist/members panels: compact, readable, information-dense

## Component Guidance

### Top Bar

- Thin, understated, sticky, dark solid surface
- Clean, crisp logo mark without decorative glow
- Minimal action count; secondary controls must never fight with playback
- Announcement notification: minimal bell icon by default; unread items trigger a single-item marquee entering strictly from the container's rightmost edge (`100cqw`) across to the left

### Room Join Code

- Treat as a primary identity chip
- Use monospace, tracking, compact pill shape
- Include subtle live indicator or accent dot

### Vinyl / Playback Hero

- Central circular visual with realistic vinyl surface texture and mechanical tonearm
- Motion indicates active playback state (smooth rotational spin when playing, tonearm parked when stopped)
- Background scenery uses clean geometric soundwave vectors or concentric radio broadcast arcs—strictly without neon edge glows, blur auras, or floating particle sprites

### Menus, Dialogs & Overlays

- All action menus (e.g. room edit menu), dialog modals, and dropdowns use 100% solid, opaque surfaces (`bg-background-secondary border-surface-border`)
- Never use semi-transparent backdrops for interactive menus, ensuring high text contrast and zero bleed-through from underlying canvases

### Bottom Player

- Fixed global control rail
- Dense, stable, always available
- Progress line is a strong accent signal
- Mobile and desktop share identical control semantics and visual logic

### Tabs and Panels

- Tabs look like segmented controls, not browser tabs
- Active tab uses subtle fill and crisp contrast
- Panels use clean borders and opaque/semi-opaque neutral surfaces
- Lists must remain fast and comfortable to scan in low-light environments

### Queue Items

- Active item receives subtle accent tint and crisp foreground contrast
- Metadata remains compact
- Controls appear deliberate and lightweight; reordering feels tool-like

### Diagnostics

- Diagnostics are a first-class product surface
- Present health, transport, and media state with calm hierarchy
- Use color strictly for status/severity, never for decoration
- Monospace instrumentation for states, timestamps, and packet metrics

### Empty States

- Keep them quiet, uncluttered, and directional
- Focus on the immediate next action: import audio, add to queue, join room
- Avoid marketing illustrations; prefer clean system iconography

## Motion

### General Motion Rules

- Motion must serve playback, transition, and system feedback.
- Animations must be smooth, brief, and deliberate.
- Prefer linear progress transitions, crisp opacity fades, and container-query marquee scrolls.
- Avoid bounce-heavy, gamified, overly elastic, or decorative pulsing motion.

### Approved Motion Patterns

- Smooth vinyl rotation while playing (mechanical feedback)
- Container-query single-item loop marquee for notifications (`@keyframes announcement-marquee-single`)
- Subtle fade-in for overlays and lazy-loaded panels
- Linear progress transitions for playback time scrubbers

## Responsive Behavior

### Desktop

- Preserve the stage/workspace split
- Stage remains visually dominant
- Bottom player remains fixed and low-profile

### Mobile

- Stack the stage above the workspace
- Keep the stage emotionally strong even when compact
- Use sticky tab bars and sticky player controls
- Do not let diagnostic density destroy readability

## Copy Tone

- Clear, direct, low-friction
- Product voice is confident and quiet
- Avoid hype language, jokes, or anthropomorphic AI phrasing
- Prefer operational wording such as:
  - `正在连接实时音频`
  - `已复制房间码`
  - `等待当前音源开始播放`
  - `等待当前音源开始播放`

## Page-Specific Guidance

### Marketing Homepage

- Present Music Room as a focused infrastructure-like product for collaborative listening
- Hero should communicate synchronization, local music, and room-based collaboration
- Visuals should resemble an operating environment, not a generic SaaS landing page

### Auth Page

- Minimal, centered, quiet
- Clear distinction between sign-in and entry into the workspace
- No loud marketing decoration

### Room Page

- This is the flagship experience
- Current track, playback status, and room identity must be visible immediately
- Queue and diagnostics should feel one click away, not buried

### Rooms List / Lobby

- Emphasize room visibility, online count, host, and join affordance
- Cards should feel operational and quick to scan

### Room Directory Themes

- Directory cards may use a room-format accent to make interactive, request, and radio rooms distinguishable at a glance.
- These accents are scoped to the card frame, stage, primary action, and signal graphic; they do not replace electric blue as the global product accent.
- Online presence continues to use the shared success color, and each card displays the online count only once in its top-right status.
- Directory stages use abstract interface compositions rather than stock photography or invented member and track data.

## Do

- Keep backgrounds deep black with subtle structure
- Use accent blue to guide focus
- Let playback status feel alive through light and motion
- Design diagnostics with the same care as primary music features
- Maintain one coherent visual language across marketing and app surfaces

## Do Not

- Do not introduce bright multi-color gradients as a default motif
- Do not overfill layouts with badges, pills, and decorative micro-panels
- Do not make the room workspace feel like a generic dashboard template
- Do not make marketing pages look more playful than the product itself
- Do not bury the current playback state behind dense controls

## AI Implementation Notes

When generating or refactoring UI for Music Room:

- Default to restraint, convention, and high information density
- Start from a solid black canvas (`#09090b`) with crisp, subtle borders
- Secondary actions, settings, and toggles must not compete with the primary playback canvas
- Never generate artificial AI decor: no neon glow aura filters, no 4-point sparkle badges, no radial blurred rainbow bubbles, no fake Mac buttons, and no novelty CSS physics toys
- All interactive menus and modal overlays must be 100% opaque (`bg-background-secondary border-surface-border`)
- Use universally standard icons from mature libraries (e.g. Lucide) with clear metaphorical semantics
- Audit new components against existing UI: if an element feels loud, oversized, or dilutes information density, actively scale it down

