# Dialogs

`alert`, `confirm`, `prompt`, `beforeunload` freeze the JS thread. Two approaches depending on timing.

## Reactive: dismiss via CDP (preferred)

Works even when JS is frozen. Handles all four dialog types.

```js
await session.Page.enable()

// Dismiss / accept
await session.Page.handleJavaScriptDialog({ accept: true })               // "OK"
await session.Page.handleJavaScriptDialog({ accept: false })              // "Cancel"
await session.Page.handleJavaScriptDialog({ accept: true, promptText: 'hi' })  // for prompt()

// Wait for a dialog to open (and read its text)
const ev = await session.waitFor('Page.javascriptDialogOpening', undefined, 10_000)
console.log(ev.type, ev.message)  // "alert"|"confirm"|"prompt"|"beforeunload"
```

Undetectable by antibot — no JS runs in the page.

**Subscribe to every dialog while a flow runs:**

```js
await session.Page.enable()
const off = session.onEvent(async (method, params) => {
  if (method === 'Page.javascriptDialogOpening') {
    await session.Page.handleJavaScriptDialog({ accept: true })
  }
})
// ...do actions that may trigger dialogs...
off()
```

## Proactive: stub via JS

Prevents dialogs from ever appearing. Good when you expect many `alert()`/`confirm()` calls.

```js
await session.Runtime.evaluate({ expression: `
  window.__dialogs__ = [];
  window.alert = m => window.__dialogs__.push(String(m));
  window.confirm = m => { window.__dialogs__.push(String(m)); return true; };
  window.prompt = (m, d) => { window.__dialogs__.push(String(m)); return d || ''; };
` })
// ...actions...
const { result } = await session.Runtime.evaluate({
  expression: 'window.__dialogs__ || []',
  returnByValue: true,
})
```

Tradeoffs:
- Stubs are lost on page navigation — re-inject after every navigate.
- `confirm()` always returns `true`.
- Detectable by antibot (`window.alert.toString()` reveals non-native code).
- Does **not** handle `beforeunload`.

## beforeunload specifically

Fires when navigating away from a page with unsaved changes (forms, editors). The page freezes until the user clicks Leave/Stay.

```js
// Option A: dismiss after navigating (CDP, safe, undetectable)
await session.Page.navigate({ url: 'https://new-url.com' })
try {
  await session.Page.handleJavaScriptDialog({ accept: true })  // "Leave"
} catch { /* no dialog — normal */ }

// Option B: prevent before navigating (JS, detectable)
await session.Runtime.evaluate({ expression: 'window.onbeforeunload = null' })
await session.Page.navigate({ url: 'https://new-url.com' })
```
