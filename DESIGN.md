# Music Room Design System

Last updated: `2026-07-23`

## Purpose

This document defines how Music Room should look and feel across the marketing site and the web workspace.

Music Room is not a generic streaming product. It is a real-time collaborative listening workspace for local music. The UI should feel like a hybrid of:

- a focused music stage
- a precise collaboration console
- a low-light technical dashboard

The product should feel calm, exact, and immersive. Avoid playful consumer music-app tropes.

## Brand Core

### Product Keywords

- synchronized
- collaborative
- immersive
- precise
- low-latency
- local-first
- technical but not cold

### Emotional Direction

- The room should feel dark and spatial, like a shared late-night listening booth.
- Controls should feel reliable and deliberate, not noisy or decorative.
- Technical status should feel legible and trustworthy, not intimidating.
- Playback should remain the visual center of gravity.

## Visual Identity

### Overall Look

- Base theme is near-black, not gray-heavy.
- Surfaces are translucent or softly elevated, with thin white borders and restrained blur.
- Accent color is a sharp electric blue used as signal, not as a wash.
- Bright color appears mainly in playback progress, active states, join code indicators, and system emphasis.
- The interface should feel clean and premium, with a subtle cyber-acoustic mood.

### Things This UI Is Not

- Not skeuomorphic hi-fi hardware.
- Not neon hacker RGB overload.
- Not a cheerful social app.
- Not a playlist-first streaming catalog.
- Not a dense enterprise admin dashboard.

## Color Tokens

Use these as the default palette.

| Token | Value | Usage |
| --- | --- | --- |
| `--background` | `#09090b` | global app background |
| `--background-secondary` | `#121215` | bottom player, stronger containers |
| `--foreground` | `#fafafa` | primary text |
| `--foreground-muted` | `#a1a1aa` | secondary text |
| `--surface` | `rgba(255,255,255,0.03)` | glass cards, overlays |
| `--surface-hover` | `rgba(255,255,255,0.08)` | hover surfaces |
| `--surface-border` | `rgba(255,255,255,0.10)` | default borders |
| `--accent` | `#0070f3` | active controls, progress, key emphasis |
| `--accent-hover` | `#3291ff` | hover state for accent actions |
| `--accent-glow` | `rgba(0,112,243,0.5)` | glows, aura, focus signal |
| `--success` | `#4ade80` | connected/live states |
| `--warning` | `#facc15` | degraded link states |
| `--danger` | `#f87171` | destructive actions |

### Color Rules

- Keep the canvas predominantly black.
- Use blue as a signal line, pulse, glow, or active edge.
- Prefer opacity and blur over solid gray blocks.
- Use green and yellow sparingly for diagnostics only.
- Avoid large purple gradients and rainbow visual noise.

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

- Thin, understated, sticky, translucent black
- Small logo mark with accent glow
- Minimal action count
- Should never compete with playback content

### Room Join Code

- Treat as a primary identity chip
- Use monospace, tracking, compact pill shape
- Include subtle live indicator or accent dot

### Vinyl / Playback Hero

- Central circular visual with aura and restrained motion
- Motion should imply active playback, not become a novelty animation
- Use concentric rings, soft conic highlight, and accent glow
- The center object should feel tactile but abstract

### Bottom Player

- Fixed global control rail
- Dense, stable, always available
- Progress line is a strong accent signal
- Mobile and desktop should share the same visual logic, not diverge into separate styles

### Tabs and Panels

- Tabs should look like segmented controls, not browser tabs
- Active tab uses subtle fill and strong text contrast
- Panels use soft borders and glass-like surfaces
- Lists should be easy to scan in low light

### Queue Items

- Active item receives accent tint and clearer contrast
- Metadata remains compact
- Controls should appear deliberate and lightweight
- Reordering should feel tool-like, not playful

### Diagnostics

- Diagnostics are a first-class product surface
- Present health, transport, and media state with calm hierarchy
- Use color for severity, not decoration
- Monospace is encouraged for states, timestamps, and event streams

### Empty States

- Keep them quiet and directional
- Focus on the next action: import audio, add to queue, join room, unlock audio
- Avoid illustrations unless they support the same dark technical language

## Motion

### General Motion Rules

- Motion should support playback, transition, and system feedback.
- Animations must be smooth, brief, and deliberate.
- Prefer fades, slides, glow shifts, and slow rotation.
- Avoid bounce-heavy, gamified, or overly elastic motion.

### Approved Motion Patterns

- slow vinyl rotation while playing
- soft aura pulsing around active playback
- fade-in for overlays and lazy-loaded panels
- short slide-up for first-render surfaces
- linear progress transitions for playback

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

When generating UI for Music Room:

- start from a black canvas
- use glass panels and thin borders
- preserve the stage-versus-workspace composition
- keep the playback surface visually central
- use monospace for system detail and room identity
- prefer electric blue as the single primary accent
- keep diagnostic UI readable, compact, and technically credible
- avoid adding unrelated product areas such as discovery feeds, charts, social reactions, or recommendation carousels

If the requested screen is new, it should still feel like it belongs next to:

- the dark landing page
- the room stage with the vinyl hero
- the bottom playback rail
- the library/personal-playlist/members workspace
