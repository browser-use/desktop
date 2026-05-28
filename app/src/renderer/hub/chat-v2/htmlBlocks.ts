/**
 * Streaming `html` / `htmlview` / `options` / `ask` fenced-code-block extractor.
 *
 * Agents (claude-code, codex, browsercode/opencode) stream their output as
 * many small text deltas. When the model emits a fenced block like:
 *
 *     ```html
 *     <div class="plan">…</div>
 *     ```
 *
 * the renderer wants to surface that as a sandboxed-iframe artifact, not
 * as inline markdown. Similarly an `options` fence carrying JSON is
 * surfaced as a selectable picker, not raw code.
 *
 * Contract: see `app/tests/unit/chat-v2/htmlBlocks.test.ts` and
 * `optionBlocks.test.ts` — the benchmarks. Adjust the spec there, not
 * behavior here, unless the spec is wrong.
 */

export interface OptionItem {
  id: string;
  image: string;
  title: string;
  /** Long-form copy. Renderer clamps to ~5 lines. */
  description?: string;
  /** Arbitrary label→value rows shown at the card foot. The block's
   *  `fieldSchema` (or the union of all options' keys when no schema is
   *  declared) determines render order; missing values are omitted so
   *  cards may have different heights across the grid. */
  fields?: Record<string, string>;
  /** Required. Full URL to the product page. Options without a URL are dropped. */
  url: string;
  /** Required. Brand token only — "Amazon", "Instacart", "Airbnb", etc.
   *  No TLD, no `.com`. Options without a site are dropped. */
  site: string;

  // Backward-compat syntactic sugar — these get folded into `fields` /
  // `description` by the parser. New callers should set fields/description
  // directly.
  subtitle?: string;
  price?: string;
  merchant?: string;
}

/**
 * One labeled group of options inside a multi-section picker (e.g. the
 * "Patty" sub-grid in a burger-ingredients block). A legacy
 * single-section block is normalized by the parser into one
 * label-less section so the component always iterates `sections[]`.
 */
export interface OptionListSection {
  /** Heading shown above this section's grid. Omitted in legacy
   *  single-section payloads. */
  label?: string;
  multiSelect: boolean;
  min: number;
  max: number;
  /** Ordered list of field labels to render in every card. When present,
   *  cards align vertically — missing values render as "—". When absent,
   *  the renderer uses the union of every option's `fields` keys. */
  fieldSchema?: string[];
  /** When true (default), the renderer appends a dashed "Other —
   *  describe…" card to the section's grid that expands into a text
   *  input on click. Set false only when the listed options are
   *  truly exhaustive. */
  allowOther: boolean;
  options: OptionItem[];
}

export interface OptionListPayload {
  prompt?: string;
  /** One-or-more selectable sections. Single-section payloads (legacy
   *  shape with `options` at top level) get normalized to a sections
   *  array of length 1. Multi-section payloads (one fence covering a
   *  full multi-category ask like "burger ingredients") declare every
   *  section here, and the renderer stacks them vertically inside one
   *  picker shell with a single shared Confirm at the foot. */
  sections: OptionListSection[];
}

/**
 * One option inside an `ask` block's question. Text-only — no image,
 * no fields. The renderer adds an automatic "Other" option with a
 * text input affordance unless the question disables it explicitly.
 */
export interface AskOption {
  /** Short display label (1-5 words). The line the user clicks. */
  label: string;
  /** Optional context: tradeoff, explanation, pricing hint. */
  description?: string;
}

/**
 * One question inside an `ask` form. Mirrors the shape Claude Code's
 * native AskUserQuestion tool uses — that schema is well-designed and
 * familiar to agents, so we keep it verbatim except that this is OUR
 * channel (works for codex / opencode too via the skill).
 */
export interface AskQuestion {
  question: string;
  /** Short chip label shown above the question (≤12 chars). */
  header?: string;
  multiSelect: boolean;
  options: AskOption[];
  /** When true (default), an "Other…" affordance is appended to the
   *  options so the user can type a custom answer. Set false to lock
   *  the user to the listed options. */
  allowOther: boolean;
}

export interface AskFormPayload {
  prompt?: string;
  questions: AskQuestion[];
}

