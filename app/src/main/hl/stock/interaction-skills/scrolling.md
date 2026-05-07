# Scrolling

Three levels, in order of how often they work:

1. **Wheel event at a point** — `Input.dispatchMouseEvent { type: 'mouseWheel' }`. Scrolls whichever element is under (x, y) and consumes wheel.
2. **`scrollIntoView` on the element** — `Runtime.evaluate` with a short JS snippet. Works for anything in the DOM you can `querySelector`.
3. **Set `scrollTop` directly on the container** — bypasses animations and snap.

## Wheel (coordinate-based, closest to a real user)

```js
// scroll down 300px at the center of the viewport
await session.Input.dispatchMouseEvent({
  type: 'mouseWheel',
  x: 600, y: 400,
  deltaX: 0, deltaY: 300,
})

// scroll up
await session.Input.dispatchMouseEvent({ type: 'mouseWheel', x: 600, y: 400, deltaX: 0, deltaY: -300 })
```

- Pick (x, y) over the element you want to scroll. If you wheel over a sticky header or a pinned sidebar, nothing happens.
- Virtualized lists (`react-window`, TanStack Virtual): wheeling the container is the **only** reliable scroll; `scrollIntoView` on a child row often no-ops because the row isn't yet mounted.

## scrollIntoView (DOM-based)

```js
await session.Runtime.evaluate({ expression: `
  document.querySelector('[data-row-id="42"]')?.scrollIntoView({ block: 'center', behavior: 'instant' })
`})
```

- `behavior: 'instant'` avoids the animation round-trip and your next action landing on old coordinates.
- Fails silently if the selector doesn't match — always verify with a screenshot.

## scrollTop / scrollLeft (blunt but reliable)

```js
await session.Runtime.evaluate({ expression: `
  const el = document.querySelector('.list-scroll-container')
  if (el) el.scrollTop = el.scrollHeight
`})
```

Use when:
- The container has custom `overflow: auto` and wheel events aren't reaching it.
- You need to jump to absolute offsets (top, bottom, "row N × rowHeight").

## Which container is consuming wheel events?

Sites with multiple nested scrollers (modals inside pages, lists inside cards) make "scroll the page" ambiguous. Find the actual scroller:

```js
await session.Runtime.evaluate({
  returnByValue: true,
  expression: `
    (() => {
      const out = []
      document.querySelectorAll('*').forEach(el => {
        const s = getComputedStyle(el)
        if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight)
          out.push({ tag: el.tagName, cls: el.className, h: el.clientHeight, scroll: el.scrollHeight })
      })
      return out
    })()
  `,
})
```

## Traps

- **`scroll-behavior: smooth`** in CSS makes everything animate — your `Input.dispatchMouseEvent` fires immediately, but the next coordinate click lands before the scroll finishes. Either set `behavior: 'instant'` on `scrollIntoView`, or `await new Promise(r => setTimeout(r, 400))` after wheeling.
- **Re-read element rects after opening a dropdown / modal** before coordinate-clicking. Layout shifts invalidate cached coords.
- **Wheel on a trackpad fires dozens of small delta events.** If a site's infinite-scroll sentinel requires momentum, a single `deltaY: 300` call may not trigger it — send several smaller wheels in a loop.
