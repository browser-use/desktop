# Network Requests

Use `Network.*` events when the DOM doesn't tell you whether a request happened, what it sent, or what came back. Use `Fetch.*` when you need to intercept, modify, or mock.

## Watching requests

```js
await session.Network.enable({})

// React to every request
const off = session.onEvent((method, params) => {
  if (method === 'Network.requestWillBeSent') {
    console.log(params.request.method, params.request.url)
  }
  if (method === 'Network.responseReceived') {
    console.log(params.response.status, params.response.url)
  }
})

// ...do the action that should trigger the request...
off()
```

## Wait for a specific request

`session.waitFor` returns just the first matching event's params:

```js
await session.Network.enable({})
// (Trigger the action before awaiting, or trigger concurrently.)
const ev = await session.waitFor(
  'Network.responseReceived',
  (p) => p.response.url.includes('/api/submit') && p.response.status === 200,
  10_000
)
console.log(ev.response.status, ev.requestId)
```

## Read a response body

`Network.getResponseBody` needs the `requestId` — grab it from the matching event:

```js
const ev = await session.waitFor(
  'Network.responseReceived',
  (p) => p.response.url.endsWith('/me'),
  10_000
)
const { body, base64Encoded } = await session.Network.getResponseBody({ requestId: ev.requestId })
const text = base64Encoded ? Buffer.from(body, 'base64').toString('utf-8') : body
```

Bodies aren't always available — if the response was a redirect, was cached, or Chrome discarded it, `getResponseBody` throws. Read it **immediately** after `Network.loadingFinished`.

## Capture request bodies

`Network.requestWillBeSent` gives you `params.request.postData` (for small bodies); use `Network.getRequestPostData({ requestId })` for large ones.

## Intercept / modify / mock (`Fetch` domain)

When you need to change what's sent or returned:

```js
await session.Fetch.enable({
  patterns: [{ urlPattern: '*/api/flag*', requestStage: 'Response' }],
})

session.onEvent(async (method, params) => {
  if (method === 'Fetch.requestPaused') {
    // Mock the response
    await session.Fetch.fulfillRequest({
      requestId: params.requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'content-type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify({ enabled: true })).toString('base64'),
    })
  }
})
```

Alternatives per request:
- `session.Fetch.continueRequest({ requestId })` — pass through untouched.
- `session.Fetch.continueRequest({ requestId, url, method, postData, headers })` — modify in flight.
- `session.Fetch.failRequest({ requestId, errorReason: 'Failed' })` — simulate an error.

`Fetch.enable` disables the HTTP cache for matching URLs. Disable `Fetch` as soon as you're done.

## Cheap SPA "did the action succeed?" signal

Many SPAs mutate state without a visible DOM change. A request-based wait is the cleanest signal:

```js
await session.Network.enable({})
// click Save
await session.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
await session.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
await session.waitFor(
  'Network.responseReceived',
  (p) => p.response.url.includes('/save') && p.response.status === 200,
  10_000
)
```

## Traps

- **`Network.enable` must be called before the request fires.** If you enable after the click, you'll miss the event. Enable once at session start and leave it.
- **`Network.enable` is per-target.** After `session.use(iframe.targetId)`, call `Network.enable({})` again inside that target.
- **Request IDs are unique per target, not global.** Don't pass an iframe `requestId` to a main-frame `getResponseBody` call.
- **`waitFor` will reject on timeout**, not return `null`. Wrap in `try/catch` if you don't want the whole snippet to fail when the request doesn't happen.
