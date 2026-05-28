# Iframe block — embed a live URL inline in chat

When the user needs to interact with a real remote document inside the
chat (a reCAPTCHA bframe, a Stripe checkout step, a third-party OAuth
consent screen, etc.), emit a fenced ` ```iframe ` block carrying the
URL. The renderer mounts a sandboxed `<iframe src="...">` directly in
the chat turn; the user does the interaction in-place; when they click
the foot button you receive `Iframe interaction complete.` (or
`Iframe skipped.`) as a new user turn.

## When this is the right tool

Use ` ```iframe ` when the user needs to interact with a page whose
backing session lives in **the renderer's webview**, not the agent's
browser. The embedded frame loads with the renderer's cookies and
origin context — it is **not** the same browsing session the agent
is driving over CDP.

Concretely:
- ✅ Show the user a public form, demo, or marketing flow you want
  them to walk through visually.
- ✅ Show the user an OAuth/SSO screen that they'll authenticate in
  *for the renderer*, leaving cookies there.
- ❌ **Don't use this for reCAPTCHA.** Empirically verified — the
  bframe URL loads in our renderer (Google sets no `X-Frame-Options`
  and no `frame-ancestors` restriction), but it renders **completely
  blank**: just the bootstrap `<script>` plus an empty `<div></div>`.
  The challenge UI is populated by `postMessage` events from the
  matching anchor iframe on the *original* host, which we don't
  reproduce. The user sees a blank box. For captcha challenges use
  ` ```capture ` (capture-block.md) — it screenshots and proxies
  clicks back to the agent's browser, keeping the live session
  intact.
- ❌ Don't use this for sites with `X-Frame-Options: DENY` or
  `frame-ancestors 'none'` — they will refuse to load.

## Fields

| field         | required | notes |
|---------------|----------|-------|
| `url`         | **yes**  | Absolute `https://` URL. The renderer rejects non-http(s) URLs. |
| `prompt`      | recommended | One-line instruction shown above the frame ("Sign in to GitHub so we can continue."). |
| `width`       | optional | CSS pixels. Default 400, clamped to [200, 1200]. |
| `height`      | optional | CSS pixels. Default 500, clamped to [200, 900]. |
| `submitLabel` | optional | Foot-button text. Default `"I'm done"`. |

## Emit the fence

```
```iframe
{
  "url": "https://accounts.google.com/o/oauth2/...",
  "prompt": "Approve the consent screen so the agent can continue.",
  "width": 480,
  "height": 600,
  "submitLabel": "I've approved"
}
```
```

Then **stop**. No more tool calls. Wait for the user reply, which will
be exactly one of:

> Iframe interaction complete.

> Iframe skipped.

Use that to decide what to do next — typically re-query the live page
to confirm whatever state change you were hoping for.

## What the renderer actually does

- Mounts `<iframe src="<url>" sandbox="allow-scripts allow-same-origin
  allow-forms allow-popups" referrerPolicy="no-referrer-when-downgrade">`
  inside the chat turn.
- Renders a "loading…" overlay until the frame fires `onLoad`.
- Cannot read the iframe's DOM (same-origin sandbox + cross-origin
  document = no `contentDocument` access). The agent learns *that*
  the user clicked the foot button, not *what they did*.
- The chat renderer's CSP allows `frame-src 'self' https:`. Plain
  `http://` URLs are blocked.

## Limits to be aware of

- **Different session from the agent's browser.** Cookies set inside
  the iframe live in the renderer's webview partition, not the
  Chromium instance the agent drives over CDP. Don't expect cookies
  set here to affect the agent's tab.
- **Some sites refuse to be framed.** If you see the frame stay blank
  past a few seconds, the target almost certainly has
  `X-Frame-Options: DENY` (or `SAMEORIGIN`) or a `frame-ancestors`
  CSP directive that excludes our app's origin. There's no recovery
  — fall back to ` ```capture ` (for image challenges), or open the
  URL in the agent's tab and use coordinate clicks.
- **postMessage from inside the iframe is invisible to the agent.**
  If the remote site signals completion via `window.parent.postMessage`,
  *the renderer* receives it — the agent does not. You only learn
  about completion via the user clicking the foot button.

## Banned

- Plain `http://` URLs. Renderer rejects anything that isn't `https://`.
- Multiple `iframe` fences in one turn. One inline frame at a time
  keeps the chat readable.
- Using ` ```iframe ` for reCAPTCHA — covered above. Use the capture
  block instead.
