import fs from 'node:fs';
import path from 'node:path';

const MAX_DESCRIPTION_LENGTH = 180;
const DEFAULT_MAX_CHARS = 14_000;

interface SkillIndexEntry {
  id: string;
  source: 'user' | 'interaction' | 'domain';
  title: string;
  description: string;
}

export const SKILL_DISCOVERY_AND_LIFECYCLE_LINES = [
  'Use `agent-skill search` and `agent-skill view` to find relevant skills before inventing browser, site, or workflow-specific steps.',
  'After a task succeeds, create or patch a user skill only when the new procedure is likely to repeat, long-running enough to justify reuse, or generally applicable beyond the current session.',
  'Do not write skills for one-off facts/calculations, temporary page state, secrets/tokens, private account details, failed/speculative workflows, or content that belongs in the task output.',
];

/**
 * Provider-neutral nudge that the renderer can surface structured content
 * (plans, comparisons, multi-step explanations, diffs, status reports) as
 * sandboxed HTML artifacts via ```html fenced blocks. The renderer
 * extracts them and shows them in an iframe — static HTML + CSS only, no
 * JavaScript executes.
 *
 * Theme is injected so the agent picks palette colors that match the
 * current desktop app theme. The 'neobrutalist-html' interaction skill
 * defines the visual rules (borders/shadows/palette); this constant only
 * tells the agent the channel exists and what theme to target.
 */
/**
 * Active-palette summary the agent can paste verbatim. Kept in sync with
 * the 'neobrutalist-html' interaction skill — change them together.
 */
const ACTIVE_PALETTE = {
  light: {
    cardBg: '#f4ecd8',
    border: '#000',
    shadow: '#000',
    fg: '#000',
    accents: 'red #ff2b2b, blue #1a73ff, green #00c853, gold #ffd400',
  },
  dark: {
    cardBg: '#1c1c20',
    border: '#f4ecd8',
    shadow: '#f4ecd8',
    fg: '#f4ecd8',
    accents: 'red #ff5252, blue #4ea3ff, green #3ddc84, gold #ffd400',
  },
} as const;

export function htmlBlockGuidanceLines(theme: 'light' | 'dark' = 'dark'): string[] {
  const p = ACTIVE_PALETTE[theme];
  return [
    `UI THEME: ${theme}. When you emit a \`\`\`html block, use the active palette below. The full per-theme reference lives in the 'neobrutalist-html' interaction skill.`,
    `Active palette — card bg ${p.cardBg}, border ${p.border}, shadow ${p.shadow}, foreground ${p.fg}. Accents: ${p.accents}. Use shadow ${p.shadow} for large structural offset shadows; keep accent colors to small highlights, badges, selected metrics, or short dividers.`,
    'HTML blocks are an optional output channel — use them when layout helps the reader (plans, comparisons, status, timelines, diffs). Also use them for dense, easily organized browser results or confirmations: shopping/cart/order summaries, delivery windows, addresses, prices, quantities, retailer/site names, reservation details, selected items, and next-step choices. Conversational replies, tool previews, and short answers should stay as plain markdown.',
    'Rule of thumb: if you have 3+ concrete facts from the page that naturally fit labeled rows, columns, cards, or a receipt-style summary, emit a compact ```html block instead of burying them in a paragraph.',
    'When you emit an HTML block, keep it self-contained: inline styles or a single inline <style> tag are fine; do not reference external stylesheets, scripts, fonts, or images by URL — the sandbox blocks them.',
  ];
}

/** @deprecated kept for callers that have not yet adopted the theme-aware
 *  function form. Returns the dark-theme variant. */
export const HTML_BLOCK_GUIDANCE_LINES = htmlBlockGuidanceLines('dark');

/**
 * Provider-neutral nudge for the `options` fenced block — the renderer
 * surfaces it as a selectable card picker for human-in-the-loop choice
 * during shopping / disambiguation tasks. The full schema, DOM
 * extraction recipe, and turn-ending rule live in the `options-block`
 * interaction skill.
 */
