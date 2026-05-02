# LinkedIn notifications

URL: https://www.linkedin.com/notifications/

## Scraping notifications

Cards are rendered as `main li` (also matchable via `.nt-card`). Each card's `innerText` contains:
- Leading `"Unread notification. "` prefix for unread items (strip it)
- Leading `"Status is reachable "` prefix for some cards (strip it)
- The headline (e.g. "X and N others reacted to your post")
- Then the full quoted post body / comment text — can be very long

The headline is the first sentence. Split on `/\.\s/` **after** stripping the "Unread notification." prefix, otherwise you get an empty string.

```js
const cards = document.querySelectorAll('main li');
const out = [];
const seen = new Set();
cards.forEach(el => {
  const full = el.innerText.replace(/\s+/g,' ').trim();
  if (full.length < 20) return;
  let s = full.replace(/^Unread notification\.\s*/,'').replace(/^Status is reachable\s*/,'');
  const headline = s.split(/\.\s/)[0];
  if (seen.has(headline)) return;
  seen.add(headline);
  const time = el.querySelector('time')?.innerText?.trim() || '';
  out.push({ headline, time });
});
```

## Trap: tool output truncation

This harness's `js()` return appears to cap string output around ~250 chars per "line"/item. Full card text (which includes the quoted post) gets truncated. Two workarounds:
- Stash the array on `window.__foo__` and read individual short fields
- Extract just the headline (short — usually <150 chars) instead of full innerText
