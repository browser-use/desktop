# Screenshots

Screenshots are the primary way to understand the current page state. Use them before and after every meaningful action.

## Usage

```
screenshot()              // viewport screenshot, saved to /tmp/shot.png
screenshot({full: true})  // full-page capture (captureBeyondViewport)
```

## When to screenshot

- **Before clicking**: to find visible targets and verify the page state
- **After clicking**: to verify the action worked (menu opened, form submitted, etc.)
- **After navigation**: to see what loaded
- **When stuck**: to understand what the page actually looks like vs. what you expect

## Coordinate accuracy

Screenshots render at device pixel ratio — coordinates from `getBoundingClientRect()` via `js()` are more reliable than eyeballing from the image. Always use `js()` for precise coordinates.

## Full-page captures

`screenshot({full: true})` captures the entire scrollable area. Useful for long pages, but the image may be very large. Prefer viewport screenshots + scrolling for interactive work.
