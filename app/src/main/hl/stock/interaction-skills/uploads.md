# Uploads

Never simulate clicks on `<input type="file">` — it opens the OS file picker, which CDP cannot dismiss. Set files directly via CDP instead.

## The canonical path

```js
await session.DOM.enable()
const { root } = await session.DOM.getDocument({ depth: -1 })
const { nodeId } = await session.DOM.querySelector({
  nodeId: root.nodeId,
  selector: 'input[type="file"]',
})
if (!nodeId) throw new Error('no file input found')

await session.DOM.setFileInputFiles({
  nodeId,
  files: ['/absolute/path/to/file.png'],
})
```

- Paths must be **absolute**.
- Multiple files: pass an array — only works if the input has `multiple`.
- Fires `change` on the input just like a real selection would.

## Hidden / off-screen file inputs

Sites commonly hide `<input type="file">` (display:none, visibility:hidden, positioned off-screen) and expose a styled button that calls `input.click()`. `DOM.setFileInputFiles` works **regardless of visibility** — find the input directly, don't click the button:

```js
// Works even for display:none / opacity:0 inputs
const { nodeIds } = await session.DOM.querySelectorAll({
  nodeId: root.nodeId,
  selector: 'input[type="file"]',
})
```

If `querySelector` returns `nodeId: 0`, the input is inside a shadow root or iframe — see `shadow-dom.md` / `iframes.md`.

## Drag-and-drop upload zones

React/Vue dropzones (`react-dropzone`, etc.) often only react to `drop` events and have no `<input>`. Two paths:

1. **Find the hidden input** — most dropzones still include one for accessibility. Inspect with `document.querySelectorAll('input[type=file]')` first.
2. **Synthesize a DOM drop event with a DataTransfer containing your File**:
   ```js
   await session.Runtime.evaluate({ awaitPromise: true, expression: `
     (async () => {
       const resp = await fetch('https://example.com/file.png')
       const blob = await resp.blob()
       const file = new File([blob], 'file.png', { type: 'image/png' })
       const dt = new DataTransfer()
       dt.items.add(file)
       const target = document.querySelector('.dropzone')
       for (const type of ['dragenter','dragover','drop']) {
         target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
       }
     })()
   `})
   ```
   Detectable by antibot — prefer path 1 if a hidden input exists.

## Verifying the upload fired

Listen for the `change` on the input, or watch the network via `Network.requestWillBeSent` for the upload POST. A screenshot alone often won't show that the file attached — use the network trace.
