# Sidebar real data — schema + backend plan

## What already exists

- **SessionStatus** in `shared/session-schemas.ts`: `draft | running | stuck | idle | stopped`. No change needed — sidebar already groups these correctly.
- **sessions table** (SessionDb.ts): `id, prompt, status, created_at, updated_at, error, group_name, hidden, messages, origin_channel, origin_conversation_id`. `updated_at` is touched on every write (status change, hide/unhide, etc.) so it already represents "last activity" — no new column needed.
- **Tool_call events** (hl/agent.ts:322): `onEvent({ type: 'tool_call', name, args, iteration })`. Navigation tools pass `{ url }` in `args` (see `helpers.js:46` — `cdp(ctx, 'Page.navigate', { url })`).
- **DB_SCHEMA_VERSION**: currently 6.

## What's missing

1. **`primary_site`** column on sessions — per-session domain for the sidebar favicon.
2. **`primarySite` / `lastActivityAt`** on the `AgentSession` zod schema + renderer types.
3. **Tracker** in `SessionManager` that extracts registrable domain from navigation tool calls and writes it back to the DB only when domain changes.

## Phase 1 — Schema

- Bump `DB_SCHEMA_VERSION` 6 → 7 in `sessions/db-constants.ts`.
- New migration block in `SessionDb.runMigrations`: `ALTER TABLE sessions ADD COLUMN primary_site TEXT`.
- Extend `SessionRow` interface with `primary_site: string | null`.
- Prepared statement `updatePrimarySite`: `UPDATE sessions SET primary_site = ?, updated_at = ? WHERE id = ?`.
- Public method `updatePrimarySite(id: string, site: string | null): void`.
- Extend zod `AgentSessionSchema` with `primarySite: string | null | undefined` and `lastActivityAt: number | undefined`.
- `rowToSession` (SessionManager.ts): map `row.primary_site` → `primarySite`, `row.updated_at` → `lastActivityAt`.

## Phase 2 — Backend tracking

- New file `src/main/sessions/domain.ts`:
  - `extractRegistrableDomain(url: string): string | null` — strips protocol/path, returns `example.com` style registrable domain (last 2 labels, or last 3 for known multi-part TLDs like `.co.uk`, `.com.br`, `.co.jp`).
- In `SessionManager` listener that already hooks `onEvent`:
  - When `event.type === 'tool_call'` and `args?.url` is a string, extract domain.
  - If domain differs from session's current `primarySite`, call `db.updatePrimarySite(id, domain)` and broadcast the updated session.
- Verbose logging: `mainLogger.info('SessionManager.primarySite.update', { id, from, to })`.

## Phase 3 — Renderer wiring

- Update `renderer/hub/types.ts` `AgentSession` with optional `primarySite` + `lastActivityAt`.
- `Sidebar.tsx`: drop `MOCK_SIDEBAR_SESSIONS` when real sessions are non-empty (already guarded).
- `HubApp.tsx`: pass `sessions` prop to `<Sidebar>` (not mock).

## Out of scope (explicitly deferred)

- Cross-session primary domain aggregation (e.g. "multi-tab" agents).
- Favicon caching/bundling — `google.com/s2/favicons` is fine for v1.
- Animated sidebar-group transitions when a session moves between Active ↔ Done.
