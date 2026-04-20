# Dialogs (alert / confirm / prompt / beforeunload)

Native browser dialogs freeze the page's JS thread until dismissed. This means `js()`, `page_info()`, and any Runtime.evaluate call will hang.

## Detection

`page_info()` checks for pending `Page.javascriptDialogOpening` events and returns `{dialog: {type, message}}` instead of the normal viewport info. Always check `page_info()` first if you suspect a dialog.

## Prevention (JS-stub approach)

Call `capture_dialogs()` BEFORE the action that might trigger a dialog. This replaces `window.alert/confirm/prompt` with stubs that collect messages into `window.__dialogs__`.

Read captured messages with `dialogs()`.

Stubs are lost on page navigation — re-call `capture_dialogs()` after any `goto()`.

## Dismissal (CDP approach)

If a native dialog is already open, dismiss it via raw CDP:

```
cdp("Page.handleJavaScriptDialog", {accept: true})
cdp("Page.handleJavaScriptDialog", {accept: false})  // for cancel
cdp("Page.handleJavaScriptDialog", {accept: true, promptText: "answer"})  // for prompt
```

## beforeunload

`beforeunload` dialogs appear when navigating away from a page with unsaved changes. They cannot be stubbed via JS. Use the CDP approach above.
