# Product Blueprint

Operational detail for Browser Use Desktop. Companion to `PRODUCT_SOUL.md`.

The soul doc holds direction and judgment. This doc holds shapes, flows, and
specifics. This one evolves as product decisions get made. If something here
contradicts the soul doc, the soul doc wins.

## Mental Model

- **Execution layer** runs the work. Browser (most common), local action,
  direct model answer. Provider-neutral behind a stable session contract.
- **Session** is the durable work unit. Records task, state, events, outputs,
  costs, errors, source evidence, follow-up path. Survives restarts.
- **Chat** is the spine. Users read top-to-bottom. Text narrates. **Typed
  blocks are embedded inline** to carry structure, evidence, and outputs.
  There is no parallel "execution view" surface — execution and output both
  live in the chat as blocks.
- **Block vocabulary** is owned by the UI. The agent emits typed events with
  labels; the UI renders them consistently with rich skeleton components.
- **Action queue** is the agency layer. Candidate actions, approval state,
  history. Surfaced both inline (as blocks in chat) and aggregated in the
  sidebar.
- **Job sidebar** is the orchestration layer. Many parallel sessions at a
  glance.
- **Personalization surface** makes the app the user's. Onboarding,
  preferences, dashboard, notification rules — all first-class.

## The Chat Is The Document

The chat is not a transcript next to a panel. It is a rich, top-to-bottom
document where text and structured blocks alternate. The agent narrates,
emits a `search` block, narrates again, emits a `decide` block, etc.

Reading patterns:

- Skim the text and block headers to follow the shape of the work.
- Expand a block to inspect what happened (raw results, evidence,
  reasoning).
- For large output blocks (a 100-row table, a long draft), use **pop to
  canvas** to open the block in a side panel without leaving the chat.

This is the answer to "what shape is an agent run." Mostly linear, vertical,
text-spined, with structure where structure earns its keep. Graph view is a
toggle for power users and for genuinely graph-shaped jobs — not the default.

## Inline Typed Block Vocabulary

The UI owns the structure. The agent picks the type and the label. First-pass
vocabulary (extend as needed):

### Process Blocks

- **`step`** — a labeled unit grouping sub-events. Title, status, one-line
  summary, expandable detail.
- **`search`** — query, result count, top results, expandable list, source
  links.
- **`navigate`** — URL, page title, screenshot thumbnail, what was sought.
- **`extract`** — what was extracted, count, sample rows, link to full data.
- **`decide`** — options considered, chosen path, reason.
- **`retry`** — what failed, attempt count, new approach.
- **`branch`** — path taken, paths abandoned with one-line reasons.
- **`wait`** — what the agent is waiting on (auth, user input, rate limit).

### Output Blocks

- **`table`** — structured rows with provenance per row. Pop-to-canvas for
  large tables.
- **`comparison`** — side-by-side cells with differentiators highlighted.
- **`clusters`** — grouped items with category labels and pattern notes.
- **`draft`** — editable text or structured object, approval-gated when it
  would be sent or saved externally.
- **`plan`** — list of proposed operations with reasons, editable, single
  approval executes.
- **`briefing`** — what changed, why it matters, evidence, recommended
  response.
- **`summary`** — short closing block at end of a turn or session.

### Agency Blocks

- **`action`** — a single candidate action with description, evidence link,
  approval state, undo path. Aggregated into the action queue.

Every block carries: human-readable title, status, evidence link where
applicable, expand-collapse, and (optionally, behind a toggle) duration and
cost.

## Plan Revisions

The agent may revise its plan mid-flight. Revisions are visible.

- A `step` that gets replaced renders as struck-through with a one-line
  reason and a pointer to the replacement.
- A `step` that gets skipped renders as collapsed with the reason.
- A `branch` block makes path choices explicit when there were real
  alternatives.

The user always knows what changed, why, and what the agent is doing now.

## Task Shapes And Block Weight

Same chat-with-blocks pattern, different density.

