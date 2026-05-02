# Harness self-edit test

Notes from a run where the agent was asked to modify its own tools.

## Files that matter

- `helpers.js` — tool implementations. Every helper is dispatched from the `module.exports.dispatch.<name>` object at the bottom. Adding a key there is enough to register a new tool.
- `TOOLS.json` — tool schemas exposed to the LLM. Must be valid JSON; validate with `node -e 'JSON.parse(require("fs").readFileSync(path))'` before trusting it.

## Adding a new tool

1. Write/append the handler in `helpers.js`. For trivial pure-JS tools you can inline the body directly in the dispatch map, e.g.
   ```js
   reverse_string: (_ctx, a) => ({ input: str(a, 'text'), reversed: str(a, 'text').split('').reverse().join('') }),
   ```
2. Add a matching entry to `TOOLS.json` (insert *before* the `done` entry — that's the conventional last tool).
3. Both files hot-reload on the next tool call; no restart needed.

## Arg validation helpers already in scope

- `str(a, 'key')` — required string
- `num(a, 'key')` — required finite number
- `optNum(a, 'key', default)` — optional number

Use them so bad LLM args produce clean errors instead of silent `undefined`.

## Gotchas

- Edits take effect on the *very next* tool call, so if you call the new tool in the same batch as the file write it will 404. Sequence the calls.
- `shell` output is sometimes truncated in the middle of long lines — prefer `awk 'NR>=A && NR<=B'` over `sed -n` and avoid piping through `cat -n` when inspecting.
- `patch_file` only replaces the first occurrence; make `old_str` unique.