/**
 * Payload for a ```login fence — credential collection during browsing.
 * `site` is the brand token (e.g. "Amazon", not "amazon.com"). `url` is
 * required so the manual-login escape hatch knows where to deep-link.
 */
export interface LoginPayload {
  site: string;
  url: string;
  prompt?: string;
  usernameLabel?: string;
  passwordLabel?: string;
}

/**
 * Payload for a ```capture fence — recaptcha 3×3 (or NxM) tile picker.
 * `image` is an absolute path under the harness outputs dir; the renderer
 * loads it via `chatfile://files<image>`. The renderer slices that single
 * image visually into rows×cols tiles via CSS `background-position`; no
 * pre-cropping happens server-side. Selection is returned to the agent as
 * a list of tile indices (0-based, left-to-right, top-to-bottom).
 */
export interface CapturePayload {
  image: string;
  prompt?: string;
  /** Bold subject for the reCAPTCHA-style header banner ("cars",
   *  "motorcycles", etc.). Rendered emphasized; the renderer matches
   *  Google's blue prompt bar. */
  target?: string;
  /** Optional example thumbnail shown on the right of the header
   *  (matches the reCAPTCHA "find more like this" candidate image). */
  targetImage?: string;
  rows: number;
  cols: number;
}

/**
 * Payload for an ```iframe fence — embeds an arbitrary http(s) URL in a
 * sandboxed <iframe> directly inside the chat turn. The agent uses this
 * to surface a piece of the page it's already navigating (a captcha
 * bframe, a checkout step, an OAuth consent screen) so the user can
 * interact with the real thing rather than a screenshot+proxy. The
 * agent's browser session is unrelated to whatever cookies/state the
 * embedded frame establishes inside the renderer — see iframe-block.md
 * for the (sometimes severe) limitations.
 */
export interface IframePayload {
  url: string;
  prompt?: string;
  /** Pixel width of the embedded frame. Clamped to [200, 1200]. */
  width: number;
  /** Pixel height of the embedded frame. Clamped to [200, 900]. */
  height: number;
  /** Submit-button label shown below the frame. Default "I'm done". */
  submitLabel?: string;
}

export type FenceTag = 'html' | 'htmlview' | 'options' | 'ask' | 'login' | 'capture' | 'iframe';

export type ExtractEvent =
  | { kind: 'text'; text: string }
  | { kind: 'html_block'; content: string; tag: 'html' | 'htmlview'; complete: boolean }
  | { kind: 'option_list'; complete: boolean; raw: string; parsed: OptionListPayload | null; error?: string }
  | { kind: 'ask_form'; complete: boolean; raw: string; parsed: AskFormPayload | null; error?: string }
  | { kind: 'login_form'; complete: boolean; raw: string; parsed: LoginPayload | null; error?: string }
  | { kind: 'capture_block'; complete: boolean; raw: string; parsed: CapturePayload | null; error?: string }
  | { kind: 'iframe_block'; complete: boolean; raw: string; parsed: IframePayload | null; error?: string };

/**
 * Stateful, chunk-fed extractor. Safe to call `feed` once per streamed
 * text delta; events accumulate as fences resolve. Always call `end()`
 * once the upstream stream finishes — that flushes any pending text or
 * a still-open html block as `complete: false`.
 */
export class HtmlBlockExtractor {
  /**
   * Largest amount of trailing text we hold back in TEXT state to guard
   * against a fence forming across a chunk boundary. Must be >= length
   * of the longest fence opener: "\n```htmlview\n" (14 chars). Use 32
   * to leave headroom for whitespace variants.
   */
  private static readonly LOOKBACK = 32;

  private state: 'text' | 'fence' = 'text';
  private buffer = '';
  private currentTag: FenceTag | null = null;

  /** Feed the next chunk of streamed text. Returns any events that
   *  fully resolved within (or before) this chunk. */
  feed(chunk: string): ExtractEvent[] {
    if (chunk.length === 0) return [];
    this.buffer += chunk;
    return this.drain(/* flush */ false);
  }

  /** Signal end of stream. Flushes any held text and, if a block is
   *  open, emits it as `complete: false` so the UI can render what we
   *  got (or show a "stream ended mid-block" indicator). */
  end(): ExtractEvent[] {
    return this.drain(/* flush */ true);
  }

  // ---------------------------------------------------------------- internals

