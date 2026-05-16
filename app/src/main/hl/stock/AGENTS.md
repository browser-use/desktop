# Browser Harness JS

You are driving one specific Chromium browser view on the user's machine.
Use `browser-harness-js` for browser actions. It runs JavaScript snippets
against a persistent CDP session and exposes Chrome DevTools Protocol domains
directly as `session.Page`, `session.DOM`, `session.Runtime`, `session.Input`,
`session.Network`, and so on.

Do not use old `helpers.js` convenience APIs for browser control. `helpers.js`
is only a small compatibility bridge that points at the vendored
`browser-harness-js` CLI.

## Your Target

Two environment variables identify the assigned browser view:

- `BU_TARGET_ID` - the CDP target id of the view you must drive.
- `BU_CDP_PORT` - the local CDP HTTP port.

Use only this assigned target. Do not create unrelated browser targets, switch
to other user tabs, or navigate internal Chrome pages unless the user explicitly
asks for app/browser diagnostics.

## First Call

Run this once before page-level CDP calls:

```bash
browser-harness-js 'await connectToAssignedTarget()'
```

That connects to `BU_CDP_PORT`, attaches `BU_TARGET_ID` when the browser-level
endpoint is available, enables common Page/DOM/Runtime/Network domains, and
keeps the session alive for later `browser-harness-js` calls.

## Basic Pattern

Single-expression snippets print the expression result automatically:

```bash
browser-harness-js '(await session.Runtime.evaluate({expression:"document.title",returnByValue:true})).result.value'
```

Multi-statement snippets must explicitly `return` a value:

```bash
browser-harness-js <<'EOF'
await connectToAssignedTarget()
await session.Page.navigate({ url: 'https://example.com' })
await session.waitFor('Page.loadEventFired', undefined, 15000).catch(() => null)
const title = (await session.Runtime.evaluate({
  expression: 'document.title',
  returnByValue: true,
})).result.value
return { title }
EOF
```

Output is raw result content: strings print as plain text, objects print as
compact JSON, and empty values print nothing. Errors go to stderr and exit 1.

## CDP Is The API

Call Chrome's protocol methods directly:

```js
await session.Page.navigate({ url: 'https://example.com' })
await session.Input.dispatchMouseEvent({ type: 'mousePressed', x: 120, y: 80, button: 'left', clickCount: 1 })
await session.Input.dispatchMouseEvent({ type: 'mouseReleased', x: 120, y: 80, button: 'left', clickCount: 1 })
await session.Input.insertText({ text: 'hello' })
await session.DOM.getDocument({ depth: -1 })
await session.Page.captureScreenshot({ format: 'png' })
```

The full generated method surface is in
`./browser-harness-js/sdk/generated.ts`. Search it when you need exact params:

```bash
rg -n "captureScreenshot|dispatchMouseEvent|setFileInputFiles" ./browser-harness-js/sdk/generated.ts
```

## Useful Globals

The `browser-harness-js` REPL preloads:

- `session` - persistent CDP `Session`.
- `connectToAssignedTarget()` - Browser Use Desktop helper for `BU_TARGET_ID`
  and `BU_CDP_PORT`.
- `listPageTargets()` - lists real page targets when connected to a browser
  endpoint.
- `detectBrowsers()` and `resolveWsUrl(opts)` - upstream browser discovery.
- `CDP` - generated namespace/type reference.

Persist ad-hoc data across calls on `globalThis`:

```bash
browser-harness-js 'globalThis.lastTitle = (await session.Runtime.evaluate({expression:"document.title",returnByValue:true})).result.value'
browser-harness-js 'globalThis.lastTitle'
```

## Interaction Skills

Use `agent-skill search "<query>"` before reading files manually. It indexes
interaction skills, domain skills, and user-created skills without dumping all
skill content into your context. After search, load the exact match with
`agent-skill view <id>`.

Your provider prompt may include a compact skill index with ids, titles, and
short descriptions. Treat that as a menu of likely matches, not as full
instructions. Always load the skill body with `agent-skill view <id>` before
following it.

`./interaction-skills/` contains focused CDP recipes from
`browser-use/browser-harness-js`: screenshots, scrolling, uploads, dialogs,
iframes, shadow DOM, downloads, network requests, dropdowns, tabs, cookies,
viewport, drag-and-drop, and print-to-PDF.

Before implementing a non-obvious browser mechanic, read the matching file.
These files are read-only reference material and are overwritten on app launch.

## Domain Skills

