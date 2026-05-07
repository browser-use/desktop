# Connection & Tab Visibility

## Just call `session.connect()`

No args required. It scans OS-specific profile dirs for every running Chromium-based browser (Chrome, Chromium, Edge, Brave, Arc, Vivaldi, Opera, Comet, Canary), picks the most-recently-launched one whose WebSocket accepts, and attaches. Dead ports and permission-denied (403) candidates fall through in <100ms each, so the loop is fast.

```js
await session.connect()
```

Inspect what's available (e.g. to let the user choose) with `detectBrowsers()`:

```js
const browsers = await detectBrowsers()
// [{ name: 'Google Chrome', profileDir, port, wsPath, wsUrl, mtimeMs }, ...]
```

### Explicit forms (override auto-detect)

Use only when auto-detect picks the wrong browser or you already know the destination.

| Form | When |
|---|---|
| `{ profileDir }` | Target a specific running browser. Reads its `DevToolsActivePort` directly. OS-agnostic. |
| `{ wsUrl }` | You already have `ws://…/devtools/browser/<uuid>`. |

```js
await session.connect({ profileDir: '/Users/<you>/Library/Application Support/Google/Chrome' })
await session.connect({ wsUrl: 'ws://127.0.0.1:9222/devtools/browser/<uuid>' })
```

### Timeouts and the Allow popup

Per-candidate WS-open timeout defaults to **5s**. A live browser either opens or closes the connection within ~100ms, so 5s is always enough — unless the user has to click **Allow** on Chrome's remote-debugging popup. In that case, pass `timeoutMs: 30000` to give them time:

```js
await session.connect({ profileDir, timeoutMs: 30_000 })
```

If `session.connect()` reports `No detected browser accepted a connection`, it means every browser with `DevToolsActivePort` answered 403 or closed without opening — most likely the user hasn't clicked Allow yet. Ask them to, then retry.

## The omnibox popup problem

When Chrome opens fresh, the only CDP `type: "page"` targets may be `chrome://inspect` and `chrome://omnibox-popup.top-chrome/` (a 1px invisible viewport). If you attach to the omnibox popup, every subsequent action happens on a tab the user cannot see.

`listPageTargets()` already filters `chrome://` and `devtools://` URLs. If you call `Target.getTargets` directly, filter these manually:

```js
const { targetInfos } = await session.Target.getTargets({})
const realTabs = targetInfos.filter(t =>
  t.type === 'page' &&
  !t.url.startsWith('chrome://') &&
  !t.url.startsWith('devtools://')
)
```

If no real pages exist yet, create one instead of attaching to nothing:

```js
const tabs = await listPageTargets()
let targetId = tabs[0]?.targetId
if (!targetId) {
  ({ targetId } = await session.Target.createTarget({ url: 'about:blank' }))
}
await session.use(targetId)
```

## Startup sequence

1. `await session.connect()` — auto-detect the running browser.
2. `const tabs = await listPageTargets()` — see what real pages exist.
3. `await session.use(tabs[0].targetId)` — route Page/DOM/Runtime/Network calls to that target.
4. `await session.Target.activateTarget({ targetId: tabs[0].targetId })` — bring the tab visually to front.
5. Enable the domains you need: `await session.Page.enable()`, `await session.Network.enable({})`, etc.

## CDP target order ≠ visible tab-strip order

When the user says "the first tab I can see", do NOT trust the order of `Target.getTargets`. Use:

- A screenshot (`session.Page.captureScreenshot()`) to identify visually.
- Page title / URL heuristics.
- Or platform UI automation (macOS: AppleScript; Linux: `xdotool`/`wmctrl`).

`Target.activateTarget` only switches to a targetId you already know — it cannot resolve "leftmost tab".

## Bringing Chrome to front

```bash
# macOS — prefer AppleScript over `open -a` (reuses current profile, avoids the profile picker)
osascript -e 'tell application "Google Chrome" to activate'

# Linux (X11) — use wmctrl or xdotool
wmctrl -a 'Google Chrome'
xdotool search --name 'Google Chrome' windowactivate

# Windows (PowerShell)
powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).AppActivate('Google Chrome')"
```