  private drain(flush: boolean): ExtractEvent[] {
    const out: ExtractEvent[] = [];
    let progress = true;
    while (progress) {
      progress = false;
      if (this.state === 'text') {
        const opener = findOpener(this.buffer, flush);
        if (opener) {
          if (opener.start > 0) {
            out.push({ kind: 'text', text: this.buffer.slice(0, opener.start) });
          }
          this.buffer = this.buffer.slice(opener.end);
          this.state = 'fence';
          this.currentTag = opener.tag;
          progress = true;
        } else if (flush) {
          if (this.buffer.length > 0) {
            out.push({ kind: 'text', text: this.buffer });
            this.buffer = '';
          }
        } else {
          // Hold the trailing window in case a fence is forming across
          // the next chunk boundary.
          const safeLen = Math.max(0, this.buffer.length - HtmlBlockExtractor.LOOKBACK);
          if (safeLen > 0) {
            const safe = this.buffer.slice(0, safeLen);
            // Avoid splitting just before a `\n` that could be the
            // start of `\n```html\n`. Trim back to the last newline if
            // any inside the safe portion ends within the lookback.
            out.push({ kind: 'text', text: safe });
            this.buffer = this.buffer.slice(safeLen);
          }
        }
      } else {
        // state === 'fence' — inside an html/htmlview/options block
        const closer = findCloser(this.buffer, flush);
        const tag = this.currentTag ?? 'html';
        if (closer) {
          const content = this.buffer.slice(0, closer.start);
          out.push(emitBlock(tag, content, /* complete */ true));
          this.buffer = this.buffer.slice(closer.end);
          this.state = 'text';
          this.currentTag = null;
          progress = true;
        } else if (flush) {
          // Stream ended mid-block — emit whatever we have so the user
          // sees the partial render rather than nothing.
          out.push(emitBlock(tag, this.buffer, /* complete */ false));
          this.buffer = '';
          this.state = 'text';
          this.currentTag = null;
        }
        // While streaming a fence, we hold the entire buffer
        // until the closing fence resolves. That's intentional: we
        // emit the block atomically so the UI doesn't render a
        // half-formed <div> chain or partial JSON.
      }
    }
    return out;
  }
}

/** Convenience: run a list of chunks through a fresh extractor and
 *  collect all events including the final flush. Used by tests + the
 *  HlEvent → parts adapter (which has the whole stream in hand). */
export function extractAll(chunks: string[]): ExtractEvent[] {
  const ex = new HtmlBlockExtractor();
  const out: ExtractEvent[] = [];
  for (const c of chunks) out.push(...ex.feed(c));
  out.push(...ex.end());
  return mergeAdjacentText(out);
}

// ---------------------------------------------------------------------------
// Fence detection
// ---------------------------------------------------------------------------

/**
 * Opening fence: `\`\`\`html` or `\`\`\`htmlview`, optionally preceded
 * by a newline (so the fence sits at the start of a line) and followed
 * by optional trailing whitespace and a terminator.
 *
 * Two regex variants: STRICT requires a real `\n` terminator (used
 * during streaming so we don't prematurely transition before the
 * newline arrives in the next chunk); LAX also accepts end-of-input
 * (used only during the final `end()` flush).
 */
const OPENER_STRICT = /(^|\n)```(html|htmlview|options|ask|login|capture|iframe)[ \t]*\r?\n/;
const OPENER_LAX = /(^|\n)```(html|htmlview|options|ask|login|capture|iframe)[ \t]*(\r?\n|$)/;

function findOpener(buf: string, flush: boolean): { start: number; end: number; tag: FenceTag } | null {
  const re = flush ? OPENER_LAX : OPENER_STRICT;
  const m = re.exec(buf);
  if (!m) return null;
  const leading = m[1]; // '' or '\n'
  // The text portion ends BEFORE the leading newline (if there is
  // one), so we don't leak the boundary newline into the previous
  // text event.
  const start = m.index + leading.length;
  const end = m.index + m[0].length;
  const tag = m[2] as FenceTag;
  return { start, end, tag };
}

/**
 * Closing fence: `\`\`\`` on its own line. The block content always
 * ends with the trailing newline immediately before the fence — we
 * strip it so the consumer gets clean HTML, not HTML-with-trailing-LF.
 *
 * STRICT requires a real `\n` terminator after the fence; LAX also
 * accepts end-of-input. Use LAX only at flush time so a closing fence
 * arriving as the very last token (no trailing newline) still resolves.
 */