export function optionsBlockGuidanceLines(): string[] {
  return [
    'When you need the user to disambiguate between products or options that you can see in the live browser (e.g. shopping search results), emit a ```options fenced block carrying JSON: { prompt, multiSelect, min, max, allowOther?, options: [{ id, image, title, url, site, description?, fields?, subtitle?, price?, merchant? }] }. Each option REQUIRES: id, image (absolute URL), title, url (absolute URL to the source listing), and site. The rest are optional.',
    '`image` must be the actual product/listing hero photo, not a badge, favicon, category icon, host avatar, or decorative site asset. For Airbnb, reject `AirbnbPlatformAssets`, `GuestFavorite`, and `orthographic-images` URLs; choose the largest visible listing photo or omit that option.',
    '`site` is the brand token a human would call the site — "Amazon", "Instacart", "Airbnb", "Costco" — not the hostname. No TLD, no `.com`, no `.co.uk`. For long-tail sites with no recognizable brand, use the bare second-level domain ("enginediy", "jadecommercecenter"). The renderer derives the favicon mechanically from `url`; `site` is the display label.',
    '`allowOther` defaults to false. The renderer no longer shows a free-text "Other" card by default — the chat input below the picker already handles "none of these, I want X". Only set `allowOther: true` when the listed options genuinely aren\'t exhaustive and a typed answer is meaningful.',
    'The `options` block ENDS YOUR TURN. After emitting it, do not call any more tools — stop and wait for the user. Their selection arrives as the next user message in the form "Selected from options: <title> (id: <id>)" so you can resume on the same browser session.',
    'See the `options-block` interaction skill for the full schema, DOM-extraction snippet for grabbing image URLs / titles / prices / source URLs from product tiles, and worked examples.',
  ];
}

/**
 * Provider-neutral nudge for the `ask` fenced block — the renderer
 * surfaces it as a text-only questionnaire (radio/checkbox per
 * question, automatic "Other…" text input). For disambiguation and
 * requirements gathering BEFORE you start browsing or building. See
 * the `ask-block` interaction skill for the full schema and examples.
 */
export function askBlockGuidanceLines(): string[] {
  return [
    'When you need the user to answer one or more text-only multiple-choice questions to disambiguate intent or gather requirements (e.g. "what kind of SSD?", "which framework?", "what budget?"), emit a ```ask fenced block carrying JSON: { prompt?, questions: [{ question, header?, multiSelect, allowOther?, options: [{ label, description? }] }] }. Each question must have a `question` string and at least one valid option; the renderer auto-appends an "Other…" text input unless `allowOther: false`.',
    'The `ask` block ENDS YOUR TURN. After emitting it, do not call any more tools — stop and wait for the user. Their answers arrive as the next user message shaped like "Answered:\\n- Capacity: 2 TB\\n- Budget: Other: around $250" so you can resume with the new context.',
    'Choose between `ask` and `options`: use `ask` for text-only choices (form factor, capacity, framework, budget tier). Use `options` for image-driven product/listing picks. See the `ask-block` interaction skill for the full schema and worked examples.',
  ];
}

/**
 * Provider-neutral nudge for the `login` fenced block — the renderer
 * surfaces it as a username/password form with a "log in manually in the
 * browser" escape hatch. The agent reads the credentials from the next
 * user turn and types them into the live browser view. See the
 * `login-block` interaction skill for the full schema and the
 * manual-login fallback contract.
 */
export function loginBlockGuidanceLines(): string[] {
  return [
    'When the live browser hits a login wall and you need the user to provide credentials, emit a ```login fenced block carrying JSON: { site, url, prompt?, usernameLabel?, passwordLabel? }. `site` is the brand token (e.g. "Amazon", not "amazon.com"); `url` is the absolute http(s) login URL.',
    'The `login` block ENDS YOUR TURN. After emitting it, do not call any more tools — stop and wait for the user. Their reply arrives as "Login for <site>:\\nusername: <u>\\npassword: <p>" — type these verbatim into the username/password fields of the live tab, then submit. Do NOT echo the password back in your own response.',
    'The form also offers the user a "log in on <site> myself" affordance that opens the in-app browser view directly; if they take that path you will not get a structured reply, just whatever they type next (e.g. "done"). Treat any plain follow-up message as the signal to resume.',
    'Use `login` only for real credential walls. For multiple-choice disambiguation, use `ask`; for picking among visible options, use `options`. See the `login-block` interaction skill for the full schema and worked examples.',
  ];
}

