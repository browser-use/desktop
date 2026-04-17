# Brand System — Agentic Browser

**Version:** 1.0  
**Date:** 2026-04-17  
**Owner:** Track 6 — Branding + Custom Assets

---

## 1. Brand Essence

Agentic Browser is a companion, not a tool. The visual system reflects that duality:
- The **shell** is precise, dense, keyboard-first — a workspace that gets out of your way (Linear aesthetic)
- The **onboarding + mascot** is warm, rounded, character-forward — an introduction to a creature that works with you

The ONE memorable thing: **the mascot is the emotional anchor**. Every other design decision orbits it.

---

## 2. Palette

### Shell Palette (dark, clinical)

| Token | Value | Usage |
|---|---|---|
| `--color-bg` | `#0a0a0d` | Base background |
| `--color-surface` | `#111114` | Cards, elevated surfaces |
| `--color-border` | `#1e1e24` | Subtle dividers |
| `--color-accent` | `#c8f135` | Neon yellow-green — single sharp accent |
| `--color-accent-glow` | `rgba(200,241,53,0.18)` | Glow behind accent elements |
| `--color-fg-primary` | `#f0f0f2` | Primary text |
| `--color-fg-secondary` | `#8a8f98` | Secondary text |

### Onboarding Palette (warm, character-forward)

| Token | Value | Usage |
|---|---|---|
| `--color-bg-base` | `#1a1a1f` | Warm near-black |
| `--color-mascot-body` | `#7fb3d0` | Character body — blue-grey |
| `--color-mascot-shadow` | `#5a9abf` | Undershadow |
| `--color-mascot-highlight` | `#b0d4e8` | Sheen/highlight |

### Brand Accent Colors (hero/marketing moments only)

| Name | Value | Usage |
|---|---|---|
| `BRAND_NEON` | `#c8f135` | Primary — neon yellow-green |
| `BRAND_WARM_DARK` | `#1a1a1f` | Onboarding base |
| `BRAND_DEEP_DARK` | `#0a0a0d` | Shell base |
| `BRAND_BLUE_GRAY` | `#7fb3d0` | Mascot body |
| `BRAND_CORAL` | `#ff6b4a` | Error/celebrating accent |
| `BRAND_SLATE` | `#8a8f98` | Subdued secondary |

---

## 3. Typography

### System Fonts (UI)
- **Shell UI:** `'Geist', 'SF Pro Display', system-ui, sans-serif`
- **Monospace:** `'JetBrains Mono', 'SF Mono', ui-monospace, monospace`

### Brand/Hero Font
- **Instrument Serif** — used exclusively for:
  - Onboarding headlines ("I'm your Companion!")
  - Wordmark logotype
  - Hero marketing copy
  - NOT used for UI controls, labels, or body text

**Rationale:** Instrument Serif is editorial, warm, and unexpected. It contrasts sharply with the clinical Geist of the shell, reinforcing the duality. It reads as human-crafted — perfect for a companion introduction.

### Type Scale for Brand Moments

| Role | Font | Size | Weight | Usage |
|---|---|---|---|---|
| Hero headline | Instrument Serif | 38–48px | 400 | Onboarding "I'm your Companion!" |
| Sub-headline | Instrument Serif | 24px | 400 | Step titles in onboarding |
| UI body | Geist | 13–15px | 400/500 | All controls + shell chrome |
| Mono | JetBrains Mono | 12px | 400 | URLs, code, CDP identifiers |

---

## 4. Iconography Rules

1. **No sparkles** (✨, 💫, ⭐ variants) — the brand communicates through the mascot, not generic positivity icons
2. **No filled icons unless semantic** — prefer stroked icons at 1.5px stroke weight
3. **Stroke caps:** `round` — consistent with the mascot's rounded character
4. **Icon sizes:** 12px (compact), 16px (default), 20px (feature icon), 24px (empty states)
5. **Color:** icons inherit `currentColor` — they adapt to their context (fg-secondary default, accent on hover/active)
6. **Custom glyphs:** see `glyphs/sprite.svg` for the brand-voice icon set

---

## 5. Motion Principles

### Principles
1. **Motion serves purpose** — no animation for its own sake; every motion communicates state
2. **Fast in, slow out** — enter animations are quick (80–150ms), exit/transitions are deliberate (220ms)
3. **One easing rule:** `cubic-bezier(0.2, 0, 0, 1)` for standard transitions, `cubic-bezier(0.34, 1.56, 0.64, 1)` for spring/delight moments
4. **High-impact moments:** page load, agent thinking, task completion — these get the most attention
5. **Reduced motion respected:** all SMIL animations + CSS `@keyframes` check `prefers-reduced-motion`

### Key Animations
- **Mascot idle float:** 3s ease-in-out infinite sinusoidal float (4px vertical range)
- **Agent thinking:** rotating dots that phase-shift based on step index, not generic spinners
- **Task progress orb:** organic swirl driven by progress %, handwritten SVG path math
- **CDP pulse:** heartbeat interval tied to actual daemon health check interval

---

## 6. Component Token References

All brand-aware components import from `src/renderer/design/tokens.ts`.  
The following constants are brand-specific additions:

```ts
BRAND_COLORS     — palette for hero/marketing moments (not UI)
BRAND_FONTS      — font stacks for hero/brand moments
BRAND_MOTION     — motion constants for brand animations
```

Do not use `BRAND_*` tokens for shell UI — those use `SHELL_COLORS` + `ONBOARDING_COLORS`.

---

## 7. App Icon

- **Source:** `icons/app-icon-1024.svg` — 1024×1024 SVG
- **Compiled:** `icons/app-icon.icns` — macOS icon bundle (via `iconutil`)
- **Design:** The mascot's face (blue-grey rounded square, eyes, smile) centered on a warm-dark `#1a1a1f` background with a subtle neon `#c8f135` accent ring
- **Rationale:** Recognizable at 16px (just two eyes), distinctive at 512px (full character face)

---

## 8. Diagrams

All architectural + UX diagrams are hand-authored SVGs. No mermaid renderer, no react-flow.

| File | Description |
|---|---|
| `diagrams/agent-flow.svg` | Daemon → CDP → Tab relationship |
| `diagrams/cdp-bridge.svg` | Main process ↔ daemon Unix socket bridge |
| `diagrams/pill-states.svg` | Pill state machine (idle → streaming → done/error) |

---

## 9. Mascot Poses

| Pose | File | Usage |
|---|---|---|
| `idle` | `mascot/mascot-idle.svg` | Default state, gentle float animation |
| `thinking` | `mascot/mascot-thinking.svg` | Agent task running, thinking bubble |
| `celebrating` | `mascot/mascot-celebrating.svg` | Task complete, arms raised |
| `error` | `mascot/mascot-error.svg` | Task failed, concern expression |
| `offline` | `mascot/mascot-offline.svg` | Daemon unavailable, sleeping |

Used via `<Mascot pose="thinking" />` React component.