// Lookahead so the newline that follows the closing fence stays in the
// buffer as a regular character — it belongs to whatever comes next
// (usually a paragraph break before more prose), not to the fence
// itself. STRICT requires a real \n to confirm the closer; LAX also
// accepts end-of-stream so a trailing fence with no final \n resolves
// on `end()`.
const CLOSER_STRICT = /(^|\n)```[ \t]*(?=\r?\n)/;
const CLOSER_LAX = /(^|\n)```[ \t]*(?=\r?\n|$)/;

function findCloser(buf: string, flush: boolean): { start: number; end: number } | null {
  const re = flush ? CLOSER_LAX : CLOSER_STRICT;
  const m = re.exec(buf);
  if (!m) return null;
  const leading = m[1];
  // start: position to slice the content up to (excluding the leading
  //        newline that introduces the fence line).
  const start = m.index;
  const end = m.index + m[0].length;
  void leading;
  return { start, end };
}

function mergeAdjacentText(events: ExtractEvent[]): ExtractEvent[] {
  const out: ExtractEvent[] = [];
  for (const e of events) {
    const prev = out[out.length - 1];
    if (e.kind === 'text' && prev?.kind === 'text') {
      prev.text += e.text;
    } else {
      out.push(e);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block emission — branches on fence tag.
// ---------------------------------------------------------------------------

function emitBlock(tag: FenceTag, content: string, complete: boolean): ExtractEvent {
  if (tag === 'options') {
    // Always try to parse — even partial streams can yield complete option
    // objects that we want to render progressively. parseOptionList falls
    // back to brace-scanning when full JSON.parse fails.
    const { parsed, error } = parseOptionList(content, { partial: !complete });
    return { kind: 'option_list', complete, raw: content, parsed, error };
  }
  if (tag === 'ask') {
    const { parsed, error } = parseAskForm(content, { partial: !complete });
    return { kind: 'ask_form', complete, raw: content, parsed, error };
  }
  if (tag === 'login') {
    const { parsed, error } = parseLoginBlock(content);
    return { kind: 'login_form', complete, raw: content, parsed, error };
  }
  if (tag === 'capture') {
    const { parsed, error } = parseCaptureBlock(content);
    return { kind: 'capture_block', complete, raw: content, parsed, error };
  }
  if (tag === 'iframe') {
    const { parsed, error } = parseIframeBlock(content);
    return { kind: 'iframe_block', complete, raw: content, parsed, error };
  }
  return { kind: 'html_block', content, tag: tag as 'html' | 'htmlview', complete };
}

/**
 * Parse + validate an iframe block body. Tiny flat JSON; the renderer
 * has nothing useful to show until the URL is in hand, so no streaming
 * partial path.
 */
export function parseIframeBlock(raw: string): { parsed: IframePayload | null; error?: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { parsed: null, error: 'invalid json' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { parsed: null, error: 'expected json object at top level' };
  }
  const obj = data as Record<string, unknown>;
  const url = typeof obj.url === 'string' ? obj.url.trim() : '';
  if (!url) return { parsed: null, error: 'missing required field "url"' };
  if (!isAbsoluteHttpUrl(url)) return { parsed: null, error: 'url must be an absolute http(s) URL' };
  const widthRaw = typeof obj.width === 'number' && Number.isFinite(obj.width) ? Math.floor(obj.width) : 400;
  const heightRaw = typeof obj.height === 'number' && Number.isFinite(obj.height) ? Math.floor(obj.height) : 500;
  return {
    parsed: {
      url,
      prompt: typeof obj.prompt === 'string' && obj.prompt.trim().length > 0 ? obj.prompt.trim() : undefined,
      width: Math.min(1200, Math.max(200, widthRaw)),
      height: Math.min(900, Math.max(200, heightRaw)),
      submitLabel:
        typeof obj.submitLabel === 'string' && obj.submitLabel.trim().length > 0
          ? obj.submitLabel.trim()
          : undefined,
    },
  };
}

/**
 * Parse + validate a login block body. The payload is a small flat object;
 * there's no partial-streaming path because the body is tiny and the form
 * has nothing useful to render until the closing fence resolves the JSON.
 */
/**
 * Parse + validate a capture block body. Small flat JSON; no streaming
 * partial path since the body is tiny and the picker can't render
 * meaningfully until the image path is in hand.
 */
export function parseCaptureBlock(raw: string): { parsed: CapturePayload | null; error?: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { parsed: null, error: 'invalid json' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { parsed: null, error: 'expected json object at top level' };
  }
  const obj = data as Record<string, unknown>;
  const image = typeof obj.image === 'string' ? obj.image.trim() : '';
  if (!image) return { parsed: null, error: 'missing required field "image"' };
  const rowsRaw = typeof obj.rows === 'number' && Number.isFinite(obj.rows) ? Math.floor(obj.rows) : 3;
  const colsRaw = typeof obj.cols === 'number' && Number.isFinite(obj.cols) ? Math.floor(obj.cols) : 3;
  const rows = Math.min(8, Math.max(1, rowsRaw));
  const cols = Math.min(8, Math.max(1, colsRaw));
  const target = typeof obj.target === 'string' && obj.target.trim().length > 0 ? obj.target.trim() : undefined;
  const targetImageRaw = typeof obj.targetImage === 'string' ? obj.targetImage.trim() : '';
  // Only accept absolute http(s) URLs for targetImage (it goes straight
  // into an <img src>). Drop anything else silently — the header still
  // renders without the thumbnail.
  const targetImage = targetImageRaw && isAbsoluteHttpUrl(targetImageRaw) ? targetImageRaw : undefined;
  return {
    parsed: {
      image,
      prompt: typeof obj.prompt === 'string' && obj.prompt.trim().length > 0 ? obj.prompt.trim() : undefined,
      target,
      targetImage,
      rows,
      cols,
    },
  };
}

export function parseLoginBlock(raw: string): { parsed: LoginPayload | null; error?: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { parsed: null, error: 'invalid json' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { parsed: null, error: 'expected json object at top level' };
  }
  const obj = data as Record<string, unknown>;
  const site = typeof obj.site === 'string' ? obj.site.trim() : '';
  const url = typeof obj.url === 'string' ? obj.url.trim() : '';
  if (!site) return { parsed: null, error: 'missing required field "site"' };
  if (!url) return { parsed: null, error: 'missing required field "url"' };
  if (!isAbsoluteHttpUrl(url)) return { parsed: null, error: 'url must be an absolute http(s) URL' };
  return {
    parsed: {
      site,
      url,
      prompt: typeof obj.prompt === 'string' && obj.prompt.trim().length > 0 ? obj.prompt.trim() : undefined,
      usernameLabel: typeof obj.usernameLabel === 'string' && obj.usernameLabel.trim().length > 0 ? obj.usernameLabel.trim() : undefined,
      passwordLabel: typeof obj.passwordLabel === 'string' && obj.passwordLabel.trim().length > 0 ? obj.passwordLabel.trim() : undefined,
    },
  };
}

/**
 * Parse + validate an options block body. Returns the canonical payload
 * with defaults filled in, or an error string explaining why it was
 * rejected. Invalid individual options are dropped — one bad option
 * doesn't kill the whole picker. If zero options survive validation,
 * the block as a whole is rejected.
 *
 * When `partial: true` (mid-stream), falls back to scanning the buffer
 * for complete `{...}` objects inside the options array if full JSON
 * parse fails. That gives progressive card rendering instead of a flat
 * skeleton while the fence is still streaming.
 */
export function parseOptionList(raw: string, opts: { partial?: boolean } = {}): { parsed: OptionListPayload | null; error?: string } {
  // 1) Try full parse first — works at completion AND mid-stream if the
  //    JSON is incidentally valid (e.g. agent flushed a closing brace
  //    before any items arrived).
  let data: unknown = null;
  let fullParseFailed = false;
  try {
    data = JSON.parse(raw);
  } catch {
    fullParseFailed = true;
  }

  if (!fullParseFailed) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { parsed: null, error: 'expected json object at top level' };
    }
    const obj = data as Record<string, unknown>;
    const prompt = typeof obj.prompt === 'string' ? obj.prompt : undefined;

    // New shape: top-level `sections` array. Each section is its own
    // labeled sub-picker with its own selection bounds + options.
    if (Array.isArray(obj.sections)) {
      const sections: OptionListSection[] = [];
      for (const rawSection of obj.sections) {
        const section = validateSection(rawSection);
        if (section) sections.push(section);
      }
      if (sections.length === 0) {
        return { parsed: null, error: 'no valid sections (each needs at least one valid option)' };
      }
      return { parsed: { prompt, sections } };
    }

    // Legacy shape: top-level `options` becomes a single unnamed section.
    if (Array.isArray(obj.options)) {
      const section = validateSection({
        // Hoist top-level selection / schema fields into the section.
        multiSelect: obj.multiSelect,
        min: obj.min,
        max: obj.max,
        fieldSchema: obj.fieldSchema,
        allowOther: obj.allowOther,
        options: obj.options,
      });
      if (!section) {
        return { parsed: null, error: 'no valid options (each option needs id, image, title, url, site)' };
      }
      return { parsed: { prompt, sections: [section] } };
    }

    return { parsed: null, error: 'missing required field "options" or "sections"' };
  }

  // 2) Partial parse path — only when explicitly requested (mid-stream).
  if (!opts.partial) {
    return { parsed: null, error: 'invalid json' };
  }
  return extractPartial(raw);
}

/**
 * Validate one section descriptor — used for both the multi-section
 * path (per element of `sections`) and the legacy-single-section path
 * (where the parser hoists the top-level options/multiSelect/min/max
 * into a synthetic section). Returns null when fewer than one valid
 * option survives.
 */
function validateSection(raw: unknown): OptionListSection | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.options)) return null;
  const options: OptionItem[] = [];
  for (const item of o.options) {
    const valid = validateOption(item);
    if (valid) options.push(valid);
  }
  if (options.length === 0) return null;
  const multiSelect = typeof o.multiSelect === 'boolean' ? o.multiSelect : false;
  const min = typeof o.min === 'number' && Number.isFinite(o.min) ? Math.max(0, Math.floor(o.min)) : 1;
  const max = typeof o.max === 'number' && Number.isFinite(o.max) ? Math.max(min, Math.floor(o.max)) : (multiSelect ? options.length : 1);
  const fieldSchema = Array.isArray(o.fieldSchema)
    ? (o.fieldSchema as unknown[]).filter((x): x is string => typeof x === 'string' && x.length > 0)
    : undefined;
  return {
    label: typeof o.label === 'string' && o.label.trim().length > 0 ? o.label.trim() : undefined,
    multiSelect,
    min,
    max,
    fieldSchema: fieldSchema && fieldSchema.length > 0 ? fieldSchema : undefined,
    allowOther: typeof o.allowOther === 'boolean' ? o.allowOther : false,
    options,
  };
}

