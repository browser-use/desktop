# Print as PDF

Two completely different things the user may mean by "print to PDF":

## 1. Render the current page to a PDF (what you usually want)

```js
const { data } = await session.Page.printToPDF({
  printBackground: true,
  paperWidth: 8.5,           // inches
  paperHeight: 11,
  marginTop: 0.4,
  marginBottom: 0.4,
  marginLeft: 0.4,
  marginRight: 0.4,
  preferCSSPageSize: true,   // respect @page in the site's CSS if set
})
// Cross-platform temp dir: /tmp on Linux, /var/folders/… on macOS, %TEMP% on Windows
const { tmpdir } = await import('node:os')
await Bun.write(`${tmpdir()}/page.pdf`, Buffer.from(data, 'base64'))
```

Works **without** any visible print dialog — Chrome renders the PDF server-side in the process. Undetectable by the page.

Options worth knowing:
- `landscape: true` — flip orientation
- `displayHeaderFooter: true` + `headerTemplate` / `footerTemplate` — printed HTML (mustache-style variables: `{{pageNumber}}`, `{{totalPages}}`, `{{title}}`, `{{url}}`)
- `scale: 0.8` — shrink to fit
- `pageRanges: '1-3,7'` — subset of pages
- `transferMode: 'ReturnAsStream'` — for very large PDFs, returns a stream handle instead of a giant base64 blob

## 2. The site has a "Print" button that opens a real print dialog

Some sites call `window.print()` and rely on the user picking "Save as PDF" in the OS dialog. CDP **cannot** interact with the OS print dialog.

Two ways around it:

### A. Intercept `window.print` before the click

```js
await session.Runtime.evaluate({ expression: `
  window.print = () => {
    window.dispatchEvent(new Event('beforeprint'))
    window.__printed__ = true
  }
`})
// Click the site's Print button — the call is now a no-op
// Then generate the PDF yourself:
```
Follow with `session.Page.printToPDF(...)` from option 1.

Detectable by `window.print.toString()` — fine for most sites, risky for antibot.

### B. Use the underlying URL

Often the Print button just navigates to a print-friendly URL like `/invoice/123?print=1`. Find it with DevTools, then:

```js
await session.Page.navigate({ url: 'https://example.com/invoice/123?print=1' })
// ...wait for load...
await session.Page.printToPDF({ printBackground: true })
```

## Traps

- **`printBackground: false` (default) skips background colors and images.** Invoices, receipts, and anything design-heavy look empty without it — turn it on unless you specifically want the "clean print" look.
- **`Page.printToPDF` uses its own print-media CSS** (`@media print`). If the page hides elements with `display: none` under `@media print`, they'll be missing from your PDF. Override with `Emulation.setEmulatedMedia({ media: 'screen' })` first.
- **Very large pages** (long reports, data tables) can hit Chrome's internal PDF size limits and fail silently. Split by `pageRanges` or reduce `scale`.
- **Fonts may substitute.** Chrome uses system fonts for PDF rendering — if the site uses a webfont that isn't loaded at capture time, your PDF gets the fallback.
