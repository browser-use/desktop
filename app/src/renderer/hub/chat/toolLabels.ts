import i18n from '../../i18n';

/**
 * Tool name → friendly label + primary-parameter extractor.
 *
 * Mirrors browser_use_cloud/frontend/src/lib/experimental/utils/tool-labels.ts
 * so chat output reads consistently across the Reagan stack.
 *
 * - getToolType: normalizes raw tool names (bash, execute_command, shell, …)
 *   to a small canonical set used for icon/renderer dispatch.
 * - getToolLabel(name, status): returns canonical friendly labels for raw
 *   tool names and aliases. Falls back to Title Case of raw name.
 * - getToolDisplayValue(name, args): one-line primary parameter for the
 *   collapsed pill.
 */

export type ToolCallType =
  | 'bash' | 'read_file' | 'create_file' | 'edit_file'
  | 'glob' | 'grep' | 'python' | 'browse' | 'click'
  | 'scroll' | 'search' | 'type' | 'js' | 'send_keys'
  | 'go_back' | 'wait' | 'switch_tab' | 'close_tab'
  | 'upload' | 'dropdown' | 'move' | 'todo'
  | 'integration_search' | 'integration' | 'unknown';

export type ToolStatus = 'pending' | 'running' | 'completed' | 'error';

const TOOL_TYPES: Record<string, ToolCallType> = {
  bash: 'bash',
  bash_output: 'bash',
  kill_bash: 'bash',
  execute_command: 'bash',
  run_command: 'bash',
  command_execution: 'bash',
  shell: 'bash',
  read: 'read_file',
  read_file: 'read_file',
  write: 'create_file',
  write_file: 'create_file',
  create_file: 'create_file',
  edit: 'edit_file',
  edit_file: 'edit_file',
  multi_edit: 'edit_file',
  multiedit: 'edit_file',
  replace_in_file: 'edit_file',
  glob: 'glob',
  glob_tool: 'glob',
  grep: 'grep',
  python: 'python',
  browser_navigate: 'browse',
  navigate: 'browse',
  go_to_url: 'browse',
  webfetch: 'browse',
  fetch: 'browse',
  browser_click: 'click',
  click: 'click',
  click_element: 'click',
  browser_scroll: 'scroll',
  scroll_down: 'scroll',
  scroll_up: 'scroll',
  scroll_to_bottom: 'scroll',
  scroll_to_top: 'scroll',
  web_search: 'search',
  websearch: 'search',
  browser_search: 'search',
  search: 'search',
  browser_input: 'type',
  input_text: 'type',
  type: 'type',
  browser_evaluate: 'js',
  browser_send_keys: 'send_keys',
  browser_go_back: 'go_back',
  go_back: 'go_back',
  browser_wait: 'wait',
  wait: 'wait',
  browser_switch_tab: 'switch_tab',
  browser_close_tab: 'close_tab',
  browser_upload_file: 'upload',
  file_upload: 'upload',
  browser_select_dropdown: 'dropdown',
  browser_dropdown_options: 'dropdown',
  browser_find_text: 'search',
  move_mouse: 'move',
  todo_write: 'todo',
};

export function getToolType(toolName: string | undefined): ToolCallType {
  if (!toolName) return 'unknown';
  return TOOL_TYPES[toolName.toLowerCase()] ?? 'unknown';
}