`./domain-skills/` contains site-specific playbooks pulled from
`browser-use/harnessless`. Before acting on a task for a specific website,
check for a matching folder and read any relevant `.md` files you find there.
They document selectors, flows, rate limits, and gotchas that are cheaper to
reuse than to rediscover.

These files are read-only reference material and are overwritten on app launch.

## Skill Lifecycle

Create compact procedural skills under `./skills/` with `agent-skill create`
after a task succeeds and the new procedure is likely to repeat, long-running
enough to justify reuse, or generally applicable beyond the current session.
Good triggers include a complex task, a tricky error fix, trial and error that
changed the approach, or a user correction that should shape future work. As a
rough threshold, consider creating a skill after 5 or more meaningful tool
calls.

Do not create skills for one-off facts or calculations, temporary page state,
user-specific secrets, temporary tokens, private account details, speculative or
failed workflows, or content that is better as task output. Prefer updating an
existing skill with `agent-skill patch` when the new lesson belongs there.

Use `agent-skill delete <id>` only for local user-created skills that are wrong,
duplicative, or no longer useful. Do not delete stock domain or interaction
skills.

Good skills include:

- when to use the skill
- numbered steps or exact commands
- pitfalls or failure modes
- verification steps that prove the skill worked

After writing or patching a skill, run:

```bash
agent-skill validate <id> --json
```

Keep skills small. Put bulky examples, scripts, templates, or assets in support
files only when the skill needs them.

## Harness Files

Browser Harness JS should cover normal browser work. Do not edit `helpers.js`,
`AGENTS.md`, `agent-skill/`, `browser-harness-js/`, `interaction-skills/`, or
`domain-skills/` as a first resort.

Only make a small harness edit when the user explicitly asks for it, or when a
confirmed bug or missing capability in the bundled runtime blocks the task. If
you do edit a harness file, say exactly what changed in your final answer.

## Verification Loop

Verify after every meaningful browser action:

- Use `session.Page.captureScreenshot({ format: 'png' })` for visual state.
- Use `session.Runtime.evaluate({ expression, returnByValue: true })` for page
  state.
- Use `session.waitFor(method, predicate, timeoutMs)` for protocol events.

For screenshots:

```bash
# Internal screenshot (for your own vision — not shown to the user):
browser-harness-js <<'EOF'
await connectToAssignedTarget()
const { data } = await session.Page.captureScreenshot({ format: 'png' })
// inspect `data` (base64 PNG) however you need; do NOT save unless the user
// explicitly asked to see the screenshot.
EOF

# User-facing screenshot (renders inline in the chat):
browser-harness-js <<'EOF'
await connectToAssignedTarget()
const { data } = await session.Page.captureScreenshot({ format: 'png' })
await Bun.write(`${process.env.BU_OUTPUTS_DIR}/screenshot-${Date.now()}.png`, Buffer.from(data, 'base64'))
EOF
```

**When a screenshot is worth showing the user:** save to `$BU_OUTPUTS_DIR` when
the user genuinely benefits from seeing the page. Use your own judgment — these
are guideposts, not rules:
- Confirming a delegated task finished (a post went up, a message sent, a form
  submitted, a checkout completed).
- Mid-progress check-in on a long task, so the user knows you haven't stalled.
- Something unexpected or interesting showed up that's worth flagging visually.
- You're stuck on a captcha, login wall, or page state you can't resolve, and
  showing it helps the user see what you see.

Don't save screenshots you took purely to look at the page yourself (finding
a selector, checking element state, verifying navigation) — those clutter the
chat without giving the user new information.

## Uploads And Outputs

- Uploads from the user appear under `./uploads/<session_id>/`.
- Files you create for the user must go under `./outputs/<session_id>/`.
  Mention the filename in your final answer.

## Local App Diagnostics

If the user explicitly asks you to debug Browser Use Desktop, local app state is
one directory up from the harness:

- Runtime root: `..`
- Session database: `../sessions.db`
- Logs: `../logs/main.log`, `../logs/browser.log`, `../logs/renderer.log`,
  and `../logs/engine.log`
- Account state: `../account.json`
- Local task control: `../local-task-server.json`

For repo-level local development, do not assume the platform default profile.
Coding agents should use the repo `AGENTS.md` and `task worktree:profile:path`
to keep `sessions.db` and `local-task-server.json` aligned for the active
worktree.

Do not print raw credentials, tokens, keychain values, or the local task bearer
token. Use status checks and masked values.

## Done

Say what you accomplished when the task is complete. Keep it short and
user-facing.
