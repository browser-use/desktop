# example.com

Created as part of a harness self-edit test.

## What the site is
`example.com` is an IANA-reserved domain used in documentation and examples.
It serves a single static HTML page with no JS, no auth, no forms.

## Stable facts
- URL: `https://example.com/`
- Returns 200 with a tiny `<h1>Example Domain</h1>` page.
- `http_get("https://example.com/")` is strictly faster than loading in a tab.
- No rate limiting observed for casual use, but don't hammer it — it's run by IANA.

## Useful as
- A smoke-test target for `goto` / `http_get` / `wait_for_load`.
- A neutral "does navigation work?" check that won't trigger bot detection.

## Traps
- None. If it ever stops returning 200, something is very wrong with the internet
  or with your network, not with the agent.
