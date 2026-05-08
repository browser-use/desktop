# Viewport

Coordinate clicks depend on viewport size; layouts depend on viewport size; a lot of flaky automation traces to a viewport that silently changed.

## Read the current viewport

```js
const { result } = await session.Runtime.evaluate({
  returnByValue: true,
  expression: `
    JSON.stringify({
      w: innerWidth, h: innerHeight,
      sx: scrollX, sy: scrollY,
      pw: document.documentElement.scrollWidth,
      ph: document.documentElement.scrollHeight,
      dpr: devicePixelRatio,
    })
  `,
})
const vp = JSON.parse(result.value)
```

`innerWidth`/`innerHeight` is the **CSS-pixel** viewport — what coordinate clicks use. `devicePixelRatio` multiplies for actual screen pixels (`captureScreenshot` output dimensions).

## Force a specific size (CSS pixels)

```js
await session.Emulation.setDeviceMetricsOverride({
  width: 1280,
  height: 800,
  deviceScaleFactor: 1,   // 0 = use real DPR; set to 2 for retina-like
  mobile: false,
})
```

All subsequent `Input.dispatchMouseEvent` coordinates are in this 1280×800 space — pin it at the start of a session so coordinates stay stable.

Clear it back to the actual window size:

```js
await session.Emulation.clearDeviceMetricsOverride()
```

## Mobile emulation

```js
await session.Emulation.setDeviceMetricsOverride({
  width: 390, height: 844,
  deviceScaleFactor: 3,
  mobile: true,
})
await session.Emulation.setTouchEmulationEnabled({ enabled: true })
await session.Network.setUserAgentOverride({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
})
```

Mobile triggers responsive breakpoints and enables touch events. Sites with `@media (hover: hover)` also flip their hover affordances off.

## `w=0 h=0` is a target problem, not a viewport problem

If `Runtime.evaluate('innerWidth')` returns 0, you're attached to a non-window surface (omnibox popup, a DevTools target). See `connection.md` / `tabs.md` — use `listPageTargets()` and re-route with `session.use(...)`.

## Traps

- **Coordinate clicks become wrong as soon as the viewport changes.** Re-read rects with `getBoundingClientRect()` after any resize, not just after scrolling.
- **`captureScreenshot` returns device pixels, not CSS pixels.** If `devicePixelRatio = 2` and you eyeball an element at (400, 300) in the screenshot, click at (200, 150) in CSS pixels.
- **`setDeviceMetricsOverride` persists across navigations** within the session — remember to clear it at the end if the user is going to keep using the browser.
- **Some sites guard against resize storms** (e.g. `window.addEventListener('resize', debounce)`). After `setDeviceMetricsOverride`, wait ~300ms before reading rects or clicking.
- **Responsive sites that use `matchMedia` at page load** may not re-evaluate breakpoints after override. Apply `setDeviceMetricsOverride` **before** `Page.navigate`, not after.
