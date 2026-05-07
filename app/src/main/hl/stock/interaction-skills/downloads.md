# Downloads

Two modes: let Chrome write the file to a directory you control, or intercept the download response in CDP and save it yourself.

## Route downloads to a directory you own

```js
// Cross-platform temp dir: /tmp on Linux, /var/folders/… on macOS, %TEMP% on Windows
const { tmpdir } = await import('node:os')
const downloadDir = `${tmpdir()}/cdp-downloads`
await Bun.write(`${downloadDir}/.keep`, '')  // ensure dir exists

await session.Browser.setDownloadBehavior({
  behavior: 'allow',
  downloadPath: downloadDir,
  eventsEnabled: true,   // emit Browser.downloadWillBegin / downloadProgress
})
```

Now any download — whether triggered by a link (`<a download>`), a `window.location` to a binary, or a form POST that returns `Content-Disposition: attachment` — saves to that directory.

## Signal that a download actually started

```js
const ev = await session.waitFor(
  'Browser.downloadWillBegin',
  (p) => p.suggestedFilename.endsWith('.pdf'),
  10_000
)
console.log(ev.guid, ev.suggestedFilename, ev.url)
```

## Signal that it finished

```js
const done = await session.waitFor(
  'Browser.downloadProgress',
  (p) => p.state === 'completed',
  60_000
)
console.log(done.receivedBytes, done.totalBytes)
```

`Browser.downloadProgress.state` is one of `'inProgress' | 'completed' | 'canceled'`.

## Skip the browser entirely for plain HTTP downloads

If the download URL is a plain HTTP GET with no auth/cookie state the browser added, `fetch` directly from the Bun snippet:

```js
const { tmpdir } = await import('node:os')
const res = await fetch('https://example.com/report.pdf')
await Bun.write(`${tmpdir()}/report.pdf`, await res.arrayBuffer())
```

This is often 10× faster than driving the browser. But it **loses cookie-based auth** — for logged-in downloads, either:
1. Use the browser path (`Browser.setDownloadBehavior`), or
2. Copy cookies out first (`Network.getCookies`) and include them in the `fetch`.

## When the only trigger is a click

If the site exposes only a "Download" button and no obvious URL:

```js
// Pre-arm Browser.setDownloadBehavior, then click
await session.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
await session.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
const ev = await session.waitFor('Browser.downloadWillBegin', undefined, 10_000)
```

## Traps

- **`Browser.setDownloadBehavior` is browser-scoped**, not page-scoped. Set it once per browser session.
- **`downloadPath` must exist.** Chrome silently drops the file otherwise — always `mkdir -p` first.
- **Files arrive with the suggested filename**, not a name you choose. Rename after `state === 'completed'` if you need a specific name.
- **`beforeunload` on the triggering page** can block the download. Some sites open a confirm dialog before navigating to the PDF endpoint — handle the dialog first (see `dialogs.md`).
- **If the "download" is actually just inline navigation** (PDF viewer opens in-page), there's no `downloadWillBegin` — you'll need `Page.printToPDF` or direct `fetch` instead.