const TOOL_LABELS: Record<string, { active: string; completed: string }> = {
  bash: { active: i18n.t('Running command'), completed: i18n.t('Ran command') },
  command_execution: { active: i18n.t('Running command'), completed: i18n.t('Ran command') },
  shell: { active: i18n.t('Running command'), completed: i18n.t('Ran command') },
  execute_command: { active: i18n.t('Running command'), completed: i18n.t('Ran command') },
  run_command: { active: i18n.t('Running command'), completed: i18n.t('Ran command') },
  bash_output: { active: i18n.t('Getting output'), completed: i18n.t('Got output') },
  kill_bash: { active: i18n.t('Killing process'), completed: i18n.t('Killed process') },
  read: { active: i18n.t('Reading file'), completed: i18n.t('Read file') },
  read_file: { active: i18n.t('Reading file'), completed: i18n.t('Read file') },
  write: { active: i18n.t('Writing file'), completed: i18n.t('Wrote file') },
  write_file: { active: i18n.t('Writing file'), completed: i18n.t('Wrote file') },
  create_file: { active: i18n.t('Creating file'), completed: i18n.t('Created file') },
  edit: { active: i18n.t('Editing file'), completed: i18n.t('Edited file') },
  edit_file: { active: i18n.t('Editing file'), completed: i18n.t('Edited file') },
  multi_edit: { active: i18n.t('Editing file'), completed: i18n.t('Edited file') },
  multiedit: { active: i18n.t('Editing file'), completed: i18n.t('Edited file') },
  glob: { active: i18n.t('Finding files'), completed: i18n.t('Found files') },
  grep: { active: i18n.t('Searching files'), completed: i18n.t('Searched files') },
  python: { active: i18n.t('Running Python'), completed: i18n.t('Ran Python') },
  navigate: { active: i18n.t('Opening page'), completed: i18n.t('Opened page') },
  browser_navigate: { active: i18n.t('Opening page'), completed: i18n.t('Opened page') },
  go_to_url: { active: i18n.t('Opening page'), completed: i18n.t('Opened page') },
  webfetch: { active: i18n.t('Fetching page'), completed: i18n.t('Fetched page') },
  fetch: { active: i18n.t('Fetching page'), completed: i18n.t('Fetched page') },
  click: { active: i18n.t('Clicking'), completed: i18n.t('Clicked') },
  browser_click: { active: i18n.t('Clicking'), completed: i18n.t('Clicked') },
  click_element: { active: i18n.t('Clicking'), completed: i18n.t('Clicked') },
  type: { active: i18n.t('Typing'), completed: i18n.t('Typed') },
  input_text: { active: i18n.t('Typing'), completed: i18n.t('Typed') },
  browser_input: { active: i18n.t('Typing'), completed: i18n.t('Typed') },
  search: { active: i18n.t('Searching'), completed: i18n.t('Searched') },
  web_search: { active: i18n.t('Searching web'), completed: i18n.t('Searched web') },
  websearch: { active: i18n.t('Searching web'), completed: i18n.t('Searched web') },
  screenshot: { active: i18n.t('Taking screenshot'), completed: i18n.t('Took screenshot') },
  todo_write: { active: i18n.t('Updating todos'), completed: i18n.t('Updated todos') },
  wait: { active: i18n.t('Waiting'), completed: i18n.t('Waited') },
};

const CANONICAL_TOOL_LABELS: Partial<Record<ToolCallType, { active: string; completed: string }>> = {
  bash: { active: i18n.t('Running command'), completed: i18n.t('Ran command') },
  read_file: { active: i18n.t('Reading file'), completed: i18n.t('Read file') },
  create_file: { active: i18n.t('Creating file'), completed: i18n.t('Created file') },
  edit_file: { active: i18n.t('Editing file'), completed: i18n.t('Edited file') },
  glob: { active: i18n.t('Finding files'), completed: i18n.t('Found files') },
  grep: { active: i18n.t('Searching files'), completed: i18n.t('Searched files') },
  python: { active: i18n.t('Running Python'), completed: i18n.t('Ran Python') },
  browse: { active: i18n.t('Opening page'), completed: i18n.t('Opened page') },
  click: { active: i18n.t('Clicking'), completed: i18n.t('Clicked') },
  scroll: { active: i18n.t('Scrolling'), completed: i18n.t('Scrolled') },
  search: { active: i18n.t('Searching'), completed: i18n.t('Searched') },
  type: { active: i18n.t('Typing'), completed: i18n.t('Typed') },
  js: { active: i18n.t('Running JavaScript'), completed: i18n.t('Ran JavaScript') },
  send_keys: { active: i18n.t('Pressing keys'), completed: i18n.t('Pressed keys') },
  go_back: { active: i18n.t('Going back'), completed: i18n.t('Went back') },
  wait: { active: i18n.t('Waiting'), completed: i18n.t('Waited') },
  switch_tab: { active: i18n.t('Switching tab'), completed: i18n.t('Switched tab') },
  close_tab: { active: i18n.t('Closing tab'), completed: i18n.t('Closed tab') },
  upload: { active: i18n.t('Uploading file'), completed: i18n.t('Uploaded file') },
  dropdown: { active: i18n.t('Selecting option'), completed: i18n.t('Selected option') },
  move: { active: i18n.t('Moving pointer'), completed: i18n.t('Moved pointer') },
  todo: { active: i18n.t('Updating todos'), completed: i18n.t('Updated todos') },
  integration_search: { active: i18n.t('Searching integrations'), completed: i18n.t('Searched integrations') },
  integration: { active: i18n.t('Using integration'), completed: i18n.t('Used integration') },
};