/**
 * Scan a partial buffer for complete `{...}` option objects inside the
 * `options: [` array, plus any top-level scalar fields (prompt,
 * multiSelect, min, max) that have already streamed in. Tolerant — any
 * malformed individual object is silently skipped.
 */
function extractPartial(raw: string): { parsed: OptionListPayload | null; error?: string } {
  // Prompt is shared across both shapes; pull it from the prefix.
  let prompt: string | undefined;
  const promptMatch = raw.match(/"prompt"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (promptMatch) {
    try { prompt = JSON.parse(`"${promptMatch[1]}"`); } catch { /* leave undefined */ }
  }

  // New shape: walk `sections: [...]` for complete section objects.
  const sectionsBracket = findArrayStart(raw, 'sections');
  if (sectionsBracket !== -1) {
    const sections: OptionListSection[] = [];
    for (const slice of walkBalancedObjects(raw, sectionsBracket)) {
      try {
        const obj = JSON.parse(slice);
        const v = validateSection(obj);
        if (v) sections.push(v);
      } catch {
        // malformed section — skip
      }
    }
    if (sections.length === 0) return { parsed: null };
    return { parsed: { prompt, sections } };
  }

  // Legacy shape: walk `options: [...]` for complete option objects, then
  // wrap them in a single unnamed section. Per-section bounds are pulled
  // from the prefix scalars (multiSelect / min / max), which is good
  // enough for streaming alignment.
  const optionsBracket = findArrayStart(raw, 'options');
  if (optionsBracket === -1) return { parsed: null };
  const options: OptionItem[] = [];
  for (const slice of walkBalancedObjects(raw, optionsBracket)) {
    try {
      const obj = JSON.parse(slice);
      const v = validateOption(obj);
      if (v) options.push(v);
    } catch {
      // malformed option — skip
    }
  }
  if (options.length === 0) return { parsed: null };

  const msMatch = raw.match(/"multiSelect"\s*:\s*(true|false)/);
  const multiSelect = msMatch ? msMatch[1] === 'true' : false;
  const minMatch = raw.match(/"min"\s*:\s*(-?\d+)/);
  const min = minMatch ? Math.max(0, parseInt(minMatch[1], 10)) : 1;
  const maxMatch = raw.match(/"max"\s*:\s*(-?\d+)/);
  const max = maxMatch ? Math.max(min, parseInt(maxMatch[1], 10)) : (multiSelect ? options.length : 1);
  return {
    parsed: {
      prompt,
      sections: [{
        multiSelect,
        min,
        max,
        allowOther: false,
        options,
      }],
    },
  };
}

/** Locate the `[` that opens an array named `key` at the top level of
 *  the JSON prefix. Returns the index of `[` or -1 if not found. */
function findArrayStart(raw: string, key: string): number {
  const re = new RegExp(`"${key}"\\s*:\\s*\\[`);
  const m = re.exec(raw);
  if (!m) return -1;
  return raw.indexOf('[', m.index);
}

/** Walk a `[...]` array starting at `bracketIdx`, yielding the source
 *  slice of every fully-closed `{...}` object inside. Stops as soon as
 *  an unclosed object is encountered (partial — wait for more bytes). */
function* walkBalancedObjects(raw: string, bracketIdx: number): Generator<string> {
  let i = bracketIdx + 1;
  while (i < raw.length) {
    // Skip whitespace and commas between objects.
    while (i < raw.length && (raw[i] === ' ' || raw[i] === '\t' || raw[i] === '\n' || raw[i] === '\r' || raw[i] === ',')) i++;
    if (i >= raw.length) return;
    if (raw[i] === ']') return;
    if (raw[i] !== '{') { i++; continue; }

    const start = i;
    let depth = 0;
    let inStr = false;
    let escaped = false;
    let closed = false;
    for (; i < raw.length; i++) {
      const c = raw[i];
      if (escaped) { escaped = false; continue; }
      if (inStr) {
        if (c === '\\') escaped = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { i++; closed = true; break; }
      }
    }
    if (!closed) return; // partial object — stop and wait for more bytes
    yield raw.slice(start, i);
  }
}

function validateOption(raw: unknown): OptionItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  const image = typeof o.image === 'string' ? o.image.trim() : '';
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const url = typeof o.url === 'string' ? o.url.trim() : '';
  const site = typeof o.site === 'string' ? o.site.trim() : '';
  // url and site are now required — drop options that omit either.
  if (!id || !image || !title || !url || !site) return null;
  // url must be an absolute http(s) URL — both because shell.openExternal
  // rejects anything else, and because relative/`javascript:`/data URLs from
  // a model-emitted block shouldn't be navigated to. image must be remote
  // too since it goes into an <img src> on a renderer that has no concept
  // of the agent's working directory.
  if (!isAbsoluteHttpUrl(url) || !isAbsoluteHttpUrl(image)) return null;
  if (isLikelyDecorativeOptionImage(image)) return null;

  // Coerce the agent-supplied `fields` map into a clean string→string record.
  const fields: Record<string, string> = {};
  if (o.fields && typeof o.fields === 'object' && !Array.isArray(o.fields)) {
    for (const [k, v] of Object.entries(o.fields as Record<string, unknown>)) {
      if (typeof k === 'string' && k.length > 0 && (typeof v === 'string' || typeof v === 'number')) {
        fields[k] = String(v);
      }
    }
  }
  // Backward-compat sugar: fold legacy price / merchant into fields if the
  // agent didn't already set them.
  if (typeof o.price === 'string' && !('Price' in fields)) fields.Price = o.price;
  if (typeof o.merchant === 'string' && !('Merchant' in fields)) fields.Merchant = o.merchant;

  // Description: prefer explicit `description`; fall back to `subtitle`.
  const description = typeof o.description === 'string'
    ? o.description
    : (typeof o.subtitle === 'string' ? o.subtitle : undefined);

  return {
    id,
    image,
    title,
    description,
    fields: Object.keys(fields).length > 0 ? fields : undefined,
    url,
    site,
  };
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isLikelyDecorativeOptionImage(imageUrl: string): boolean {
  let pathname = imageUrl.toLowerCase();
  try {
    const parsed = new URL(imageUrl);
    pathname = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  } catch {
    // Keep the raw string fallback for tests and partially-formed URLs.
  }

  return pathname.includes('airbnbplatformassets')
    || pathname.includes('airbnb-platform-assets')
    || pathname.includes('guestfavorite')
    || pathname.includes('orthographic-images');
}

// ---------------------------------------------------------------------------
// `ask` fence — questionnaire with text-only options.
// ---------------------------------------------------------------------------

/**
 * Parse + validate an ask-form block body. Returns the canonical payload
 * with defaults filled in, or an error string explaining why it was
 * rejected. Per-question validation drops malformed questions; if zero
 * questions survive, the block is rejected.
 *
 * When `partial: true`, falls back to brace-scanning for complete
 * `{...}` question objects mid-stream so questions render as they
 * arrive instead of waiting for the closing fence.
 */
export function parseAskForm(raw: string, opts: { partial?: boolean } = {}): { parsed: AskFormPayload | null; error?: string } {
  let data: unknown = null;
  let fullParseFailed = false;
  try {
    data = JSON.parse(raw);
  } catch {
    fullParseFailed = true;
  }

  if (!fullParseFailed) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { parsed: null, error: 'expected json object at top level' };
    }
    const obj = data as Record<string, unknown>;
    const prompt = typeof obj.prompt === 'string' ? obj.prompt : undefined;
    if (!Array.isArray(obj.questions)) {
      return { parsed: null, error: 'missing required field "questions" (array)' };
    }
    const questions: AskQuestion[] = [];
    for (const rawQ of obj.questions) {
      const valid = validateQuestion(rawQ);
      if (valid) questions.push(valid);
    }
    if (questions.length === 0) {
      return { parsed: null, error: 'no valid questions (each needs question text + at least one option)' };
    }
    return { parsed: { prompt, questions } };
  }

  // Partial path — only when explicitly requested (mid-stream).
  if (!opts.partial) return { parsed: null, error: 'invalid json' };
  return extractPartialAsk(raw);
}