function normalizeSlash(value: string): string {
  return value.split(path.sep).join('/');
}

function parseFrontmatter(content: string): { data: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: content };
  const data: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) data[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return { data, body: content.slice(match[0].length) };
}

function firstHeading(content: string): string {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? '';
}

function firstParagraph(content: string): string {
  const { body } = parseFrontmatter(content);
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('---')) continue;
    return line.replace(/^[-*]\s+/, '').trim();
  }
  return '';
}

function titleize(slug: string): string {
  return slug
    .split(/[-_./]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function truncate(value: string, max = MAX_DESCRIPTION_LENGTH): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max - 3)}...` : compact;
}

function scanFiles(dir: string, predicate: (abs: string) => boolean, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) scanFiles(abs, predicate, out);
    else if (entry.isFile() && predicate(abs)) out.push(abs);
  }
  return out;
}

function readEntry(file: string, source: SkillIndexEntry['source'], id: string): SkillIndexEntry {
  const content = fs.readFileSync(file, 'utf-8');
  const { data } = parseFrontmatter(content);
  const fallbackTitle = titleize(path.basename(file, path.extname(file)));
  return {
    id,
    source,
    title: String(data.name || firstHeading(content) || fallbackTitle),
    description: truncate(String(data.description || firstParagraph(content) || '')),
  };
}

export function scanSkillIndex(harnessDir: string): SkillIndexEntry[] {
  const entries: SkillIndexEntry[] = [];

  const userRoot = path.join(harnessDir, 'skills');
  for (const file of scanFiles(userRoot, (abs) => path.basename(abs) === 'SKILL.md')) {
    const relDir = normalizeSlash(path.relative(userRoot, path.dirname(file)));
    if (relDir && relDir !== '.') entries.push(readEntry(file, 'user', `user/${relDir}`));
  }

  const interactionRoot = path.join(harnessDir, 'interaction-skills');
  for (const file of scanFiles(interactionRoot, (abs) => abs.endsWith('.md'))) {
    const rel = normalizeSlash(path.relative(interactionRoot, file)).replace(/\.md$/i, '');
    entries.push(readEntry(file, 'interaction', `interaction/${rel}`));
  }

  const domainRoot = path.join(harnessDir, 'domain-skills');
  for (const file of scanFiles(domainRoot, (abs) => abs.endsWith('.md'))) {
    const rel = normalizeSlash(path.relative(domainRoot, file)).replace(/\.md$/i, '');
    entries.push(readEntry(file, 'domain', `domain/${rel}`));
  }

  const order = { user: 0, interaction: 1, domain: 2 };
  return entries.sort((a, b) => order[a.source] - order[b.source] || a.id.localeCompare(b.id));
}

function sectionTitle(source: SkillIndexEntry['source']): string {
  if (source === 'user') return 'User skills';
  if (source === 'interaction') return 'Interaction skills';
  return 'Domain skills';
}

export function buildSkillIndexPrompt(harnessDir: string, maxChars = DEFAULT_MAX_CHARS): string {
  let entries: SkillIndexEntry[];
  try {
    entries = scanSkillIndex(harnessDir);
  } catch {
    return '';
  }
  if (entries.length === 0) return '';

  const lines = [
    '## Available Skills',
    'Compact metadata index only. If a skill looks relevant, load full instructions with `agent-skill view <id>`. Use `agent-skill search "<query>"` when unsure.',
  ];
  let currentSource: SkillIndexEntry['source'] | null = null;
  let included = 0;

  for (const entry of entries) {
    const sectionLines = currentSource === entry.source ? [] : ['', `### ${sectionTitle(entry.source)}`];
    const label = entry.description && entry.description !== entry.title
      ? `- ${entry.id}: ${entry.title} - ${entry.description}`
      : `- ${entry.id}: ${entry.title}`;
    const next = [...sectionLines, label];
    const candidate = [...lines, ...next].join('\n');
    if (candidate.length > maxChars) break;
    lines.push(...next);
    currentSource = entry.source;
    included += 1;
  }

  if (included < entries.length) {
    lines.push('', `Index truncated: ${entries.length - included} more skills omitted. Run \`agent-skill search "<query>"\` for the full local index.`);
  }

  return lines.join('\n');
}
