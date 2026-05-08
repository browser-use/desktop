# Cross-Origin Iframes (OOPIFs)

Cross-origin iframes (stripe.com checkout, recaptcha, Salesforce Lightning, Azure blades) run in **out-of-process iframes (OOPIFs)** with their own CDP target. You cannot reach them via `contentDocument` from the parent.

## First try: coordinate clicks

Compositor-level input passes through OOPIFs transparently. If the thing you want is a button you can see in a screenshot, try this first — it's simpler, undetectable, and doesn't need attaching to anything:

```js
// Click a "Pay" button inside a Stripe iframe by page coordinates
await session.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
await session.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
```

Coordinate-based typing also works if you click first, then `Input.insertText`/`Input.dispatchKeyEvent`.

## When you need DOM inside the OOPIF

Find the iframe target and route Runtime/DOM calls to it:

```js
const { targetInfos } = await session.Target.getTargets({})
const iframe = targetInfos.find(t => t.type === 'iframe' && t.url.includes('stripe.com'))

// Route subsequent calls to the iframe target
await session.use(iframe.targetId)

await session.Runtime.enable()
const { result } = await session.Runtime.evaluate({
  expression: 'document.querySelector("[name=cardnumber]").value',
  returnByValue: true,
})

// Switch back to the parent page when done
await session.use(parentTargetId)
```

`session.use(iframe.targetId)` auto-attaches if not already attached, and routes Page/DOM/Runtime/Network to it. `Target.*` and `Browser.*` always hit the browser endpoint regardless of `use`.

## Which target is which?

`Target.getTargets` returns **all** OOPIFs in the page, flat. If multiple iframes share an origin (e.g. multiple Stripe Elements), you need more than URL to disambiguate:

- Filter by URL path (`cardNumber` vs `cardExpiry` vs `cvc` in Stripe).
- Enumerate in DOM order from the parent: find all `<iframe>` elements, map their `src` to target URLs.
- Inspect title via `Target.getTargetInfo({ targetId })`.

## Listening to events from an OOPIF

After `session.use(iframe.targetId)`, events for that target arrive via the same `session.onEvent` / `session.waitFor`:

```js
await session.use(iframe.targetId)
await session.Network.enable({})
const ev = await session.waitFor(
  'Network.responseReceived',
  (p) => p.response.url.includes('/confirm_payment'),
  10_000
)
```

## Traps

- **An OOPIF is not always present until interaction.** Stripe's card iframe is lazy-mounted after you focus the outer input. Screenshot + coordinate-click the outer input first, then re-query `Target.getTargets`.
- **OOPIF targets disappear when the parent navigates.** A cached `iframe.targetId` from before a navigation is dead.
- **CSP / sandbox may block `Runtime.evaluate` side effects** even when you've attached. Read-only calls usually work; writes may silently no-op.
- **Don't `use(iframe.targetId)` and forget to switch back.** Your next `Page.navigate` goes to the iframe instead of the main frame. Always pair with a `session.use(parentTargetId)`.