| Shape | Example | Block density |
| --- | --- | --- |
| Trivial Q&A | "What's the weather?" | Pure text. No blocks. |
| Lookup | "Find the latest invoice from X." | Light: one `search`, one `summary`. |
| Small structured | "Draft a reply to this email." | One `draft` block, one `action`. |
| Local action | "Clean up my Downloads folder." | One `plan` block + `action` items. |
| Medium delegated | "Compare these five products." | Several process blocks + one `comparison`. |
| Large delegated | "Research 100 leads." | Many process blocks + `table` + `clusters` + drafts. |
| Monitoring | "Tell me when this page changes." | Recurring `briefing` blocks. |

Adding a new task type means picking the right block weight, not inventing a
new surface.

## Session Lifecycle

States (human-readable, product-relevant):

- `idle` — session created, not yet started
- `running` — actively executing
- `waiting-for-user` — needs clarification or approval
- `waiting-for-auth` — needs login or credential
- `blocked` — site unreachable, captcha, rate limit, unrecoverable site state
- `paused` — user paused; resumable
- `failed` — terminal failure; may be re-runnable
- `completed` — terminal success
- `archived` — completed and out of active view

Never collapse these into generic success/failure. Each warrants distinct UI
treatment in the job sidebar.

## Job Sidebar

The primary orchestration surface. Sections, roughly:

- **Needs you now** — waiting on user, waiting on auth, blocked. Top.
- **Running** — actively executing, with current step.
- **Scheduled / Monitoring** — recurring jobs and their next check.
- **Recently completed** — items finished within a recent window whose
  output is worth a glance.
- **Archived** — collapsed by default.

Each row: title, current state, last meaningful event, shortcuts to open the
chat or jump to the latest block.

Background jobs run quietly. They surface only when something happens the
user has opted to see — meaningful change, required approval, completion,
blocker.

## Action Queue

Each `action` block in chat also appears in an aggregated queue. Examples:

- Send a message
- Save records to a list
- Apply labels
- Purchase an item
- Book a time
- Submit a form
- Delete or move files

Each action has: description, evidence link, status (`drafted`,
`awaiting-approval`, `approved`, `executed`, `failed`, `cancelled`),
approval rule (auto, single approval, requires confirmation phrase), and a
clear undo path where possible.

Actions are never hidden inside chat text. They are always rendered as
`action` blocks.

## Onboarding

Goal: fast, rewarding, thorough.

Constraints:

- 60-90 seconds for the fast path. The user is using the app immediately
  after.
- Each answer visibly changes something on screen — dashboard preview,
  sample briefing in chosen tone, sidebar layout. No invisible questions.
- "Thorough" is opt-in and incremental, surfaced after the user has felt
  value — not as a wall before they get any.

Question shape (illustrative, not final):

1. What kinds of things do you most want help with? (Multi-select with
   examples — research, inbox, shopping, monitoring, file organization,
   etc.)
2. How proactive should I be? (Quiet / Calm / Active — with examples of
   what each looks like.)
3. What should I bring to your attention? (Completions only / Important
   changes / Suggestions / Drafts to review.)
4. How do you want to be notified? (In-app only / OS notifications / Daily
   digest.)
5. Preferred tone for briefings. (Terse / Neutral / Conversational.)

Passive learning extends every answer over time. There is always a global
quiet switch.

## Proactivity Rules

- **Earned, not default.** Start mostly reactive. Earn background work by
  doing reactive work well first.
- **Scoped.** Every proactive behavior has a user-set boundary.
- **Briefings, not pings.** Digests beat toast streams.
- **Contextual moments.** Surface suggestions at the moment of relevance
  (opening a session, finishing a task, asking a related question), not as
  ambient nags.

Failure modes to avoid:

- Notification spam
- Vague "still working" pings with no content
- Suggestions the user didn't ask for and wouldn't want
- Background work that surprises on next app open
- Updates without evidence

## Personalization Levels

1. **Preferences.** Theme, density, tone, panel visibility, notification
   scope. Table stakes.
