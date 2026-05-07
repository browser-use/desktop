# Tabs

Use **CDP for control** (attach, activate known targets, inspect). Use **UI automation for visible order**.

## Pure CDP

```js
// List page targets (filtered; chrome:// / devtools:// dropped)
const tabs = await listPageTargets()

// Create a new tab and route subsequent calls to it
const { targetId } = await session.Target.createTarget({ url: 'https://example.com' })
await session.use(targetId)

// Switch: route calls to another existing tab
await session.use(otherTargetId)

// Show this tab visibly in Chrome (different from `session.use` — which is CDP routing only)
await session.Target.activateTarget({ targetId })

// Close a tab
await session.Target.closeTarget({ targetId })

// What tab is session.use currently pointing at?
const { targetInfo } = await session.Target.getTargetInfo({ targetId })
```

**`session.use` is CDP-side routing; `Target.activateTarget` is Chrome-side focus.** They are independent. If the user expects Chrome to visibly change, call `activateTarget` too.

## Two things `Target.createTarget` quietly gets wrong

1. **Race: `{ url }` in `createTarget` can resolve before navigation starts.** If you then poll `document.readyState`, you'll see `'complete'` for about:blank and move on. Safer:
   ```js
   const { targetId } = await session.Target.createTarget({ url: 'about:blank' })
   await session.use(targetId)
   await session.Page.enable()
   await session.Page.navigate({ url: 'https://example.com' })
   // now wait for Page.loadEventFired via session.waitFor
   ```

2. **New tab may open behind the active one.** Add `Target.activateTarget` if the user needs to see it.

## Visible tab-strip order (platform UI)

CDP's `Target.getTargets` returns an arbitrary order — not left-to-right.

### macOS

```applescript
tell application "Google Chrome"
  set out to {}
  set i to 1
  repeat with t in every tab of front window
    set end of out to {tab_index:i, tab_title:(title of t), tab_url:(URL of t)}
    set i to i + 1
  end repeat
  return out
end tell
```

```applescript
tell application "Google Chrome"
  set active tab index of front window to 2
  activate
end tell
```

### Linux

No AppleScript. Use `xdotool`, `wmctrl`, or desktop-environment scripting. The split is the same — CDP for attach/activate-by-id, window manager for visible ordering.

## Traps

- `listPageTargets()` already drops `chrome://` and `devtools://`. If you call `Target.getTargets` raw, you must filter yourself, or you'll attach to a 1px omnibox popup.
- If a page reports `innerWidth=0 innerHeight=0`, you're probably attached to a non-window surface (omnibox popup, background tab that never rendered).
