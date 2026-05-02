# LinkedIn: send a DM to a profile

## Flow that works
1. Find the profile: `https://www.linkedin.com/search/results/people/?keywords=<Name%20URL%20encoded>` then scrape `a[href*="/in/"]` — first is usually the top result. Text includes "• 1st"/"2nd" connection degree.
2. Go to the profile `https://www.linkedin.com/in/<handle>/`.
3. The "Message" button on a profile is an `<a>` (not button). Its href is the compose deeplink:
   `https://www.linkedin.com/messaging/compose/?profileUrn=urn%3Ali%3Afsd_profile%3A<id>&recipient=<id>&screenContext=NON_SELF_PROFILE_VIEW&interop=msgOverlay`
   The `interop=msgOverlay` opens a bubble overlay; sometimes clicks on it don't register (viewport size / offscreen). More reliable: **navigate directly to the compose URL** — this opens full-page messaging with the recipient chip prefilled.
4. Composer: `.msg-form__contenteditable` (contenteditable, aria-label="Write a message…").
   - Coordinate-click the center of its rect, then `type_text`. Clicking off-center (e.g. `r.x+20`) sometimes doesn't focus — use exact center.
5. Send: find `<button>` whose `innerText.trim() === 'Send'` (skip "Open send options"). `btn.click()` works.
6. After send, URL changes to `/messaging/thread/<id>/` and the editor clears — that's the success signal.

## Gotchas
- LinkedIn's viewport sometimes reports tiny (745x344) right after `new_tab` + `wait_for_load`; wait ~2s or do a no-op `page_info` before real clicks.
- `type_text` without focus is a silent no-op; always verify by reading `.msg-form__contenteditable`.innerText after typing.
- The "Message" button click sometimes fails to open the overlay — fallback is direct goto to the compose URL extracted from the button's href.
