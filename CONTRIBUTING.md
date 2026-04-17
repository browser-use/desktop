# Contributing

This document covers setup, workflow, testing, and design rules for the Agentic Browser project.

## Development setup

### Prerequisites

- Node 20+ (for Electron, Vite, vitest, TypeScript)
- Python 3.11+ (for agent daemon, pytest)
- macOS 13+ (primary target)
- Anthropic API key (`ANTHROPIC_API_KEY` env var or Settings window)

### First time

```bash
# Clone repo
git clone https://github.com/<owner>/desktop-app
cd desktop-app/my-app

# Install Node deps
npm install

# Set up Python venv + install daemon deps
cd python
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..

# Start dev server (Electron + daemon together)
npm run dev
```

### Daily workflow

```bash
# Terminal 1 — watch tests while coding
npm run test:watch

# Terminal 2 — start app
npm run dev

# Before committing
npm run qa                    # lint + typecheck + test (one-shot CI check)

# If you modified UI
npm run visual:capture        # update baselines
npm run visual:qa             # run capture + diff
npm run qa:review             # open HTML gallery
```

## Git workflow

### Branch naming

Always use conventional branch prefix:

```
feat/<feature-name>         Feature (new agent capability, UI component, etc.)
fix/<bug-description>       Bug fix
chore/<task-name>          Maintenance (dependencies, config, etc.)
docs/<doc-name>            Documentation only
test/<test-description>    Tests only (no code changes)
style/<change>             Code style, formatting (no logic change)
ci/<workflow-name>         CI/CD workflow changes
```

Examples:
- `feat/agent-streaming` — new feature
- `fix/pill-scrolling-bug` — bug fix
- `docs/readme-update` — documentation
- `test/visual-baselines` — test infrastructure
- `chore/bump-electron` — dependency update

### Commit style

Use **Conventional Commits** format with scope:

```
<type>(<scope>): <subject> — <optional notes>

<optional body>

Co-Authored-By: <AI model> <email>
```

**Types:** `feat`, `fix`, `docs`, `style`, `test`, `chore`, `ci`, `refactor`

**Scope** (optional): `shell`, `pill`, `onboarding`, `settings`, `daemon`, `python`, `tests`, `design`, `ci`, etc.

**Examples:**

```
feat(pill): streaming agent task UI with progress updates

fix(shell): tab switch race condition in IPC

docs(readme): quickstart + architecture overview

test(python): add exec_sandbox security tests — verify blocked imports

chore(deps): bump electron to 41.x

style(design): enforce no !important across all CSS

ci(gh): add macOS signing workflow
```

**For AI-assisted work**, include co-author:

```
feat(agent): CDP click/scroll/evaluate methods

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### Push rules

- **Never force-push** to main or any shared branch
- **Never push to main** — all work happens on feature branches, merged via PR
- **Always run `npm run qa` before push** — ensures lint, typecheck, and tests pass
- **No secrets in commits** — never commit `.env`, API keys, or credentials

## Testing rules

### Core rule: NEVER mock real data sources

- **Keychain** — use real Keychain calls (backed by test fixtures)
- **File system** — use real files + fixtures, not mocks
- **IPC** — use real message passing in integration tests
- **Database** — use real SQLite (not mocked)
- **Agent daemon** — prefer real daemon in e2e; mock only for unit tests

**Why?** Mocked tests pass but real behavior fails. We test what actually happens.

### Unit tests (vitest)

```bash
npm test              # Run once
npm run test:watch    # Watch mode
```

**Location:** `src/**/*.test.ts`

**Rules:**
- Test one thing per spec
- Use real Keychain (or mock only if explicitly instructed)
- Mock external HTTP only (anthropic SDK, OAuth providers)
- Fixture data in `tests/fixtures/`
- Snapshot tests allowed for complex outputs

**Example:**

```typescript
describe('Keychain integration', () => {
  it('stores and retrieves API key', async () => {
    // Real Keychain call
    await setKey('test-key', 'secret-value')
    const retrieved = await getKey('test-key')
    expect(retrieved).toBe('secret-value')
  })
})
```

### Integration tests (vitest)

```bash
npm test
```

**Location:** `tests/integration/*.test.ts`

**Rules:**
- Test IPC message flow (real main → renderer communication)
- Use MockDaemonClient for agent tasks (avoids Python subprocess)
- Test settings persistence (real Keychain)
- No external HTTP (mock anthropic SDK)

**Example:**

```typescript
describe('Agent task IPC', () => {
  it('sends task to daemon and streams results', async () => {
    const client = new MockDaemonClient()
    // Real IPC, mocked daemon
    const task = await ipcRenderer.invoke('ipc-pill:submit-task', {
      prompt: 'count links on this page'
    })
    expect(task.status).toBe('started')
  })
})
```

### End-to-end tests (Playwright)

```bash
npm run e2e                  # Run all specs
DAEMON_MOCK=1 npm run e2e    # Use mock daemon (faster)
```

**Location:** `tests/e2e/*.spec.ts`

**Rules:**
- Test complete user flows (onboarding → shell → task → done)
- Use real app (Electron + daemon, or mock daemon)
- Use real browser (Chromium via Playwright)
- No database mocks — use real Keychain
- API key from `.env` or Settings

**Example:**

```typescript
test('pill-flow: Cmd+K → agent task → done', async () => {
  // Real app, real Keychain, real (or mocked) daemon
  await app.openWindow('shell')
  await page.press('Cmd+K')  // Open pill
  await page.fill('[data-testid=pill-prompt]', 'count paragraphs')
  await page.click('[data-testid=pill-submit]')
  
  // Stream updates
  await expect(page.locator('[data-testid=pill-status]')).toContainText('Done')
})
```

### Python tests (pytest)

```bash
cd my-app/python
pytest              # Run all
pytest -v           # Verbose
pytest tests/test_budget.py  # Single file
```

**Location:** `my-app/python/tests/`

**Rules:**
- Test sandbox security (blocked imports, safe builtins)
- Test agent loop (happy path, budget exhaustion, cancellation)
- Test protocol (serialization, event ordering)
- No mocks unless instructed — use real ExecSandbox

**Files:**
- `test_budget.py` — step/token enforcement
- `test_exec_sandbox.py` — code execution security
- `test_loop.py` — agent step loop
- `test_protocol.py` — socket message format
- `test_events.py` — event emitter
- `test_logger.py` — structured logging

### Visual regression testing

```bash
npm run visual:capture  # Write PNG baselines (always before UI changes)
npm run visual:diff     # Compare current vs baseline
npm run visual:qa       # Both + open review.html
```

**When to capture:**
- Before any design changes
- Before modifying component styles
- Before updating theme tokens
- After fixing visual bugs

**Baselines:** `tests/visual/references/*.png` (committed to repo)

## Design rules

### Color & typography

- **Never use Inter font** — use Geist (UI) or Berkeley Mono (code)
- **Never use `!important`** — CSS cascade problems; use specificity instead
- **Never use left outline** — looks like debugging; use border instead
- **No approximations for numbers** — use exact pixels/percentages (not "about 12px")

### Layout & visual

- **No sparkles icon** — remove if present
- **Rounded corners:** default `4px`; form inputs `6px`; modals `8px`
- **Shadows:** use CSS custom property `--shadow-sm` (light) or `--shadow-md` (medium)
- **Padding:** use design tokens (8px, 12px, 16px, 24px)

### Accessibility

- **Color contrast:** WCAG AA minimum (4.5:1 for text)
- **Focus rings:** always visible on Tab navigation
- **Reduced motion:** respect `prefers-reduced-motion` media query
- **Keyboard navigation:** all interactive elements reachable via Tab
- **Semantic HTML:** use `<button>`, `<input>`, `<label>` (not divs)

### Reusable styles

Save shared styles in the global CSS file:

```css
/* src/renderer/design/theme.global.css */
:root {
  --color-brand-neon: #c8f135;
  --spacing-xs: 8px;
  --spacing-sm: 12px;
  --font-size-md: 13px;
}
```

Import in component CSS:

```css
@import url('/src/renderer/design/theme.global.css');

.my-button {
  padding: var(--spacing-sm);
  color: var(--color-brand-neon);
}
```

## Adding a new window

Checklist for new Electron window (e.g., debug console, help pane):

### 1. Preload script

Create `src/preload/<window-name>.ts`:

```typescript
import { contextBridge, ipcRenderer } from 'electron'