export function getToolLabel(toolName: string | undefined, status: ToolStatus = 'pending'): string {
  if (!toolName) return i18n.t('Unknown action');
  const labels = TOOL_LABELS[toolName.toLowerCase()] ?? CANONICAL_TOOL_LABELS[getToolType(toolName)];
  if (!labels) {
    return toolName
      .split(/[_\s]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  const done = status === 'completed' || status === 'error';
  return done ? labels.completed : labels.active;
}

function tryParseJSON(str: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(str);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* ignore */ }
  return null;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function getStructuredToolArgs(argsContent: string): Record<string, unknown> | null {
  const parsed = tryParseJSON(argsContent);
  if (!parsed) return null;
  // Unwrap Codex-style nested {id, type, command_execution: {...}}
  for (const v of Object.values(parsed)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = v as Record<string, unknown>;
      if ('command' in inner || 'url' in inner || 'file_path' in inner) return inner;
    }
  }
  return parsed;
}

/**
 * Pull a one-line "primary parameter" out of a tool_call args payload.
 * Handles flat (Claude) and nested (Codex `{id, type, command_execution: {command}}`)
 * shapes. Returns '' when nothing useful surfaces.
 */
export function getToolDisplayValue(toolName: string | undefined, argsContent: string): string {
  const args = getStructuredToolArgs(argsContent);
  const type = getToolType(toolName);

  if (args) {
    switch (type) {
      case 'browse':
        return asString(args.url) ?? '';
      case 'search':
        return asString(args.query) ?? asString(args.q) ?? '';
      case 'read_file':
      case 'create_file':
      case 'edit_file':
        return asString(args.file_path) ?? asString(args.path) ?? asString(args.filename) ?? '';
      case 'bash': {
        const cmd = asString(args.command) ?? asString(args.cmd);
        return cmd ? truncate(cmd.split('\n')[0], 80) : '';
      }
      case 'glob':
      case 'grep':
        return asString(args.pattern) ?? '';
      case 'type':
        return asString(args.text) ?? '';
      case 'js': {
        const code = asString(args.script) ?? asString(args.code) ?? asString(args.expression);
        return code ? truncate(code, 60) : '';
      }
      case 'send_keys':
        return asString(args.keys) ?? '';
      default: {
        // Generic fallback: first string-valued field that's short enough.
        for (const v of Object.values(args)) {
          const s = asString(v);
          if (s && s.length < 200) return truncate(s.split('\n')[0], 80);
        }
        return '';
      }
    }
  }

  // Not JSON — argsContent IS the primary value.
  return truncate(argsContent.split('\n')[0], 80);
}

export function getToolBashCommand(toolName: string | undefined, argsContent: string): string {
  if (getToolType(toolName) !== 'bash') return '';
  const args = getStructuredToolArgs(argsContent);
  if (args) {
    return asString(args.command) ?? asString(args.cmd) ?? '';
  }
  return argsContent;
}

/**
 * Parse bash backend wrappers. Codex (and browser-harness) wrap shell results
 * as { stdout, stderr, exit_code, status, duration_ms, aggregated_output, ... }.
 * Returns the human-meaningful output, an error flag, and the duration if
 * present. Falls back to raw text when the wrapper shape isn't recognized.
 */
export interface BashResult {
  output: string;
  isError: boolean;
  durationMs?: number;
}

/**
 * Decode a JSON-encoded string field manually — handles \n, \t, \", \\ and
 * \uXXXX. Used as a fallback when JSON.parse fails because the codex adapter
 * sliced the result to 2000 chars and broke the JSON tail.
 */
function decodeJsonString(s: string): string {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/**
 * Extract a single string field from a JSON-ish blob even when truncated.
 * Looks for `"<field>":"..."` and returns the decoded inner string. Returns
 * undefined if no match. Safe against unterminated strings (greedy stop on
 * the next unescaped `"` followed by `,` `}` or end).
 */
function extractJsonField(raw: string, field: string): string | undefined {
  const re = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`, 'm');
  const m = raw.match(re);
  if (!m) return undefined;
  return decodeJsonString(m[1]);
}

function extractJsonNumberField(raw: string, field: string): number | undefined {
  const re = new RegExp(`"${field}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, 'm');
  const m = raw.match(re);
  if (!m) return undefined;
  const value = Number(m[1]);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Friendly summary of a bash command for the collapsed tool pill.
 *
 * Strips the surrounding shell wrapper (e.g. `/bin/zsh -lc "..."`) and
 * pattern-matches the inner command against ~20 common shapes (cat, sed, ls,
 * git, grep, curl, npm, heredocs, …). Returns `null` when nothing matches so
 * callers can fall back to the default "Ran command" + raw-cmd display.
 *
 * Deterministic and offline. No semantic interpretation of filenames — `cat
 * AGENTS.md` becomes "Read AGENTS.md", not "Read agent instructions".
 */
export interface BashSummary {
  active: string;
  completed: string;
  value: string;
}

function basename(p: string): string {
  const stripped = p.replace(/['"]/g, '');
  const idx = stripped.lastIndexOf('/');
  return idx === -1 ? stripped : stripped.slice(idx + 1) || stripped;
}

/**
 * Unwrap `/bin/zsh -lc "<inner>"` / `bash -c '<inner>'` / etc. to surface the
 * actual command. Returns the original string if no wrapper is detected.
 *
 * Implemented without a backreferenced regex on the inner body because real
 * sessions.db payloads contain heredocs with embedded quote-switching tricks
 * (`"'`...`'"`) that defeat backreference matching. Instead: locate the prefix
 * + opening quote, then require the final character to be the same quote.
 */
export function stripShellWrapper(cmd: string): string {
  const trimmed = cmd.trim();
  const prefix = trimmed.match(/^(?:\S*\/)?(?:zsh|bash|sh|dash)\s+-[lc]+\s+(['"])/);
  if (!prefix) return trimmed;
  const openIdx = prefix[0].length - 1;
  const quote = prefix[1];
  const body = trimmed.slice(openIdx + 1);
  // Strict: body ends with the same quote that opened — strip exactly one.
  if (body.endsWith(quote)) return body.slice(0, -1).trim();
  // Permissive: real sessions.db payloads sometimes have malformed wrappers
  // (e.g. heredoc body containing `EOF'` before the closing `"`). Strip any
  // single trailing quote rather than losing the whole command.
  return body.replace(/['"]\s*$/, '').trim();
}

type Pattern = { re: RegExp; build: (m: RegExpMatchArray) => BashSummary };

/**
 * Pattern-match the JS body of a `browser-harness-js '<JS>'` (or heredoc)
 * invocation. The harness API is well-defined in
 * `app/src/main/hl/stock/browser-harness-js/SKILL.md` — each match below
 * corresponds to a single, unambiguous CDP method. Anything not matched
 * returns null so the caller can fall through rather than guess.
 */
// Rendering convention for these summaries:
//   • The `value` slot is shown muted/secondary in the chat pill — reserve it
//     for SPECIFIC IDENTIFIERS (URLs, filenames, branches, search patterns).
//   • When the action's target is a generic noun ("browser", "page", "tests"),
//     fold the noun into the bold label and leave value empty. Otherwise the
//     chip reads awkwardly: bold "Connected to" + muted "the browser".
// Ordered most-specific to least. Scripts often bundle `connect + navigate +
// evaluate` — when that happens the *user-visible* action (navigate, click,
// screenshot) should label the pill, not the scaffolding (`connect`). So
// connect/auto-detect sit at the bottom.
const BROWSER_JS_PATTERNS: Pattern[] = [
  // page.goto(URL) — Puppeteer-style call. Not in our harness API, but agents
  // try it routinely and the intent (navigate) is unambiguous from the call
  // shape. Treat as a navigate.
  { re: /\bpage\.goto\s*\(\s*['"`]([^'"`]+)['"`]/, build: (m) => ({ active: i18n.t('Visiting'), completed: i18n.t('Visited'), value: m[1] }) },
  // Input — explicit user-driven actions
  { re: /\bInput\.dispatchMouseEvent\b/, build: () => ({ active: i18n.t('Clicking on page'), completed: i18n.t('Clicked on page'), value: '' }) },
  { re: /\bInput\.insertText\b/, build: () => ({ active: i18n.t('Typing on page'), completed: i18n.t('Typed on page'), value: '' }) },
  { re: /\bInput\.dispatchKeyEvent\b/, build: () => ({ active: i18n.t('Pressing key'), completed: i18n.t('Pressed key'), value: '' }) },
  // Navigation — surface URL as the specific value when present
  { re: /\bPage\.navigate\b[\s\S]*?url\s*:\s*['"`]([^'"`]+)['"`]/, build: (m) => ({ active: i18n.t('Visiting'), completed: i18n.t('Visited'), value: m[1] }) },
  { re: /\bPage\.navigate\b/, build: () => ({ active: i18n.t('Visiting page'), completed: i18n.t('Visited page'), value: '' }) },
  { re: /\bPage\.reload\b/, build: () => ({ active: i18n.t('Reloading page'), completed: i18n.t('Reloaded page'), value: '' }) },
  // Captures
  { re: /\bPage\.captureScreenshot\b/, build: () => ({ active: i18n.t('Taking screenshot'), completed: i18n.t('Took screenshot'), value: '' }) },
  { re: /\bPage\.printToPDF\b/, build: () => ({ active: i18n.t('Saving page as PDF'), completed: i18n.t('Saved page as PDF'), value: '' }) },
  // DOM inspection
  { re: /\bDOM\.(?:querySelector|getDocument|describeNode|getAttributes|getOuterHTML)\b/, build: () => ({ active: i18n.t('Inspecting page'), completed: i18n.t('Inspected page'), value: '' }) },
  // Runtime.evaluate — only mapped when the expression reads well-known
  // document/location properties (the agent's bread-and-butter state read).
  // Anything else falls through — arbitrary JS, intent unknowable.
  {
    re: /\bRuntime\.evaluate\b[\s\S]*?expression\s*:\s*['"`][\s\S]*?(?:document\.title|document\.body|document\.readyState|location\.href|location\.host)/,
    build: () => ({ active: i18n.t('Looking at page'), completed: i18n.t('Looked at page'), value: '' }),
  },
  // Tabs / targets
  { re: /\blistPageTargets\s*\(/, build: () => ({ active: i18n.t('Listing open tabs'), completed: i18n.t('Listed open tabs'), value: '' }) },
  { re: /\bsession\.use\s*\(/, build: () => ({ active: i18n.t('Switching tab'), completed: i18n.t('Switched tab'), value: '' }) },
  { re: /\bTarget\.closeTarget\b/, build: () => ({ active: i18n.t('Closing tab'), completed: i18n.t('Closed tab'), value: '' }) },
  { re: /\bdetectBrowsers\s*\(/, build: () => ({ active: i18n.t('Looking for open browsers'), completed: i18n.t('Looked for open browsers'), value: '' }) },
  // Connection — scaffolding, lowest priority
  { re: /\bconnectToAssignedTarget\s*\(/, build: () => ({ active: i18n.t('Connecting to browser'), completed: i18n.t('Connected to browser'), value: '' }) },
  { re: /\bsession\.connect\s*\(/, build: () => ({ active: i18n.t('Connecting to browser'), completed: i18n.t('Connected to browser'), value: '' }) },
];

function summarizeBrowserHarnessJs(code: string): BashSummary | null {
  for (const { re, build } of BROWSER_JS_PATTERNS) {
    const m = code.match(re);
    if (m) return build(m);
  }
  return null;
}

/**
 * Extract the JS payload from a `browser-harness-js` invocation, handling
 * both inline (`browser-harness-js 'CODE'`) and heredoc (`<<EOF…EOF`) forms.
 */
function extractBrowserHarnessJs(cmd: string): string | null {
  const inline = cmd.match(/^(?:\S*\/)?browser-harness(?:-js)?\s+(['"])([\s\S]+)\1\s*$/);
  if (inline) return inline[2];
  const here = cmd.match(/^(?:\S*\/)?browser-harness(?:-js)?\s+<<-?\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1/);
  if (here) return here[2];
  return null;
}

// Plain-English labels. Optimized for a non-technical observer watching the
// agent work — no developer jargon (no "git", "dependencies", "directory",
// "stash"). Verbs are mundane ("Read", "Looked", "Saved"); values name the
// target in everyday terms.
const BASH_PATTERNS: Pattern[] = [
  // sed / head / tail / cat / less / more / bat FILE → "Read FILE"
  {
    re: /^sed\s+-n\s+['"](?:\d+,)?\d+p['"]\s+(\S+)/,
    build: (m) => ({ active: i18n.t('Reading'), completed: i18n.t('Read'), value: basename(m[1]) }),
  },
  {
    re: /^(?:cat|less|more|bat)\s+(\S+)\s*$/,
    build: (m) => ({ active: i18n.t('Reading'), completed: i18n.t('Read'), value: basename(m[1]) }),
  },
  {
    re: /^(?:head|tail)(?:\s+-n\s+\d+)?\s+(\S+)\s*$/,
    build: (m) => ({ active: i18n.t('Reading'), completed: i18n.t('Read'), value: basename(m[1]) }),
  },
  // ls [flags] [path]
  {
    re: /^ls(?:\s+-\S+)*(?:\s+(\S+))?\s*$/,
    build: (m) => m[1]
      ? { active: i18n.t('Looking at'), completed: i18n.t('Looked at'), value: basename(m[1]) }
      : { active: i18n.t('Looking at files'), completed: i18n.t('Looked at files'), value: '' },
  },
  // find PATH …
  {
    re: /^find\s+/,
    build: () => ({ active: i18n.t('Looking for files'), completed: i18n.t('Looked for files'), value: '' }),
  },
  // grep / rg / ag PATTERN
  {
    re: /^(?:grep|rg|ag)\s+(?:-\S+\s+)*(?:(['"])([^'"]+)\1|(\S+))/,
    build: (m) => ({ active: i18n.t('Searching for'), completed: i18n.t('Searched for'), value: m[2] ?? m[3] ?? '' }),
  },
  // git → plain-English equivalents (generic targets folded into label)
  { re: /^git\s+(?:status|diff|log|show)\b/, build: () => ({ active: i18n.t('Reviewing recent changes'), completed: i18n.t('Reviewed recent changes'), value: '' }) },
  { re: /^git\s+branch\b/, build: () => ({ active: i18n.t('Looking at versions'), completed: i18n.t('Looked at versions'), value: '' }) },
  { re: /^git\s+add\b/, build: () => ({ active: i18n.t('Marking changes to save'), completed: i18n.t('Marked changes to save'), value: '' }) },
  { re: /^git\s+commit\b/, build: () => ({ active: i18n.t('Saving progress'), completed: i18n.t('Saved progress'), value: '' }) },
  { re: /^git\s+push\b/, build: () => ({ active: i18n.t('Sending changes to the cloud'), completed: i18n.t('Sent changes to the cloud'), value: '' }) },
  { re: /^git\s+pull\b/, build: () => ({ active: i18n.t('Getting latest changes'), completed: i18n.t('Got latest changes'), value: '' }) },
  { re: /^git\s+checkout\s+(\S+)/, build: (m) => ({ active: i18n.t('Switching to'), completed: i18n.t('Switched to'), value: m[1] }) },
  { re: /^git\s+blame\s+(\S+)/, build: (m) => ({ active: i18n.t('Looking at history of'), completed: i18n.t('Looked at history of'), value: basename(m[1]) }) },
  { re: /^git\s+stash\b/, build: () => ({ active: i18n.t('Setting aside changes'), completed: i18n.t('Set aside changes'), value: '' }) },
  { re: /^git\s+(?:rebase|merge|fetch)\b/, build: () => ({ active: i18n.t('Syncing changes'), completed: i18n.t('Synced changes'), value: '' }) },
  // network → "Visited URL"
  { re: /^(?:curl|wget|http|httpie)\s+(?:-\S+\s+)*(\S+)/, build: (m) => ({ active: i18n.t('Visiting'), completed: i18n.t('Visited'), value: m[1] }) },
  // file ops in plain English
  { re: /^mkdir\s+(?:-\S+\s+)*(\S+)/, build: (m) => ({ active: i18n.t('Creating folder'), completed: i18n.t('Created folder'), value: basename(m[1]) }) },
  { re: /^touch\s+(\S+)/, build: (m) => ({ active: i18n.t('Creating'), completed: i18n.t('Created'), value: basename(m[1]) }) },
  { re: /^mv\s+\S+\s+(\S+)/, build: (m) => ({ active: i18n.t('Moving file to'), completed: i18n.t('Moved file to'), value: basename(m[1]) }) },
  { re: /^cp\s+(?:-\S+\s+)*\S+\s+(\S+)/, build: (m) => ({ active: i18n.t('Copying file to'), completed: i18n.t('Copied file to'), value: basename(m[1]) }) },
  { re: /^rm\s+(?:-\S+\s+)*(\S+)/, build: (m) => ({ active: i18n.t('Deleting'), completed: i18n.t('Deleted'), value: basename(m[1]) }) },
  { re: /^chmod\s+\S+\s+(\S+)/, build: (m) => ({ active: i18n.t('Updating access for'), completed: i18n.t('Updated access for'), value: basename(m[1]) }) },
  // redirection → "Saved to FILE"
  { re: /^echo\s+.+\s+>>\s+(\S+)/, build: (m) => ({ active: i18n.t('Adding to'), completed: i18n.t('Added to'), value: basename(m[1]) }) },
  { re: /^echo\s+.+\s+>\s+(\S+)/, build: (m) => ({ active: i18n.t('Saving to'), completed: i18n.t('Saved to'), value: basename(m[1]) }) },
  // package managers
  { re: /^(?:npm|yarn|pnpm|bun)\s+(?:install|add|i)\b/, build: () => ({ active: i18n.t('Installing tools'), completed: i18n.t('Installed tools'), value: '' }) },
  { re: /^(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?(test|tests)\b/, build: () => ({ active: i18n.t('Running tests'), completed: i18n.t('Ran tests'), value: '' }) },
  { re: /^(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?build\b/, build: () => ({ active: i18n.t('Building project'), completed: i18n.t('Built project'), value: '' }) },
  { re: /^(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?(lint|typecheck|format)\b/, build: () => ({ active: i18n.t('Checking code'), completed: i18n.t('Checked code'), value: '' }) },
  { re: /^(?:npm|yarn|pnpm|bun)\s+run\s+(\S+)/, build: (m) => ({ active: i18n.t('Running'), completed: i18n.t('Ran'), value: m[1] }) },
  // process / env / navigation
  { re: /^cd\s+(?:"([^"]*)"|'([^']*)'|(\S+))\s*$/, build: (m) => ({ active: i18n.t('Changing folder to'), completed: i18n.t('Changed folder to'), value: basename(m[1] ?? m[2] ?? m[3] ?? '') }) },
  { re: /^pwd\b/, build: () => ({ active: i18n.t('Checking current folder'), completed: i18n.t('Checked current folder'), value: '' }) },
  { re: /^which\s+(\S+)/, build: (m) => ({ active: i18n.t('Finding'), completed: i18n.t('Found'), value: m[1] }) },
  { re: /^env\b/, build: () => ({ active: i18n.t('Checking settings'), completed: i18n.t('Checked settings'), value: '' }) },
  // Known scripting binaries — only map when we can be 100% sure of the
  // intent from the binary alone. Browser-harness-js calls vary too widely
  // (connect / navigate / click / DOM check), so it's intentionally absent
  // and falls through to the generic "Ran <binary>" path below.
  {
    re: /^(?:\S*\/)?python3?\b(?:.*-c\b|.*<<)?/,
    build: () => ({ active: i18n.t('Running Python code'), completed: i18n.t('Ran Python code'), value: '' }),
  },
  {
    re: /^(?:\S*\/)?node\b(?:.*-e\b|.*<<)?/,
    build: () => ({ active: i18n.t('Running JavaScript code'), completed: i18n.t('Ran JavaScript code'), value: '' }),
  },
  {
    re: /^(?:\S*\/)?(?:psql|sqlite3|mysql)\b/,
    build: () => ({ active: i18n.t('Querying database'), completed: i18n.t('Queried database'), value: '' }),
  },
  {
    re: /^ssh\b/,
    build: () => ({ active: i18n.t('Running remote command'), completed: i18n.t('Ran remote command'), value: '' }),
  },
  // heredoc → known binaries get plain-English mapping, unknowns fall back to
  // the binary name (better than the vague "a script" — at least it's
  // distinguishable from other actions).
  {
    re: /^(\S+)[\s\S]*<<-?\s*['"]?\w+['"]?/,
    build: (m) => {
      const bin = basename(m[1]);
      const known: Record<string, BashSummary> = {
        python: { active: i18n.t('Running Python code'), completed: i18n.t('Ran Python code'), value: '' },
        python3: { active: i18n.t('Running Python code'), completed: i18n.t('Ran Python code'), value: '' },
        node: { active: i18n.t('Running JavaScript code'), completed: i18n.t('Ran JavaScript code'), value: '' },
        psql: { active: i18n.t('Querying database'), completed: i18n.t('Queried database'), value: '' },
        sqlite3: { active: i18n.t('Querying database'), completed: i18n.t('Queried database'), value: '' },
        ssh: { active: i18n.t('Running remote command'), completed: i18n.t('Ran remote command'), value: '' },
      };
      return known[bin] ?? { active: i18n.t('Running'), completed: i18n.t('Ran'), value: bin };
    },
  },
];

export function summarizeBashCommand(rawCmd: string | undefined): BashSummary | null {
  if (!rawCmd) return null;
  let inner = stripShellWrapper(rawCmd);
  // `cd /path && <real command>` — the real action is what comes after; strip
  // the cd prefix so the label reflects the actual intent. Accept quoted
  // paths (cd "/Application Support/…") since those have embedded spaces.
  inner = inner.replace(/^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, '');

  // browser-harness-js: pattern-match the JS payload to identify the CDP call.
  // When the inline quoting is malformed (truncated previews, multi-statement
  // scripts with unbalanced quotes, etc.) extractBrowserHarnessJs gives up —
  // fall back to scanning the raw inner string, since the same method calls
  // we look for are unambiguous wherever they appear.
  if (/^(?:\S*\/)?browser-harness(?:-js)?\b/.test(inner)) {
    const js = extractBrowserHarnessJs(inner) ?? inner;
    const browserSummary = summarizeBrowserHarnessJs(js);
    if (browserSummary) return browserSummary;
    return null;
  }

  for (const { re, build } of BASH_PATTERNS) {
    const m = inner.match(re);
    if (m) return build(m);
  }
  return null;
}

export function parseBashResult(raw: string | undefined): BashResult {
  if (!raw) return { output: '', isError: false };
  const parsed = tryParseJSON(raw);

  // Try the structured fields first. If JSON.parse fails (often because the
  // upstream adapter sliced the JSON to a 2000-char preview and the tail is
  // missing), fall back to regex extraction of the known keys.
  const stdout = asString(parsed?.stdout)?.trim() ?? extractJsonField(raw, 'stdout')?.trim() ?? '';
  const stderr = asString(parsed?.stderr)?.trim() ?? extractJsonField(raw, 'stderr')?.trim() ?? '';
  const aggregated = asString(parsed?.aggregated_output)?.trim()
    ?? extractJsonField(raw, 'aggregated_output')?.trim() ?? '';
  const exit = typeof parsed?.exit_code === 'number' ? parsed.exit_code : extractJsonNumberField(raw, 'exit_code') ?? null;
  const status = asString(parsed?.status) ?? extractJsonField(raw, 'status');
  const duration = typeof parsed?.duration_ms === 'number' ? parsed.duration_ms : extractJsonNumberField(raw, 'duration_ms');
  const isError = (exit !== null && exit !== 0) || status === 'failed' || (!!stderr && !stdout && !aggregated);

  const output = isError && stderr
    ? stderr
    : stdout || aggregated || stderr || (parsed ? JSON.stringify(parsed, null, 2) : raw.trim());

  return { output, isError, durationMs: duration };
}
