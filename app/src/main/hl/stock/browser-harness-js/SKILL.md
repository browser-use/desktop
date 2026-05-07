---
name: cdp
description: Drive Browser Use Desktop's assigned Chromium target via the DevTools Protocol from JavaScript. Run snippets through the bundled `browser-harness-js` CLI; it auto-spawns a long-lived Bun HTTP server holding a CDP `Session`, and every call executes against the same persistent connection.
---

# CDP — `browser-harness-js` skill

Custom codegen'd CDP SDK (every method from browser_protocol.json + js_protocol.json gets a typed wrapper) plus a tiny HTTP server that holds one persistent CDP `Session`. The `browser-harness-js` CLI auto-starts the server on first use and forwards JS snippets to it.

Browser Use Desktop bundles the runtime under `./browser-harness-js/sdk/` and puts that directory on PATH for you. Do not run `npx skills add` or create global symlinks from inside the desktop harness.

## First use in Browser Use Desktop

Connect to the app-assigned target before page-level calls:

```bash
browser-harness-js 'await connectToAssignedTarget()'
```

`connectToAssignedTarget()` reads `BU_TARGET_ID` and `BU_CDP_PORT`, attaches the assigned target when possible, and enables the common Page/DOM/Runtime/Network domains. The CLI auto-installs `bun` on first run if it is missing. Set `BROWSER_HARNESS_SKIP_BUN_INSTALL=1` to opt out.

## How to use

Just run `browser-harness-js '<JS>'`. The first call spawns the server in the background; subsequent calls hit the same process and so reuse the same `session`, the same WebSocket to Chrome, and any globals you set.

```bash
browser-harness-js 'await connectToAssignedTarget()'
browser-harness-js 'await session.Page.navigate({url:"https://example.com"})'
browser-harness-js '(await session.Runtime.evaluate({expression:"document.title",returnByValue:true})).result.value'
```

Output is the **raw result content** — no `{ok,result}` envelope.

| Result type | stdout |
|---|---|
| string                       | bare text, no JSON quotes (e.g. `Example Domain`) |
| number / boolean             | `42`, `true` |
| object / array (non-empty)   | compact JSON (e.g. `{"frameId":"..."}`, `[1,2,3]`) |
| `undefined` / `null` / `""` / `{}` / `[]` | empty (no output) |

**Errors** go to **stderr**, exit code `1`. The CDP error message and JS stack are printed verbatim, e.g.:
```
Error: CDP -32602: invalid params
    at _call (.../session.ts:117:33)
    ...
```
Detect failure with `if browser-harness-js '...'; then ...; else handle_error; fi` or by checking `$?`.

**Multi-line snippets via stdin (heredoc).** Important: a multi-statement snippet does NOT auto-return the last expression — write `return X` explicitly. Single-expression snippets passed as the first argument DO auto-return.

```bash
browser-harness-js <<'EOF'
const tabs = await listPageTargets();
globalThis.tid = tabs[0].targetId;
await session.use(globalThis.tid);
return globalThis.tid;
EOF
```

## CLI commands

| Command | Behavior |
|---|---|
| `browser-harness-js '<js>'`     | Auto-start server if needed, eval the JS, print result. |
| `browser-harness-js <<EOF…EOF`  | Same, code from stdin. |
| `browser-harness-js --status`   | Print health JSON (uptime, connected, sessionId) or exit 1 if down. |
| `browser-harness-js --start`    | Explicit start (no-op if already running). |
| `browser-harness-js --stop`     | Graceful shutdown. Drops session state. |
| `browser-harness-js --restart`  | Stop + start fresh. |
| `browser-harness-js --logs`     | `tail -f` the server log (`/tmp/browser-harness-js.log`). |

Env vars: `CDP_REPL_PORT` (default `9876`), `CDP_REPL_LOG` (default `/tmp/browser-harness-js.log`).

## API surface inside snippets

These globals are pre-loaded — no imports needed:

- `session` — the persistent `Session`. Has every CDP domain mounted: `session.Page`, `session.DOM`, `session.Runtime`, `session.Network`, … 56 domains, 652 methods total.
- `listPageTargets()` — list real page targets via CDP's `Target.getTargets` (works on Chrome 144+ too), with `chrome://` and `devtools://` URLs filtered out. No args — uses the connected session.
- `detectBrowsers()` — scan OS-specific profile dirs for running Chromium-based browsers with remote debugging on. Returns `[{name, profileDir, port, wsPath, wsUrl, mtimeMs}]`, sorted by most recently launched.
- `resolveWsUrl(opts)` — resolve a WS URL from `{wsUrl}` | `{port, host?}` | `{profileDir}`. For the no-args auto-detect flow, call `session.connect()` directly instead.
- `CDP` — the generated namespaces (`CDP.Page`, `CDP.Runtime`, …) for type-name reference.

### Calling a CDP method

Every method takes a single object argument matching the CDP wire params; it resolves to the typed return value (no `result` envelope, no `id` correlation — handled for you).

```js
// no params
await session.DOM.enable()

// required params
await session.Page.navigate({ url: 'https://example.com' })

// all-optional params (object also optional)
await session.Page.captureScreenshot()
await session.Page.captureScreenshot({ format: 'png', quality: 80 })

// returns are stripped to the typed shape
const { root } = await session.DOM.getDocument()
const { nodeId } = await session.DOM.querySelector({ nodeId: root.nodeId, selector: 'h1' })
```

### Connecting

**Default: just call `session.connect()` with no args.** It auto-detects running Chromium-based browsers (Chrome, Chromium, Edge, Brave, Arc, Vivaldi, Opera, Comet, Canary) by scanning OS-specific profile dirs for a `DevToolsActivePort` file, ordered by most-recently-launched, and picks the first one whose WebSocket accepts. OS-agnostic — works on macOS, Linux, Windows.

```js
await session.connect()   // auto-detect
```

Use `detectBrowsers()` first if you want to see what's available (or let the user pick) before connecting:

```js
const found = await detectBrowsers()
// [{ name: 'Google Chrome', profileDir, port, wsPath, wsUrl, mtimeMs }, ...]
```

**Explicit forms** — use these only when auto-detect picks the wrong browser, or when you already know where to connect:

| Form | When to use |
|---|---|
| `{ profileDir }` | Target a specific browser when several are running. Reads `<profileDir>/DevToolsActivePort` directly. |
| `{ wsUrl }` | You already have `ws://…/devtools/browser/<uuid>` (e.g. piped from elsewhere). |

```js
await session.connect({ profileDir: '/Users/<you>/Library/Application Support/Google/Chrome' })
await session.connect({ wsUrl: 'ws://127.0.0.1:9222/devtools/browser/<uuid>' })
```

Profile paths by OS — use these with `{ profileDir }`:
- macOS: `~/Library/Application Support/<Browser>` (e.g. `Google/Chrome`, `Comet`, `BraveSoftware/Brave-Browser`, `Arc/User Data`)
- Linux: `~/.config/<browser>` (e.g. `google-chrome`, `chromium`, `BraveSoftware/Brave-Browser`)
- Windows: `%LOCALAPPDATA%\<Browser>\User Data` (e.g. `Google\Chrome`, `Microsoft\Edge`, `BraveSoftware\Brave-Browser`)

Per-candidate WS-open timeout defaults to **5s** — live browsers answer with open/close within ~100ms, so 5s is already generous. The only case where 5s is too short is when Chrome is showing the **Allow** popup and waiting on the user to click. If you expect that, pass `timeoutMs: 30000`:

```js
await session.connect({ profileDir: '/Users/<you>/Library/Application Support/Google/Chrome', timeoutMs: 30_000 })
```

**If you see `No detected browser accepted a connection`** — the browsers have `DevToolsActivePort` files but none are currently serving WS. Most common cause: remote-debugging is enabled but the user hasn't clicked **Allow** on the prompt yet. Tell them to click Allow, then retry (or bump `timeoutMs`).

### Picking a target (tab)

After `connect()`, call `session.use(targetId)` once; subsequent page-level calls (Page/DOM/Runtime/Network/etc.) auto-route to that target's sessionId. `Browser.*` and `Target.*` calls always hit the browser endpoint.

```js
const tabs = await listPageTargets()                     // no args; uses the connected session
const sid  = await session.use(tabs[0].targetId)
await session.Page.enable()
await session.Page.navigate({ url: 'https://example.com' })
```

`listPageTargets()` uses CDP's `Target.getTargets` (not `/json`), so it works on Chrome 144+ too. It already filters out `chrome://` and `devtools://` URLs. Equivalent raw call:

