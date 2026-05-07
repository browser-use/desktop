# Drag and Drop

Three kinds hide behind "drag and drop" — each wants a different CDP call.

## Kind 1: HTML5 DnD (`dragstart` / `drop` events)

React DnD, pragmatic-drag-and-drop, native `<div draggable>` — all listen to DOM `DragEvent`. CDP's `Input.dispatchMouseEvent` with mousePressed/moved/released does **not** fire these, because the browser synthesizes `DragEvent`s from a native OS drag that CDP doesn't trigger. Use `Input.dispatchDragEvent` instead:

```js
// Chrome needs to be told we're about to handle drags via CDP
await session.Input.setInterceptDrags({ enabled: true })

// Press at the source
await session.Input.dispatchMouseEvent({ type: 'mousePressed', x: srcX, y: srcY, button: 'left', clickCount: 1 })

// Wait for CDP to deliver the initial drag intent (via Input.dragIntercepted)
const di = await session.waitFor('Input.dragIntercepted', undefined, 2_000)

// Simulate the move + drop via dispatchDragEvent
await session.Input.dispatchDragEvent({ type: 'dragEnter', x: dstX, y: dstY, data: di.data })
await session.Input.dispatchDragEvent({ type: 'dragOver',  x: dstX, y: dstY, data: di.data })
await session.Input.dispatchDragEvent({ type: 'drop',      x: dstX, y: dstY, data: di.data })

await session.Input.dispatchMouseEvent({ type: 'mouseReleased', x: dstX, y: dstY, button: 'left', clickCount: 1 })
await session.Input.setInterceptDrags({ enabled: false })
```

This covers most real-world DnD on React/Vue apps (Trello cards, Notion blocks, Linear tickets, Figma layers).

## Kind 2: Pointer-based drag (canvas, SVG, custom handlers)

Games, map panning, Figma/Excalidraw canvases, range sliders — these listen for `mousedown` / `mousemove` / `mouseup` (or pointer events) and do their own coordinate math. For these, a plain mouse-event sequence is enough:

```js
await session.Input.dispatchMouseEvent({ type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 })
// Intermediate moves matter — many sites track velocity / only trigger on movement delta
for (let i = 1; i <= 10; i++) {
  const x = x1 + (x2 - x1) * (i / 10)
  const y = y1 + (y2 - y1) * (i / 10)
  await session.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y, button: 'left' })
}
await session.Input.dispatchMouseEvent({ type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 })
```

Add intermediate `mouseMoved` events — sites tracking velocity won't fire on a single jump.

## Kind 3: "Drag a file onto this zone" = actually upload

Most drop zones that accept files have a hidden `<input type="file">` under them. Use `DOM.setFileInputFiles` — see `uploads.md`. Don't fight the DnD path if an input exists.

## Traps

- **Don't use `Input.dispatchMouseEvent` alone for HTML5 DnD** — no `dragstart` fires. The site just sees a click that went nowhere. Use `setInterceptDrags` + `dispatchDragEvent`.
- **Don't use `Input.dispatchDragEvent` without `setInterceptDrags({ enabled: true })`** — Chrome routes the drag to the native OS otherwise.
- **Snap / animation**: after drop, re-screenshot after ~300ms. Some libraries animate the card into place and a too-fast follow-up action lands on the wrong coordinates.
- **Pointer Events vs Mouse Events**: if `mousedown` doesn't work, try `dispatchMouseEvent` with `pointerType: 'mouse'` and also include the same sequence as `dispatchPointerEvent` (some new SPAs only listen to pointer events).
