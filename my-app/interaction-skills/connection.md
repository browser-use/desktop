# Connection & Tab Visibility

## Startup sequence

1. `ensure_real_tab()` — attach to the user's current tab (skips chrome:// internals)
2. `page_info()` — confirm the tab is alive and get viewport dimensions
3. `screenshot()` — see what the user sees

## Tab marking

`switch_tab()` marks the active tab with a green dot in the title so the user can see which tab the agent controls. The dot is removed when switching away.

## Stale sessions

If `page_info()` or `js()` throws, the session is stale — the user closed or navigated the tab. Call `ensure_real_tab()` to re-attach. The event buffer may also contain `Target.targetDestroyed` events indicating tab closure.

## First navigation

Use `new_tab(url)` for first navigation, NOT `goto(url)` — `goto` navigates the user's active tab and clobbers their work. `new_tab` creates a fresh tab and switches to it.
