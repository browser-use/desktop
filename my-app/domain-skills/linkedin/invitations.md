# LinkedIn invitation manager

URL: https://www.linkedin.com/mynetwork/invitation-manager/

## Accepting connection requests

Each invitation row exposes a button with `aria-label="Accept <Name>'s invitation"`.
Selector: `button[aria-label^="Accept"]`

Invitations are listed in recency order (newest first), so `.slice(0, N)` accepts the N most recent.

Clicking triggers an in-page XHR and swaps the row to a "message" CTA — no navigation, no confirm dialog. A short wait (~1s) is enough for the DOM to update.

Ignore buttons use `aria-label="Ignore <Name>'s invitation"`.
