# Legacy Harness Self-Edit Test

Historical notes from the pre-`browser-harness-js` helper/`TOOLS.json` harness.
This is not runtime guidance for app-spawned agents.

Browser Harness JS should cover normal browser automation. Treat harness edits
as an escape hatch only when the user explicitly asks for them, or when a
confirmed harness/runtime defect blocks the task.

## Files that matter

- `helpers.js` — now a small compatibility bridge to `browser-harness-js`, not
  a normal extension surface.
- `AGENTS.md` — the app-specific browser harness manual.
- `browser-harness-js/` — bundled runtime; app launches may replace it.

## Legacy notes

The old model used `helpers.js` implementations plus `TOOLS.json` schemas.
That model has been removed from the desktop runtime. Do not revive it for
ordinary browser tasks.

## If an edit is unavoidable

- Keep the patch minimal and task-scoped.
- Prefer fixing app source stock files over editing generated userData copies.
- Mention the edited file and reason in the final answer.