2. **Layout.** Pinned widgets, rearranged panes, dashboard reflecting actual
   work patterns. Core product.
3. **Generative UI.** Custom views built per user from work and data.
   Roadmap, not v1.

Onboarding seeds (1) and (2). Passive learning extends both over time.

## Example Walkthroughs

### Contact Research (delegated)

User asks: "Research 100 contacts from this list and tell me who's worth
reaching out to."

In the chat, top-to-bottom:

1. Agent text: "Starting. I'll work through the list and group results."
2. `step` block: "Loading contact list — 100 entries."
3. `search` blocks for each cohort lookup, grouped under labeled steps.
4. `extract` blocks summarizing what was pulled per source.
5. Agent text: "Here's what I found."
6. `clusters` block: founders, hiring managers, investors, etc.
7. `table` block (pop-to-canvas): full contacts with provenance.
8. `briefing` block: pattern notes, outliers.
9. `draft` blocks: outreach drafts for chosen clusters.
10. `action` blocks: send / save / label, each approval-gated.
11. `summary` block: one-line closing.

### Desktop Cleanup (local action)

User asks: "Clean up my Downloads folder."

1. Agent text: "Inspecting the folder."
2. `extract` block: file inventory (count, types, ages).
3. `plan` block: delete candidates, archive candidates, leave-alone — each
   with a reason. Editable.
4. User edits, approves.
5. `action` blocks: each file operation, status `executed` with undo links.
6. `summary` block.

### Monitoring (proactive)

User asks: "Tell me when this page changes."

1. `step` block: monitor configured, schedule shown.
2. Recurring `briefing` blocks appear in the chat at each check — change
   summary, severity, evidence, recommended response. Or a no-change record
   collapsed by default.
3. User can adjust scope, frequency, or end the monitor from inside a
   briefing block.

## Implementation Principles

- **Chat is the document.** Text spine, typed blocks inline. No parallel
  execution panel.
- **UI owns the vocabulary.** Agent emits typed events with labels; UI
  renders consistently.
- **Legibility over completeness.** The user can always glance and know what
  is going on.
- **Plan revisions are visible.** No silent rewrites.
- **Provenance on everything.** Clusters, rankings, charts, recommendations
  retain source links.
- **Execution as ground truth.** Inspection and takeover always nearby on
  the relevant block.
- **Proactive but permissioned.** Consequential actions require explicit
  authority. When in doubt, prepare and ask.
- **Durable work units.** Sessions survive restarts, failures, follow-ups.
- **Human-readable state.** Never collapse important states into generic
  success/failure.
- **Local-first trust.** Credentials, cookies, browser state, local logs are
  sensitive local data.
- **Provider-neutral sessions.** Engine details stay behind a stable session
  contract.
- **Cross-platform is core.** Installers, shortcuts, shells, logs, credential
  storage, profiles, browser behavior — all first-class per OS.
- **Personalization is core.** The personalization surface is part of the
  product spine, not buried in settings.

## Do / Avoid Cheat Sheet

Prefer:

- Command input that starts work quickly
- A job sidebar that makes parallel work coherent
- Inline typed blocks that make any moment in a session glance-able
- Source-backed summaries instead of unsupported prose
- Visible plan revisions
- Explicit action states and approval affordances
- Pop-to-canvas for large output blocks
- Session recovery near the session that needs it
- Concise updates that say what changed and what matters
- Onboarding and personalization surfaces that feel rewarding

Avoid:

- Building a generic browser shell
- Putting execution detail in a parallel panel away from the chat
- Free-form agent output that bypasses the block vocabulary
- Long prose where structure would help
- Hiding source evidence
- Silent plan rewrites
- Ambient proactivity that hasn't been opted into
- Vague "still working" pings
- Provider-specific UI where a session-level concept would work
- Treating logs as a user-facing substitute for product state
- Burying personalization in settings

## Public-Facing Language Care

When writing public-facing examples, avoid implying scraping of specific
third-party sites in ways that violate their terms. Prefer "research contacts
from authorized sources" over "scrape LinkedIn."
