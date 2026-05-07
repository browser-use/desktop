# Dropdowns

The right approach depends on what kind of dropdown the site actually rendered.

## Native `<select>`

Don't click options — set the value directly and fire `change`. Keyboard/mouse on a native select opens an OS menu CDP can't close.

```js
await session.Runtime.evaluate({ expression: `
  (() => {
    const s = document.querySelector('select#country')
    s.value = 'DE'
    s.dispatchEvent(new Event('change', { bubbles: true }))
  })()
`})
```

Verify: `await session.Runtime.evaluate({ expression: 'document.querySelector("select#country").value', returnByValue: true })`.

## Custom overlay (div-based menu under a trigger)

1. Click the trigger with `Input.dispatchMouseEvent`.
2. **Re-measure** — options appear late, sometimes inside a portal attached to `<body>`.
3. Click the option by visible text.

```js
// Click the trigger
await session.Input.dispatchMouseEvent({ type: 'mousePressed', x: triggerX, y: triggerY, button: 'left', clickCount: 1 })
await session.Input.dispatchMouseEvent({ type: 'mouseReleased', x: triggerX, y: triggerY, button: 'left', clickCount: 1 })

// Wait one frame, then find the option by text and coordinate-click it
const { result } = await session.Runtime.evaluate({
  returnByValue: true,
  expression: `
    (() => {
      const t = [...document.querySelectorAll('[role="option"], li, .menu-item')]
        .find(el => el.textContent.trim() === 'Germany')
      if (!t) return null
      const r = t.getBoundingClientRect()
      return { x: r.x + r.width/2, y: r.y + r.height/2 }
    })()
  `,
})
if (result.value) {
  const { x, y } = result.value
  await session.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await session.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
```

## Searchable combobox (React / Downshift / Radix / MUI Autocomplete)

Most comboboxes commit on the **keyboard**, not the click:

1. Click the input to focus + open.
2. `Input.insertText` the search string.
3. Wait for options to render.
4. `Input.dispatchKeyEvent` ArrowDown → Enter to commit.

```js
await session.Input.dispatchKeyEvent({ type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
await session.Input.dispatchKeyEvent({ type: 'keyUp',   key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
await session.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Enter',     code: 'Enter',     windowsVirtualKeyCode: 13, text: '\r' })
await session.Input.dispatchKeyEvent({ type: 'keyUp',   key: 'Enter',     code: 'Enter',     windowsVirtualKeyCode: 13 })
```

Some libraries (notably Radix) require `Escape` to close without committing. Clicking outside may keep stale input.

## Virtualized menus

Long option lists (`react-window`, TanStack Virtual) only render the visible slice. If your option isn't in the DOM, scroll the menu container with a `mouseWheel` at its coordinates (see `scrolling.md`) until it mounts, **then** coordinate-click.

## Traps

- Always **re-measure after opening** — the trigger's on-screen position may shift when the menu appears (dropdowns that push content).
- Portals: the option DOM may not be a descendant of the trigger. Search `document.querySelectorAll`, not `trigger.querySelectorAll`.
- MUI Autocomplete: `blur` commits the text value, not the selected option. Always use Enter.
- CSS `pointer-events: none` on the option means the click passes through — check for an inner `<span>` or the option container a level up.
