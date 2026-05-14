# Product Soul

For agents and humans making product decisions in Browser Use Desktop. Not
marketing copy. Read this first to orient on direction. For concrete shapes,
flows, and operational detail, see `PRODUCT_BLUEPRINT.md`.

## Thesis

Browser Use Desktop is for **anyone who wants something done on their
computer**. Shopping, research, desktop cleanup, file search, form filling,
monitoring, general questions, drafting, booking.

The user does not care whether the work runs through a browser, a local
action, or a direct model answer. They care that they can ask, get a result
they trust, and stay in control.

Most work routes through the browser, so browser is the **most common**
execution layer — not the privileged one. Local actions and direct answers
are first-class.

The product is not a desktop app with chat. Chat is necessary, not sufficient.
The app turns delegated work into structured understanding and controlled
action.

## Scope

In: anything a person wants done on their computer that does not require deep
IDE integration.

Coding is **allowed but not marketed**. The positioning fight against Cursor,
Conductor, Codex app, and similar is intentionally skipped. The win is the
much larger non-coding surface.

## Moats

Three things to defend. Evaluate features against them.

1. **User experience.** Faster, calmer, more thoughtful than the everything-
   app features the big labs ship. Taste is the product, not decoration.
2. **Personalized proactivity.** Scoped to the user, evidence-backed, earned.
   Never spam, never vague, never presumptuous.
3. **Multi-session orchestration.** Many durable jobs running at once,
   surfaced through a coherent interface. Structural advantage over single-
   conversation chat products.

Local-first trust and browser depth are real strengths but serve the three
above, not the headline.

## Promise

> "I can hand work to this app, get useful updates while it runs, understand
> the result quickly, let it act for me when the boundaries are clear, and
> trust that it is calibrated to me — not to a generic average user."

Four parts: **delegation**, **understanding**, **personalized proactivity**,
**control**.

## Interface Pattern

One pattern for everything: **chat with inline typed blocks**. Text is the
spine — the user reads top-to-bottom. Blocks (search, navigate, extract,
decide, table, draft, plan, briefing, action queue, and more) are embedded
*inside* the chat, not in a parallel surface. They carry structure where
structure helps; text carries narration and clarification.

Block weight scales with task complexity. Trivial Q&A: pure text. Large
delegated work: many embedded blocks, with a "pop to canvas" affordance for
outputs that deserve more room.

The UI owns the block vocabulary. The agent emits typed events with labels;
the UI renders them consistently. Agents stay free; users stay oriented.

## Autonomy Ladder

Observe → Organize → Recommend → Draft → Act → Monitor. Always make the rung
explicit. "Act for me" is only safe with defined scope, allowed actions,
confidence threshold, and approval rules.

## Personalization

The app is the user's. Preferences, layout, dashboard, notification scope,
tone — all bend to them. Generative UI is on the roadmap, not v1.

Calibration is fast, rewarding, and thorough at onboarding, and continues
passively through use. There is always a global quiet switch that pauses
output without resetting learning.

## Non-Negotiables

- **Legibility over completeness.** The user can always feel they know what
  is going on. Glance-ability beats exhaustive logs. When agent freedom and
  user legibility conflict, legibility wins.
- **Structure over prose** for any task with structure.
- **Provenance** on every cluster, ranking, chart, recommendation.
- **Execution as ground truth.** Inspection and takeover are always nearby.
- **Permissioned proactivity.** Consequential actions need explicit authority.
- **Durable sessions.** Work survives restarts, failures, follow-ups.
- **Local-first trust.** Credentials, cookies, state are sensitive local data.
- **Cross-platform is core.** macOS, Windows, Linux are first-class.

## Decision Filter

Before implementing a feature, ask:

1. Does it help the user delegate computer work?
2. Does it convert raw activity into understanding or controlled action?
3. Does it fit chat + artifacts, or invent a parallel pattern?
4. Does it respect or extend the user's personalization?
5. Does it serve at least one moat (UX, personalized proactivity, multi-
   session orchestration)?
6. Does it preserve evidence, provenance, and user control?

If mostly no, the feature is off-direction.

## Short Version

Browser Use Desktop is the interface for delegating computer work to agents.
Any person, any task that touches their computer. Browser is the most common
execution layer, not the only one. Chat plus artifacts. Many sessions in
parallel. Proactive on the user's terms.

The goal is not to make users read more chat. The goal is to make delegated
computer work understandable, resumable, actionable, and *theirs*.
