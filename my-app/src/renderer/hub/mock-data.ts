import type { AgentSession, HlEvent } from './types';

const NOW = Date.now();

const slackSession: AgentSession = {
  id: 'session-1',
  prompt: 'Summarise last week\'s Slack threads into a brief',
  status: 'stopped',
  createdAt: NOW - 7 * 60 * 1000,
  group: 'comms',
  output: [
    { type: 'thinking', text: 'I need to fetch Slack messages from the past 7 days, filter threads with significant activity, then summarise the key topics.' },
    { type: 'tool_call', name: 'slack.list_channels', args: { limit: 50 }, iteration: 1 },
    { type: 'tool_result', name: 'slack.list_channels', ok: true, preview: 'Found 12 active channels: #engineering, #product, #design, #general, #incidents, #deployments, #frontend, #backend, #infra, #standup, #random, #announcements', ms: 2000 },
    { type: 'tool_call', name: 'slack.search_messages', args: { query: 'after:2026-04-11', channels: ['engineering', 'product', 'incidents'] }, iteration: 2 },
    { type: 'tool_result', name: 'slack.search_messages', ok: true, preview: 'Retrieved 142 messages across 8 channels. 23 threads with > 3 replies.', ms: 5000 },
    { type: 'thinking', text: 'The most active threads are in #incidents (API latency spike on Tuesday) and #product (Q3 roadmap discussion). I\'ll group by topic.' },
    { type: 'tool_call', name: 'file.write', args: { path: 'weekly-brief.md', content: '# Weekly Brief\n## Key Topics\n1. API latency incident...' }, iteration: 3 },
    { type: 'tool_result', name: 'file.write', ok: true, preview: 'File written: weekly-brief.md (1.2 KB)', ms: 1000 },
    { type: 'done', summary: 'Brief ready. 6 key topics identified across 23 active threads:\n\n1. API latency spike (Tuesday) — resolved, root cause was connection pool exhaustion\n2. Q3 roadmap priorities — 3 new features approved\n3. Design system v2 migration — 60% complete\n4. New hire onboarding feedback — 2 action items\n5. CI pipeline optimization — build times reduced 40%\n6. Customer escalation from Acme Corp — resolved', iterations: 3 },
  ],
};

const memoryLeakSession: AgentSession = {
  id: 'session-2',
  prompt: 'Find and fix the memory leak in the renderer process',
  status: 'running',
  createdAt: NOW - 90 * 1000,
  group: 'engineering',
  output: [
    { type: 'thinking', text: 'Memory leaks in Electron renderers are typically caused by detached DOM nodes, uncleaned event listeners, or closures holding stale references. I\'ll start with a heap snapshot comparison.' },
    { type: 'tool_call', name: 'shell.exec', args: { command: 'node --inspect scripts/heap-snapshot.js' }, iteration: 1 },
    { type: 'tool_result', name: 'shell.exec', ok: true, preview: 'Heap snapshot saved: snapshot-before.heapsnapshot (24.3 MB)\nHeap snapshot saved: snapshot-after.heapsnapshot (31.7 MB)\nDelta: +7.4 MB after 50 tab switches', ms: 5000 },
    { type: 'thinking', text: 'The 7.4 MB growth after 50 tab switches is significant. Let me analyze the retained objects to find the leak source.' },
    { type: 'tool_call', name: 'grep.search', args: { pattern: 'addEventListener', path: 'src/renderer/', type: 'ts' }, iteration: 2 },
    { type: 'tool_result', name: 'grep.search', ok: true, preview: 'Found 18 matches in 7 files:\n  src/renderer/shell/TabBar.tsx:45 — window.addEventListener(\'resize\', handleResize)\n  src/renderer/shell/WebViewManager.tsx:112 — webview.addEventListener(\'dom-ready\', onReady)\n  src/renderer/shell/WebViewManager.tsx:113 — webview.addEventListener(\'did-navigate\', onNavigate)', ms: 3000 },
    { type: 'tool_call', name: 'file.read', args: { path: 'src/renderer/shell/WebViewManager.tsx', lines: '100-140' }, iteration: 3 },
    { type: 'tool_result', name: 'file.read', ok: true, preview: 'Lines 100-140 of WebViewManager.tsx — useEffect cleanup missing removeEventListener for dom-ready and did-navigate handlers. These accumulate across tab switches.', ms: 2000 },
    { type: 'thinking', text: 'Found it. WebViewManager.tsx adds event listeners in useEffect but never removes them. Each tab switch mounts a new component instance, adding more listeners without cleaning up old ones. I\'ll add proper cleanup.' },
  ],
};

const okrSession: AgentSession = {
  id: 'session-3',
  prompt: 'Draft Q2 OKR document from Notion pages',
  status: 'stuck',
  createdAt: NOW - 25 * 60 * 1000,
  group: 'comms',
  output: [
    { type: 'thinking', text: 'I\'ll connect to the Notion API, fetch the Q2 planning pages, and structure them into an OKR format.' },
    { type: 'tool_call', name: 'notion.search', args: { query: 'Q2 2026 OKR', filter: { property: 'object', value: 'page' } }, iteration: 1 },
    { type: 'tool_result', name: 'notion.search', ok: true, preview: 'Found 3 pages: "Q2 Planning", "Engineering Goals Q2", "Product Roadmap Q2"', ms: 10000 },
    { type: 'tool_call', name: 'notion.get_page', args: { page_id: 'abc-123-def' }, iteration: 2 },
    { type: 'error', message: 'Notion API rate limit exceeded (429). Retry-After: 60s. The API has been returning 429 for the last 3 attempts.' },
    { type: 'thinking', text: 'Rate limited by Notion. I\'ve exhausted retries. Waiting for user intervention or API quota reset.' },
  ],
};

const draftSession: AgentSession = {
  id: 'session-4',
  prompt: 'Refactor the authentication middleware to use JWT tokens instead of session cookies',
  status: 'draft',
  createdAt: NOW - 10 * 1000,
  group: 'engineering',
  output: [],
};

export const MOCK_SESSIONS: AgentSession[] = [
  draftSession,
  memoryLeakSession,
  okrSession,
  slackSession,
];