```js
const { targetInfos } = await session.Target.getTargets({})
const tabs = targetInfos.filter(t => t.type === 'page' && !t.url.startsWith('chrome://') && !t.url.startsWith('devtools://'))
```

To switch tabs: `session.use(otherTargetId)`. To detach: `session.setActiveSession(undefined)`.

### Events

```js
// Subscribe (returns an unsubscribe fn)
const off = session.onEvent((method, params, sessionId) => { ... })

// Or wait for a single matching event with optional predicate + timeout
await session.Network.enable()
const ev = await session.waitFor(
  'Page.frameNavigated',
  (p) => p.frame.url.includes('example.com'),
  10_000
)
```

### Persisting state across calls

Each snippet runs inside its own async wrapper, so its `let`/`const` declarations vanish when it returns. To carry data forward, attach to `globalThis`:

```bash
browser-harness-js '(await listPageTargets()).forEach((t,i)=>globalThis["tab"+i]=t.targetId)'
browser-harness-js 'await session.use(globalThis.tab0)'
browser-harness-js 'await session.Page.navigate({url:"https://example.com"})'
```

`session` itself, the active sessionId, and event subscribers are already preserved by the server — globals are only needed for ad-hoc data.

## Connecting to a running Chrome (chrome://inspect flow)

When attaching to the user's already-running browser:

1. **Try `await session.connect()` first** (no args) — auto-detect handles every Chromium-based browser via `DevToolsActivePort`. If it returns, you're done.
2. **If auto-detect fails** with `No running browser with remote debugging detected`, the user needs to turn it on. Open the inspect page:
   ```bash
   # macOS — prefer AppleScript over `open -a` (reuses current profile, avoids the profile picker)
   osascript -e 'open location "chrome://inspect/#remote-debugging"'

   # Linux
   google-chrome 'chrome://inspect/#remote-debugging'     # or: chromium, google-chrome-stable

   # Windows (PowerShell)
   Start-Process chrome 'chrome://inspect/#remote-debugging'
   ```
   Only macOS's AppleScript path avoids the profile picker; Linux/Windows may prompt the user to pick a profile first.
3. **Tick "Discover network targets"** in chrome://inspect, then click **Allow** when Chrome prompts.
4. **If auto-detect picks the wrong browser** (multiple running, you want a specific one): list them with `await detectBrowsers()`, then `await session.connect({ profileDir: <the one you want> })`.
5. **If `session.connect()` returns `No detected browser accepted a connection`**, the user has remote-debugging on but hasn't clicked **Allow** yet. Tell them to click it and retry, or pass `timeoutMs: 30000` to wait for the click.

## Working with targets (tabs)

- **Filter Chrome internals.** `listPageTargets()` already drops `chrome://` and `devtools://` URLs. If you call `Target.getTargets()` directly, filter manually.
- **CDP target order ≠ visible tab-strip order.** When the user says "the first tab I can see", use a screenshot or page title to identify it — `Target.activateTarget` only switches to a known targetId.

## Looking up a method

The full typed surface is in `<skill-dir>/sdk/generated.ts` (~655 KB, only loaded if you read it). Each method has its CDP description as a JSDoc comment plus typed `*Params` / `*Return` interfaces in per-domain namespaces.

```bash
grep -n "navigate" <skill-dir>/sdk/generated.ts | head
```

## Regenerating the SDK

This is a maintenance-only workflow, not a normal task step. Browser Use
Desktop already bundles the generated SDK. Do not regenerate or patch it during
ordinary browser tasks unless the user explicitly asks, or a confirmed bundled
runtime defect blocks the task.

When the upstream protocol JSONs change, replace `sdk/browser_protocol.json` and/or `sdk/js_protocol.json` and re-run:

```bash
cd <skill-dir>/sdk && bun gen.ts
browser-harness-js --restart   # pick up the new bindings
```

## Files

All paths are relative to `<skill-dir>` (the install path — see top of this doc).

- `/usr/local/bin/browser-harness-js` → `<skill-dir>/sdk/browser-harness-js` (the CLI)
- `sdk/repl.ts` — HTTP server (`Bun.serve` on `127.0.0.1:9876`)
- `sdk/session.ts` — `Session` class (transport, connect, target routing, events)
- `sdk/generated.ts` — codegen output: every CDP method as a typed wrapper
- `sdk/gen.ts` — codegen script
- `sdk/{browser,js}_protocol.json` — upstream protocol (vendored)
