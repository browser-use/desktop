# Screenshots

`session.Page.captureScreenshot` is your default discovery and verification tool.

## Core calls

```js
// Viewport only (default) — fastest, matches what the user sees
const { data } = await session.Page.captureScreenshot({ format: 'png' })
// Cross-platform temp dir: /tmp on Linux, /var/folders/… on macOS, %TEMP% on Windows
const { tmpdir } = await import('node:os')
await Bun.write(`${tmpdir()}/shot.png`, Buffer.from(data, 'base64'))

// Full page — stitched beyond the viewport
await session.Page.captureScreenshot({ format: 'png', captureBeyondViewport: true })

// JPEG is ~5× smaller — good when you only need to eyeball
await session.Page.captureScreenshot({ format: 'jpeg', quality: 70 })

// A specific region (page coordinates)
await session.Page.captureScreenshot({
  format: 'png',
  clip: { x: 0, y: 0, width: 800, height: 600, scale: 1 },
})
```

## When to screenshot

- **Discovery:** after navigating, before inventing a selector. A screenshot answers "is the thing I need visible and where?" faster than a DOM walk.
- **Verification:** after every meaningful action. The DOM can lie about state; pixels cannot.
- **Debugging coordinate clicks:** shot → read → `Input.dispatchMouseEvent` at (x, y) → shot again.

## Element screenshots via `DOM.getBoxModel`

When you want just one element:

```js
await session.DOM.enable()
const { root } = await session.DOM.getDocument({})
const { nodeId } = await session.DOM.querySelector({ nodeId: root.nodeId, selector: '.card' })
const { model } = await session.DOM.getBoxModel({ nodeId })
const [x, y] = model.border        // top-left
const width = model.width
const height = model.height
await session.Page.captureScreenshot({ clip: { x, y, width, height, scale: 1 } })
```

`model.border` is `[x1,y1, x2,y1, x2,y2, x1,y2]` — 8 numbers, 4 corners. Take the first two for origin.

## Traps

- `captureBeyondViewport: true` re-layouts the page (fires resize). Don't use it in the middle of a user-driven flow — use viewport shots.
- On high-DPI, `captureScreenshot` returns the device-pixel image. If you plan to coordinate-click on values read from the image, remember the CSS-pixel / device-pixel scale (see viewport.md).
- Pages with fixed/sticky headers over `captureBeyondViewport` can produce duplicated headers down the stitched image.
