# Browser harness — SKILL

You are driving a specific Chromium browser view on the user's machine.
The browser is already open; your job is to drive it with short Node
scripts that use the helpers in `./helpers.js`.

## Your target

Two environment variables tell you which browser view to drive:

- `BU_TARGET_ID` — the CDP target id of your assigned view. **Use only this target.** Do not create new targets, switch to other targets, or navigate away from this one into internal Chrome pages (chrome://, devtools://).
- `BU_CDP_PORT` — the port Chromium's CDP is listening on (usually 9222).

## How to act

Write a Node script, run it with `node`, read the output. That's the loop.

```bash
node -e '
const H = require("./helpers.js");
(async () => {
  const ctx = await H.createContext();
  await H.goto(ctx, "https://example.com");
  await H.waitForLoad(ctx);
  console.log(JSON.stringify(await H.pageInfo(ctx)));
  await ctx.close();
})().catch(e => { console.error(e.message); process.exit(1); });
'
```

Always:
- Open exactly one context per script; close it before the script exits.
- `console.log` the data you need to reason from in the next step.
- Use `screenshot(ctx, '/tmp/shot.png')` when visual inspection helps, then `Read` the file.

## The helpers

`./helpers.js` is a plain Node library. Read it whenever you need to
remember what exists. The main exports:

- `createContext({ targetId?, port? })` — open a CDP session to your target. Defaults read `BU_TARGET_ID` / `BU_CDP_PORT`.
- `goto(ctx, url)` — navigate. Call `waitForLoad` after.
- `waitForLoad(ctx, timeoutSec?)` — poll until `document.readyState === 'complete'`.
- `pageInfo(ctx)` — `{url, title, w, h, sx, sy, pw, ph}`. Also returns `{dialog}` if an alert/confirm is blocking the JS thread.
- `click(ctx, x, y, button?, clicks?)` — **coordinate click**. Default interaction method. Passes through iframes/shadow at the compositor level.
- `typeText(ctx, text)` — insert text at the current caret (no key events).
- `pressKey(ctx, key, modifiers?)` — CDP key event. `modifiers` bitfield: 1=Alt, 2=Ctrl, 4=Cmd, 8=Shift.
- `dispatchKey(ctx, selector, key?, event?)` — dispatch a DOM KeyboardEvent when `pressKey` isn't picked up by a listener.
- `scroll(ctx, x, y, dy?, dx?)` — wheel scroll at a point. `dy=-300` scrolls down.
- `js(ctx, expression)` — run JS in the page; returns the value (must be JSON-serializable).
- `reactSetValue(ctx, selector, value)` — native setter + `input`/`change` dispatch. Use when a React component ignores `type_text`.
- `uploadFile(ctx, selector, paths)` — `<input type="file">` via CDP.
- `captureDialogs(ctx)` / `dialogs(ctx)` — stub `alert/confirm/prompt` so they don't block the page thread.
- `httpGet(ctx, url)` — HTTP fetch, no browser.
- `screenshot(ctx, outPath?, full?)` — PNG. Write to a file with `outPath` so you can `Read` it back.

## Coordinate clicks before selector gymnastics

Prefer `click(x, y)` over JS-dispatched clicks. Most framework widgets
(MUI dropdowns, custom selects) respond to coordinate clicks but not to
`el.click()`. Use `js(ctx, "document.querySelector(...).getBoundingClientRect()")`
to get precise coords; do not eyeball from screenshots.

## Verify after every action

Re-screenshot or re-`pageInfo` after clicking, typing, navigating. Don't
assume an action worked.

## Self-healing

If a helper is missing, broken, or you need a new one:

1. Read `./helpers.js`.
2. Add the function (export it via `module.exports.yourFn = ...`).
3. Use it in the next script. It's live immediately because each `node -e`
   invocation re-reads the file.

Keep helpers short and composable. Every helper takes `ctx` as the first
arg.

## Known gotchas

- Chrome 144+ doesn't serve `/json/version` at `chrome://inspect` — use the port directly (`http://localhost:${BU_CDP_PORT}/json/list`).
- `alert()` / `confirm()` block the JS thread — call `captureDialogs(ctx)` **before** triggering them.
- capture_dialogs stubs reset on navigation — re-call after `goto`.
- React-controlled inputs ignore `el.value=...` — use `reactSetValue`.
- CDP `char` event doesn't fire DOM keypress for specials (Enter/Tab) — use `dispatchKey`.
- Same-origin nested iframes don't show up as CDP targets — walk `contentDocument` instead.
- Shadow DOM `querySelector` does **not** pierce — walk `element.shadowRoot` recursively.

## Domain skills (read-only reference)

`./domain-skills/` contains per-site playbooks pulled from
[browser-use/harnessless](https://github.com/browser-use/harnessless).
Before acting on a task for a specific site, check for a matching folder
(e.g. `./domain-skills/amazon/`, `./domain-skills/github/`) and read any
`.md` files you find there — they document selectors, flows, and gotchas
that are cheaper to reuse than to rediscover.

These files are **read-only**. They are fully overwritten from the bundle
on every app launch, so any edits you make will be lost. If you learn
something new about a site, add it to `helpers.js` or a comment there
instead.

## Uploads and outputs

- **Uploads**: if the user attached files, they appear in the seed prompt with
  paths under `./uploads/<session_id>/`. Read each with your `Read` tool
  before acting on the task. Images and PDFs are natively supported.
- **Outputs**: when the user asks you to produce a file (a report, CSV,
  screenshot, transcript, edited image, etc.), save it to
  `./outputs/<session_id>/` with a clear filename. The app watches that
  directory and surfaces each new file in the UI with a button to open it.
  Mention the filename in your final answer.

## Done

Say what you accomplished when the user's task is complete. Short,
user-facing. No narration of every step.
