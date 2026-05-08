# Cookies

Use `Network.*` for cookies scoped to the attached page/context; use `Storage.getCookies` / `Storage.setCookies` for every cookie in the browser.

## Read

```js
await session.Network.enable({})

// All cookies visible to the attached page (current origin + its frames)
const { cookies } = await session.Network.getCookies({})

// Cookies for specific URLs
const { cookies: github } = await session.Network.getCookies({
  urls: ['https://github.com/'],
})

// Every cookie across the whole browser (requires Storage domain)
const { cookies: all } = await session.Storage.getCookies({})
```

Shape: `{ name, value, domain, path, expires, size, httpOnly, secure, session, sameSite?, sourceScheme?, priority? }`.

## Write

```js
// Single cookie on the attached page
await session.Network.setCookie({
  name: 'session',
  value: 'abc123',
  domain: '.example.com',
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'Lax',
  expires: Date.now() / 1000 + 86400,   // seconds since epoch
})

// Bulk import (e.g. to preload an auth session)
await session.Network.setCookies({
  cookies: [
    { name: 'a', value: '1', domain: '.example.com', path: '/' },
    { name: 'b', value: '2', domain: '.example.com', path: '/' },
  ],
})
```

## Delete / clear

```js
await session.Network.deleteCookies({ name: 'session', domain: '.example.com' })
await session.Network.clearBrowserCookies()   // nukes everything in the default context
```

## Gotchas

- `Network.setCookie` silently fails with no error if `domain` doesn't match any origin in the current profile — you'll get `{ success: true }` and the cookie just won't be there. Verify with `getCookies` after.
- `expires` is seconds (float), **not** milliseconds. A common mistake.
- Session cookies: pass no `expires` and Chrome treats them as session-scoped. Setting `expires: 0` also works.
- `sameSite` values are `'Strict'` | `'Lax'` | `'None'`. For `'None'`, Chrome also requires `secure: true`.
- Clearing cookies does NOT clear localStorage/IndexedDB. For a full logout, also call `Storage.clearDataForOrigin({ origin, storageTypes: 'all' })`.
