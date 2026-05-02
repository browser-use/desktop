# LinkedIn Invitation Manager scraping

URL: https://www.linkedin.com/mynetwork/invitation-manager/received/

## Layout
- The **scrollable container is `<main>`**, not `window`. `window.scrollTo` does nothing; use `document.querySelector('main').scrollTo(0, scrollHeight)` to paginate.
- LinkedIn uses hashed/obfuscated class names (no stable `.invitation-card` selector). `[data-view-name]` attrs are also absent on this page as of 2024-11.
- To find invitation cards reliably: walk all `div|section|li|article`, keep leaf elements that:
  - contain 1–3 `a[href*="/in/"]` links
  - `innerText.length` in [50, 500]
  - no nested descendant that itself matches the same test (ensures we pick the tightest card, not a wrapper that concatenates multiple people — a naive parent-walk grabs the previous card's text).
- The first `/in/` anchor inside a card is the person's profile link; its `innerText` is the name.

## "Show more" pagination
- After scrolling to the bottom, look for `button` whose innerText matches `/show more/i`. Click it, wait ~1.5s, scroll again. Loop until no button.
- Total scrollHeight of main ~10k px for ~60 invitations.

## Card text shape
`{Name} {Name} {Title/headline} {Mutual connection phrase} {timestamp} Ignore Accept`
Sometimes prefixed with `{Name} follows you and is inviting you to connect` (twice, duplicated).

Mutual connection phrases:
- `<FirstName LastName> and <N> other mutual connections`
- `<FirstName LastName> is a mutual connection`
- rare: `<N> mutual connections`

Timestamp suffixes: `Yesterday`, `N hours ago`, `N days ago`, `N week ago`, or compact `1w`/`3d`.

## Harness gotcha
`js()` and `read_file`/`shell` stdout get truncated around ~250 chars in the tool response. For big payloads use the `js_to_file` helper (writes returnByValue to disk), then read with python in shell and print short summaries per-row.
