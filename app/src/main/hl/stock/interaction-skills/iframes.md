# Iframes (same-origin)

Same-origin iframes are just part of the parent DOM — you can walk into them via `contentDocument`. For cross-origin (OOPIFs), see `cross-origin-iframes.md`.

## Reading / writing through `contentDocument`

```js
await session.Runtime.evaluate({
  returnByValue: true,
  expression: `
    (() => {
      const doc = document.querySelector('iframe#inner').contentDocument
      return doc.querySelector('h1').textContent
    })()
  `,
})
```

- Throws `DOMException: Blocked a frame with origin …` if the frame is actually cross-origin. That's your signal to switch to OOPIF routing.
- `contentWindow.postMessage` works from the parent if you need to send data in.

## Coordinate clicks pass through iframes

The compositor-level input path (`Input.dispatchMouseEvent`) doesn't care about frame boundaries. If you can see a button in a screenshot, you can click its page coordinates regardless of how many iframes it's nested in:

```js
await session.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
await session.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
```

This is usually the **lowest-friction** approach. Only drop to `contentDocument` / OOPIF attach when you need to read DOM or dispatch DOM events on elements that are hard to target by coordinate.

## Frame-local vs page coordinates

`getBoundingClientRect()` inside an iframe returns **iframe-local** coordinates. To coordinate-click, you need page coordinates:

```js
await session.Runtime.evaluate({
  returnByValue: true,
  expression: `
    (() => {
      const iframe = document.querySelector('iframe#inner')
      const inner = iframe.contentDocument.querySelector('.target')
      const iRect = iframe.getBoundingClientRect()
      const tRect = inner.getBoundingClientRect()
      return { x: iRect.x + tRect.x + tRect.width/2, y: iRect.y + tRect.y + tRect.height/2 }
    })()
  `,
})
```

## Nested iframes

Recurse through `contentDocument`:

```js
let doc = document
for (const sel of ['iframe#outer', 'iframe#middle', 'iframe#inner']) {
  doc = doc.querySelector(sel).contentDocument
  if (!doc) throw new Error('cross-origin boundary')
}
return doc.querySelector('h1').textContent
```

## Traps

- A frame that was same-origin can become cross-origin after navigation inside it (e.g. OAuth redirect). Re-check with `contentDocument` truthiness.
- `iframe.contentDocument === null` right after insertion — wait for `load` on the iframe before reading.
- CSP `frame-ancestors`/`sandbox="allow-same-origin"` can block `contentDocument` access even when origins match.
