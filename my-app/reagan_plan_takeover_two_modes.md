# Takeover Overlay — Two-Mode Simplification

## Goal
Always show the takeover overlay while the session is running. Switch its appearance based on whether a real browser navigation has happened.

- **`idle` mode** — no `primarySite`. Plain "Browser not started yet" text. No glow, no button. Intentionally ambiguous: covers both chat-only tasks and browser tasks still warming up.
- **`active` mode** — `primarySite` set. Current pulsing cyan glow + hover reveals "Stop and take over".

## Why
Current behaviour hides the overlay entirely until `primarySite` lands, leaving a blank gray screen while Chromium boots a real browser task. Always-on overlay with a simple label covers that window. The user has explicitly accepted the ambiguity.

## Design

### Transport
Keep one IPC channel: `takeover:show(id, bounds, mode)`. Main forwards `mode` to the overlay's webContents via `webContents.send('takeover:mode', mode)`. The HTML script listens and sets `body.dataset.mode`. CSS branches on `[data-mode="idle" | "active"]`.

Main caches the most-recent mode per session so re-attach / reload applies the right visual without a round-trip.

### Visuals
- Default CSS (no mode attr or `active`): current pulsing glow, chip, hover button.
- `body[data-mode="idle"]`:
  - Hide glow, chip, scrim, button.
  - Show centered muted label "Browser not started yet".
- Transition between modes is a simple opacity fade.

### Renderer changes (`AgentPane.tsx`)
- Drop `primarySite`-based gate on the show call.
- Drop the 800ms retry timer — always-on while running means first show + every resize is enough.
- `api.takeover.show(session.id, bounds, primarySite ? 'active' : 'idle')` on attach success + every resize while running.

### Main changes (`takeoverOverlay.ts`)
- `show(sessionId, window, bounds, mode)` — create if absent, attach, setBounds, send mode.
- Store `currentMode` in OverlayEntry; on did-finish-load send cached mode.
- `hide` unchanged.

### Preload / types
- Extend `takeover.show` signature to accept `mode: 'idle' | 'active'`.

## Edge cases
- Overlay created while overlay's webContents hasn't loaded yet: cache mode, replay on `did-finish-load`.
- primarySite transitions null → domain: new `show` call with `mode='active'` repaints the same overlay without tearing it down.
- Status running → idle: renderer's existing status-change effect still fires `takeover.hide`.
- Session cancelled from within overlay: button only exists in active mode; no-op in idle mode.

## Non-goals
- Heuristic detection of browser intent from tool calls or user message (user said ambiguity is fine).
- Animated transitions between modes beyond CSS opacity.
