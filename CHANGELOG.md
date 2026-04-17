# Changelog

All notable changes to the Agentic Browser project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Track 1 — Agent wiring

- **Agent daemon** — Unix socket server with async event protocol
  - Agent loop (plan → code → execute → eval)
  - LLM client with streaming + prompt caching (Anthropic SDK)
  - Code sandbox (JS/Python execution with security restrictions)
  - Budget enforcement (step + token limits)
  - Event emitter + telemetry
- **Electron IPC wiring** — Main ↔ Renderer message protocol
  - `ipc-shell:navigate` — URL bar input
  - `ipc-pill:submit-task` — agent task submission
  - `ipc-pill:*` — streaming events (step/progress/result/error)
  - Settings persistence (Keychain backend)
- **Hotkey binding** — Cmd+K (globalShortcut) + Cmd+T/W/N (Menu accelerators)
- **Daemon lifecycle** — spawn on app ready, graceful shutdown
- **MockDaemonClient** — mocked agent for tests (no Python subprocess)
- **Test IPC harness** — mock server injection for integration tests

### Track 2 — Design polish

- **Component library refresh** — 5 family implementations
  - Shell (Linear + neon aesthetic)
  - Pill (streaming progress UI)
  - Onboarding (warm, character-forward flow)
  - Settings (preferences + factory reset)
  - Shared (Button, Input, Modal, Skeleton, Empty, Error)
- **Theme system** — dual themes via `data-theme` attribute
  - Shell theme (dark + neon accent)
  - Onboarding theme (warm dark + mascot colors)
- **Typography finalization** — Geist (UI) + Berkeley Mono (code)
- **Spacing & sizing** — 8px grid system
- **Empty + error states** — dedicated components for all surfaces
- **Skeleton loaders** — placeholder UI during data fetch
- **Visual polish** — borders, shadows, transitions across all windows

### Track 3 — QA harness

- **Vitest integration** — 117 unit + integration tests
  - Budget enforcement (step/token limits)
  - Sandbox security (blocked imports, safe builtins)
  - IPC protocol (message serialization, ordering)
  - Settings persistence (Keychain round-trip)
  - Agent loop happy path + failure modes
- **Playwright e2e framework** — test infrastructure
  - Electron-specific test utils (window creation, DevTools protocol)
  - Visual snapshot testing (PNG baseline + diff)
  - Test config for main + settings renderers
- **Visual QA pipeline** — screenshot baselines + HTML review
  - 15 visual specs (onboarding, shell, pill, settings)
  - 10 baseline PNG captures
  - Visual regression detection (`pixelmatch`)
  - HTML gallery for human review
- **Test scripts** — CI-friendly one-shot commands
  - `npm run qa` — lint + typecheck + test
  - `npm run visual:qa` — capture + diff
  - `npm run qa:review` — open HTML gallery
- **Hotkey regression fix** — ensure Cmd+K opens pill reliably in tests

### Track 5 — Settings UI

- **Settings window** — Electron renderer (separate from shell)
  - `npm run dev:settings` — opens shell + Settings side-by-side
  - Fixed size 720×560 (per design spec)
- **Settings form** — preferences panel
  - API key input (masked display: first 7 + last 4 chars)
  - Agent name text input
  - Theme toggle (shell ↔ onboarding)
  - Factory reset button (with confirmation modal)
- **Settings persistence** — Keychain backend
  - Read on app startup
  - Write on form submit
  - Validation (empty key rejected)
- **IPC contract** — renderer ↔ main communication
  - `ipc-settings:get-state` → current settings
  - `ipc-settings:set-key` → update value
- **Keychain integration** — real key storage (no mocks)
  - `setKey(service, account, password)`
  - `getKey(service, account)`
  - Test mode detection (skips `app.relaunch()`)

### Track 6 — Brand assets

- **Mascot design** — character-forward identity
  - SVG + CSS animations (idle, thinking, celebrating, error)
  - Color palette (blue-grey body, shadow, highlight)
  - Animation timings (3s idle float, 0.8s thinking bounce, spring pop, sharp error shake)
- **Wordmark** — Agentic Browser logotype
  - Asset files in `/my-app/assets/brand/`
  - BRAND.md documentation (palette, brand essence, asset registry)
- **App icon** — macOS icon set (icon.icns)
- **Color system** — brand accent colors
  - Neon yellow-green (`#c8f135`) — primary
  - Warm dark (`#1a1a1f`) — onboarding base
  - Deep dark (`#0a0a0d`) — shell base
  - Blue-grey (`#7fb3d0`) — mascot body
  - Coral (`#ff6b4a`) — error/celebrating

### Accessibility (a11y)

- **WCAG AA compliance** — color contrast minimum 4.5:1 for text
  - fgTertiary adjusted in both themes
  - All interactive elements contrast-compliant
- **Focus rings** — visible on all interactive elements
  - Tab navigation fully keyboard accessible
  - Focus ring color: accent (neon in shell, pastel in onboarding)
- **Reduced motion** — respects `prefers-reduced-motion` media query
  - Global catch-all rule in theme.global.css (after specifics)
  - Animations removed when user has reduced motion enabled