function validateQuestion(raw: unknown): AskQuestion | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const q = raw as Record<string, unknown>;
  const question = typeof q.question === 'string' ? q.question.trim() : '';
  if (!question) return null;
  if (!Array.isArray(q.options)) return null;
  const options: AskOption[] = [];
  for (const item of q.options) {
    const valid = validateAskOption(item);
    if (valid) options.push(valid);
  }
  if (options.length === 0) return null;
  return {
    question,
    header: typeof q.header === 'string' && q.header.trim().length > 0 ? q.header.trim() : undefined,
    multiSelect: typeof q.multiSelect === 'boolean' ? q.multiSelect : false,
    allowOther: typeof q.allowOther === 'boolean' ? q.allowOther : true,
    options,
  };
}

function validateAskOption(raw: unknown): AskOption | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const label = typeof o.label === 'string' ? o.label.trim() : '';
  if (!label) return null;
  return {
    label,
    description: typeof o.description === 'string' ? o.description : undefined,
  };
}

function extractPartialAsk(raw: string): { parsed: AskFormPayload | null; error?: string } {
  let prompt: string | undefined;
  const promptMatch = raw.match(/"prompt"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (promptMatch) {
    try { prompt = JSON.parse(`"${promptMatch[1]}"`); } catch { /* leave undefined */ }
  }
  const bracketIdx = findArrayStart(raw, 'questions');
  if (bracketIdx === -1) return { parsed: null };
  const questions: AskQuestion[] = [];
  for (const slice of walkBalancedObjects(raw, bracketIdx)) {
    try {
      const obj = JSON.parse(slice);
      const v = validateQuestion(obj);
      if (v) questions.push(v);
    } catch {
      // malformed question — skip
    }
  }
  if (questions.length === 0) return { parsed: null };
  return { parsed: { prompt, questions } };
}
