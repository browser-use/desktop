# Agent Local Runbook

Use this when a coding agent needs to run Browser Use Desktop locally,
inspect task state, or debug app-spawned agent sessions.

## Local Commands

- Start the app from the repo root: `task up`
- Start against this branch's isolated profile: `task worktree:up`
- Print this branch's profile path: `task worktree:profile:path`
- Clean this branch's isolated profile: `task worktree:profile:clean FORCE=1`
- Copy `sessions.db` into this branch profile: `task db:worktree:copy FROM=default`
- Diagnose the copied DB schema: `task db:worktree:doctor`
- Start with a clean Vite cache: `task up:clean`
- Submit a task to a running app: `task agent:run PROMPT="open example.com and report the title" ENGINE=codex`
- Run checks: `task lint`, `task typecheck`, `cd app && npm run test`
- Reset local onboarding after quitting the app: `task reset:onboarding`
- Reset persisted sessions after quitting the app: `task reset:sessions`

For isolated manual testing, launch with a throwaway profile:

```bash
AGB_USER_DATA_DIR="$(mktemp -d)" task up
```

`--user-data-dir=<path>` overrides `AGB_USER_DATA_DIR`. The app logs the
resolved user data path and CDP port in `main.startup`.

For branch/worktree-local development, prefer the repo-owned profile path:

```bash
task db:worktree:copy FROM=default
task worktree:up
AGB_USER_DATA_DIR="$(task worktree:profile:path)" task agent:run \
  PROMPT="open example.com and report the title" ENGINE=codex
```

`task db:worktree:copy` copies only `sessions.db` plus WAL/SHM companions into
the current branch profile, then runs the schema doctor. Use `FROM=branch:<name>`
to copy from another branch profile, including branch names with `/`. Use an
absolute path, `./relative/path`, `~/path`, or `FROM=path:<path>` for explicit
filesystem paths. Quit the app before copying; pass `FORCE=1` only when
replacing an existing target DB is intentional.

## Runtime State

Default Electron `userData` locations:

- macOS: `~/Library/Application Support/Browser Use`
- Windows: `%APPDATA%\Browser Use`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/Browser Use`

Important files under `userData`:

- `sessions.db` - SQLite session store. Main tables are `sessions`,
  `session_events`, and `session_attachments`.
- Session schema changes are guarded by `DB_SCHEMA_VERSION` plus
  `src/main/sessions/schema-manifest.json`. Run `task db:schema:check` after
  intentional session schema edits, and `task db:schema:update` when a migration
  intentionally changes the fresh database schema.
- `sessions.db-wal` / `sessions.db-shm` - WAL files. Do not delete or edit
  them while the app is running.
- `logs/` - JSONL logs. Core channels are `main.log`, `browser.log`,
  `renderer.log`, and `engine.log`.
- `account.json` - onboarding/account completion state, not API credentials.
- `harness/` - runtime harness given to app-spawned agents. It contains
  `AGENTS.md`, `helpers.js`, `uploads/<session_id>/`, and
  `outputs/<session_id>/`.
- `local-task-server.json` - loopback control endpoint for `task agent:run`.
  Treat the bearer token in this file like a local secret; do not print it.
- `whatsapp-auth/` - WhatsApp channel auth state.

Useful inspection commands:

```bash
task logs:all
task logs:main
task logs:browser
task logs:renderer
task logs:engine
task logs:session SESSION_ID=<session-id>
sqlite3 "$HOME/Library/Application Support/Browser Use/sessions.db" ".tables"
sqlite3 "$HOME/Library/Application Support/Browser Use/sessions.db" \
  "select id,status,engine,auth_mode,subscription_type,datetime(created_at/1000,'unixepoch') from sessions order by created_at desc limit 10;"
sqlite3 "$HOME/Library/Application Support/Browser Use/sessions.db" \
  "select seq,type,substr(payload,1,240) from session_events where session_id='<session-id>' order by seq;"
```

Prefer read-only SQLite queries while the app is running.

## Running App Tasks

Use the first-class local task runner when the app is already running:

```bash
task agent:run PROMPT="open example.com and report the title" ENGINE=codex
task agent:run PROMPT="open example.com and report the title" ENGINE=codex JSON=1
```

This reads `<userData>/local-task-server.json` and submits through the
loopback control endpoint exposed by the running Electron app. The endpoint
calls the same main-process session pipeline as `sessions:create` and
`sessions:start`.
If the app was started with `AGB_USER_DATA_DIR`, run `task agent:run` with the
same environment variable so the script reads the matching control file.

Other supported ways to start a task locally:

- Use the app UI: start the app with `task up`, open the command bar/new-agent
  control, submit the prompt, then inspect logs and `sessions.db`.
- Use the renderer preload API from an Electron/Playwright test or an attached
  renderer context:

```ts
const id = await window.electronAPI.sessions.create({
  prompt: "open example.com and report the title",
  engine: "codex",
});
await window.electronAPI.sessions.start(id);
```

The same API accepts a plain prompt string, but the object form lets you pin
`engine` and pass attachments. Use `sessions.resume(id, prompt)` for follow-up
turns after a session becomes idle.

Do not create rows directly in `sessions.db`; that bypasses BrowserPool, auth
resolution, event streaming, and engine spawning.

## Credentials

Do not print, paste, or commit raw credential values. Check presence/status
unless a task explicitly requires changing auth.

- App-managed API keys live in the OS credential store via `keytar`:
  service `com.browser-use.desktop.credentials`, account `default`, password
  JSON containing `authMode`, `anthropicApiKey`, and `openaiApiKey`.
- Legacy keychain services may still exist during migration:
  `com.browser-use.desktop.anthropic`,
  `com.browser-use.desktop.openai`,
  `com.browser-use.desktop.anthropic-oauth`,
  `com.browser-use.desktop.auth-mode`.
- Claude Code subscription auth is owned by the Claude CLI, not this app.
  Probe with `claude auth status --json`. Raw OAuth credentials, when present,
  are in the OS credential store service `Claude Code-credentials`.
- Codex subscription auth is owned by Codex. Probe by checking
  `${CODEX_HOME:-~/.codex}/auth.json` for presence only; do not dump it.
- Local signing/notarization values are documented in `app/.env.example` and
  `SIGNING.md`. Real files such as `app/.env`, `app/.env.signing`, and any
  certificate exports must stay uncommitted.

## Debugging Flow

1. Reproduce with `task up` or an isolated `AGB_USER_DATA_DIR`.
2. Read `logs/main.log` for startup, `logs/engine.log` for agent CLI spawn and
   auth-path events, and `logs/browser.log` for WebContents/CDP issues.
3. Use `sessions.db` to map a visible session to its `session_events` stream.
4. Verify fixes with the narrowest relevant command first, then run
   `task lint`, `task typecheck`, and `cd app && npm run test` for standard
   code changes.