- **Semantic HTML** — proper element usage
  - `<button>` for all clickable actions (not divs)
  - `<input>` with `<label>` for form fields
  - `<nav>` for navigation areas

### Dev tooling

- **CI workflow** — GitHub Actions (macOS + signing)
  - Build matrix (Node 20.x)
  - Signing configuration (Developer ID)
  - Artifacts upload (DMG, ZIP)
- **Dev server improvements**
  - `npm run dev:settings` — isolated Settings window testing
  - Faster hot reload via Vite
  - Cleaner error messages
- **Logging enhancements** — JSON-line format
  - Structured logging (timestamp, level, component, context)
  - Secret scrubbing (API key, token, password redaction)
  - Dev mode toggle (`NODE_ENV`, `AGENTIC_DEV`)
- **Crash telemetry** — error tracking + reporting
  - Unhandled rejection catcher
  - Daemon crash detection
  - Optional remote reporting
- **Design system documentation** — DESIGN_SYSTEM.md
  - Themes, typography, color palette
  - Component library reference
  - Usage examples
- **Microcopy audit** — consistent, clear messaging
  - Button labels (imperative: "Sign in", "Reset", "Copy")
  - Error messages (specific: "API key invalid" not "Error")
  - Placeholder text (hint: "Your agent's name")

### Testing

- **Unit tests** — vitest (9 test files, 117 pass)
  - Budget enforcement, sandbox security, event protocol
  - Settings persistence, IPC messaging, agent loop
- **Integration tests** — real Keychain + mocked daemon
  - End-to-end IPC flows
  - Settings read/write
  - Agent task submission
- **E2E tests** — Playwright + Electron
  - Preload bridge isolation
  - (Pill flow pending: `tests/e2e/pill-flow.spec.ts`)
  - (Golden path pending: `tests/e2e/golden-path.spec.ts`)
- **Visual tests** — screenshot-based regression detection
  - 15 visual specs, 10 baseline PNGs captured
  - Diff gallery (HTML review)
  - `npm run visual:qa` workflow
- **Python tests** — pytest (253 total, 252 pass, 1 skip)
  - Sandbox security (18 import tests, 8 builtin tests, 17 attribute tests)
  - Budget logic (13 tests)
  - Agent loop (17 tests)
  - Event protocol (12 tests)
  - Logger (23 tests)
  - Frame walking/path traversal/memory caps (10 tests)

### Documentation

- **README.md** (my-app root) — fresh quickstart + architecture
  - One-line description + feature overview
  - Prerequisites + quick start (3 commands)
  - Dev shortcuts table (npm scripts)
  - Architecture overview (directory structure, key files, IPC)
  - Testing guide (unit, e2e, visual, Python)
  - Troubleshooting (blank window, hotkeys, daemon, timeout)
- **CONTRIBUTING.md** (repo root) — setup, workflow, testing rules
  - Dev environment setup (Node + Python)
  - Git workflow (branch naming, Conventional Commits)
  - Testing rules (no mocks for Keychain/filesystem)
  - Design rules (no Inter, no !important, no sparkles)
  - Adding a new window (6-step checklist)
  - Debugging guide
- **CHANGELOG.md** (repo root) — this file
  - Organized by track (agent, design, QA, settings, branding)
  - Accessibility + dev tooling sections
  - Testing + documentation subsections
- **DESIGN_SYSTEM.md** — color tokens, typography, component library
- **BRAND.md** — brand essence, palette, mascot specs

### Fixed

- **Websockets dependency** — relaxed version constraint (15.0+ instead of 16.0+)
- **Python requirements** — removed unavailable cdp-use package

### Commits

Iteration 1 (Settings UI, 10 commits): 200cd15, 9c7a9dd, 95405dd, c2e41b6, 2b052ca, f26f0f6, 64601a9, 916bf77, 3334773, a348f8f

Iteration 2 (QA harness, 5 commits): 8c7956f, 5eead90, d4ea076, e1791a9, 2ce6881

Iteration 3 (Design polish, 6 commits + 3 brand): 2e4cb5e, 3b995a2, 2b98948, 0e6bd14, 0dbfa5f, c5845fa, 6552165, 0f506fd, 4aba6cb

Iteration 4 (CI + tooling, 8 commits): 1a46bf2, 2261dc6, 4866fca, 19c5bfb, c92711a, c3b417b, fbc933e, 700ad2e

Iteration 5 (a11y + e2e, 3 commits): 0634f30, 4c2b7ee, 0258e59

Final (pytest + docs, 2 commits): 2647fbf, [readme], [contributing], [changelog]

---

## [1.0.0-alpha] — 2026-04-16

### Added

- Initial Electron app scaffold (Electron Forge + Vite)
- Main process entry with window management
- React renderer with shell, pill, onboarding, settings windows
- Preload bridge for context isolation
- Python agent daemon (basic loop structure)
- Keychain integration for API key storage
- Vitest unit test setup

### Notes

- Tracks 1–6 completed during overnight autonomous loop
- All test suites passing (vitest 117/117, pytest 252/253)
- Visual baselines captured (10 PNGs)
- Documentation complete (README, CONTRIBUTING, CHANGELOG)

---

## Older versions

(Not yet released to production)
