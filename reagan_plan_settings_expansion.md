# Settings Window Expansion Plan

Goal: surface settings that are currently persisted but hidden from the Settings window.

## Scope ranked by value vs effort

### 1. OpenAI/Codex API key management (High value, Med effort)
- `saveOpenAIKey` / `loadOpenAIKey` / `deleteOpenAIKey` already exist in `authStore.ts`.
- Missing: IPC handler, preload surface, UI card in `ConnectionsPane.tsx`.
- Need a "Test key" round-trip similar to Anthropic (`apiKeyIpc.ts`).

### 2. Codex sign-in status card (High value, Low effort)
- Adapter already exposes `checkInstalled()`/auth check reading `~/.codex/auth.json`.
- Add a read-only card: "Codex: signed in / not signed in / not installed" with a
  "Sign in" button that invokes the existing `codex login` Terminal flow.

### 3. Auth-mode explicit toggle (Med value, Low effort)
- Today the mode flips implicitly when you save an API key vs OAuth.
- Add a segmented control ("Use Claude subscription" / "Use API key") when both
  credentials exist. Calls `setAuthMode` via new IPC.

### 4. Zoom + view-mode preferences (Low value, Low effort)
- Currently only reachable via Cmd+=/Cmd+- (removed) and grid toggle.
- Add a "Display" section: zoom slider (0.8–1.4) + "Default view" radio (grid/list).
- Reads/writes `localStorage` `hub-zoom-factor` and `hub-view-mode`.

### 5. Env-var override indicator (Low value, Low effort)
- Show a badge when `ANTHROPIC_API_KEY` / `CODEX_API_KEY` / `CODEX_HOME` are set
  in the process env, since they silently override UI choices.
- Main-process IPC returning `{ anthropic: bool, codexApiKey: bool, codexHome: bool }`.

## Suggested order
Ship in this order, each as its own commit:
1. OpenAI key card (parity with Anthropic).
2. Codex sign-in status card.
3. Env-var override badges (small, protects against confusion in #1–2).
4. Auth-mode toggle.
5. Display/zoom section.

## Files to touch (per feature)

**OpenAI key (#1):**
- `my-app/src/main/settings/apiKeyIpc.ts` — add `openaiApiKey:*` handlers.
- `my-app/src/preload/shell.ts` — expose `electronAPI.settings.openaiApiKey`.
- `my-app/src/renderer/hub/ConnectionsPane.tsx` — second card mirroring Anthropic.
- `openai-logo.svg` already present.

**Codex status (#2):**
- `apiKeyIpc.ts` or new `codexIpc.ts` — `codex.status()`, `codex.signIn()`.
- Reuse `codexAdapter.checkInstalled()` / auth-file read.
- Card in `ConnectionsPane.tsx`.

**Env-var indicator (#3):**
- `apiKeyIpc.ts` — `env.overrides()` returning booleans only (never values).
- Small inline `<span>` on each credential card.

**Auth-mode (#4):**
- `apiKeyIpc.ts` — `authMode.get/set` (wraps existing `getAuthMode`/`setAuthMode`).
- Segmented control inside the Anthropic card when both creds present.

**Display (#5):**
- `SettingsPane.tsx` — new "Display" section, pure renderer, no IPC.

## Open questions for Reagan
- Should the OpenAI key be used anywhere today, or just stored for future Codex API mode? (Answer shapes whether we add a "Test" round-trip or just save.)
- Do we want Codex sign-in to also support API key mode? Current adapter prefers OAuth via `~/.codex/auth.json`.
- Should env-var overrides block UI edits, or just warn?