const apis = {
  ipc: {
    send: (channel: string, data: any) => ipcRenderer.send(channel, data),
    // ... your APIs
  }
}

contextBridge.exposeInMainWorld('electron', apis)
```

### 2. Vite config

Add entry to `vite.config.ts`:

```typescript
export default {
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/main.ts'),
        shell: resolve(__dirname, 'src/renderer/shell/index.html'),
        pill: resolve(__dirname, 'src/renderer/pill/index.html'),
        yourwindow: resolve(__dirname, 'src/renderer/yourwindow/index.html'),  // ← NEW
      },
      // ...
    }
  }
}
```

### 3. Forge config

Register in `forge.config.ts`:

```typescript
const config: ForgeConfig = {
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/renderer/shell/index.tsx',
          config: 'vite.config.ts',
        },
        {
          entry: 'src/renderer/yourwindow/index.tsx',  // ← NEW
          config: 'vite.config.ts',
        },
        // ...
      ],
      preload: {
        js: 'src/preload/index.ts',
        yourwindow: 'src/preload/yourwindow.ts',  // ← NEW
      },
    }),
  ],
}
```

### 4. Main process window creation

Add to `src/main/index.ts`:

```typescript
const createYourWindow = async () => {
  const window = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'yourwindow.js'),  // Vite output
      sandbox: true,
    }
  })

  if (VITE_DEV_SERVER_URL) {
    window.loadURL(`${VITE_DEV_SERVER_URL}#/yourwindow`)
  } else {
    window.loadFile(
      path.join(__dirname, '../renderer', 'yourwindow', 'index.html')
    )
  }

  ipcMain.handle('ipc-yourwindow:action', (event, data) => {
    // Handle IPC from renderer
  })
}
```

### 5. CSP headers

Update `forge.config.ts` CSP to include your preload:

```typescript
makers: [
  {
    name: '@electron-forge/maker-dmg',
    config: {
      // ...
      contentSecurityPolicy: {
        'default-src': ["'self'", 'http://localhost:*'],
        'script-src': ["'self'", 'http://localhost:*'],
        // Add preload path if needed
      }
    }
  }
]
```

### 6. IPC contract

Document the message types in a comment block:

```typescript
/**
 * IPC contract for yourwindow
 * 
 * Main → Renderer (events):
 *   ipc-yourwindow:data-changed — data updated
 * 
 * Renderer → Main (requests):
 *   ipc-yourwindow:get-data → {data: ...}
 *   ipc-yourwindow:set-data — update data
 */
```

## Debugging

### Shell is blank

Check the Electron console (Cmd+Option+I) for:
1. CSP violations (red X's)
2. 404 errors on resources
3. Preload bridge errors (`electron` undefined)

See troubleshooting in `my-app/README.md`.

### Agent daemon not starting

```bash
# Terminal 1 — start daemon manually
cd my-app/python
source .venv/bin/activate
DAEMON_SOCKET_PATH=/tmp/agent-test.sock python3 agent_daemon.py

# Terminal 2 — send test message
echo '{"meta":"ping"}' | nc -U /tmp/agent-test.sock
```

### Tests flaky or hanging

- Add `--timeout=5000` to pytest (prevent hangs)
- Run single test: `npm run test -- src/file.test.ts`
- Use `test.only()` to focus on one spec
- Check for unresolved promises (async/await bugs)

## Code style

### TypeScript

- Use strict mode (default)
- Avoid `any` — use `unknown` or generics
- Prefer interfaces for public APIs
- Keep functions small (under 20 lines preferred)

### React

- Functional components only
- Use hooks (no class components)
- Extract custom hooks to `src/renderer/hooks/`
- Co-locate styles next to components

### Python

- Type hints required (PEP 484)
- Docstrings for public functions
- Black formatting (run `black .` before commit)
- pytest for tests

## Getting help

- Check memory: `/Users/reagan/.claude/projects/-Users-reagan-Documents-GitHub-desktop-app/memory/MEMORY.md`
- Check design system: `my-app/src/renderer/design/DESIGN_SYSTEM.md`
- Check brand: `my-app/assets/brand/BRAND.md`
- Ask in issues or PRs

---

**Last updated:** 2026-04-17
