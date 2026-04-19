import type { AgentSession, OutputEntry } from './types';

let entryId = 0;
function eid(): string {
  return `entry-${++entryId}`;
}

const NOW = Date.now();

const slackSession: AgentSession = {
  id: 'session-1',
  prompt: 'Summarise last week\'s Slack threads into a brief',
  status: 'stopped',
  createdAt: NOW - 7 * 60 * 1000,
  elapsedMs: 34_200,
  toolCallCount: 4,
  output: [
    {
      id: eid(), type: 'thinking', timestamp: NOW - 7 * 60 * 1000,
      content: 'I need to fetch Slack messages from the past 7 days, filter threads with significant activity, then summarise the key topics.',
    },
    {
      id: eid(), type: 'tool_call', timestamp: NOW - 6 * 60 * 1000 - 50_000,
      tool: 'slack.list_channels', content: '{ "limit": 50 }',
    },
    {
      id: eid(), type: 'tool_result', timestamp: NOW - 6 * 60 * 1000 - 48_000,
      tool: 'slack.list_channels', content: 'Found 12 active channels: #engineering, #product, #design, #general, #incidents, #deployments, #frontend, #backend, #infra, #standup, #random, #announcements',
      duration: 2000,
    },
    {
      id: eid(), type: 'tool_call', timestamp: NOW - 6 * 60 * 1000 - 45_000,
      tool: 'slack.search_messages', content: '{ "query": "after:2026-04-11", "channels": ["engineering","product","incidents"] }',
    },
    {
      id: eid(), type: 'tool_result', timestamp: NOW - 6 * 60 * 1000 - 40_000,
      tool: 'slack.search_messages', content: 'Retrieved 142 messages across 8 channels. 23 threads with > 3 replies.',
      duration: 5000,
    },
    {
      id: eid(), type: 'thinking', timestamp: NOW - 6 * 60 * 1000 - 38_000,
      content: 'The most active threads are in #incidents (API latency spike on Tuesday) and #product (Q3 roadmap discussion). I\'ll group by topic.',
    },
    {
      id: eid(), type: 'tool_call', timestamp: NOW - 6 * 60 * 1000 - 35_000,
      tool: 'file.write', content: '{ "path": "weekly-brief.md", "content": "# Weekly Brief\\n\\n## Key Topics\\n1. API latency incident..." }',
    },
    {
      id: eid(), type: 'tool_result', timestamp: NOW - 6 * 60 * 1000 - 34_000,
      tool: 'file.write', content: 'File written: weekly-brief.md (1.2 KB)',
      duration: 1000,
    },
    {
      id: eid(), type: 'text', timestamp: NOW - 6 * 60 * 1000 - 33_000,
      content: 'Brief ready. 6 key topics identified across 23 active threads:\n\n1. API latency spike (Tuesday) — resolved, root cause was connection pool exhaustion\n2. Q3 roadmap priorities — 3 new features approved\n3. Design system v2 migration — 60% complete\n4. New hire onboarding feedback — 2 action items\n5. CI pipeline optimization — build times reduced 40%\n6. Customer escalation from Acme Corp — resolved',
    },
  ],
};

const memoryLeakSession: AgentSession = {
  id: 'session-2',
  prompt: 'Find and fix the memory leak in the renderer process',
  status: 'running',
  createdAt: NOW - 90 * 1000,
  elapsedMs: 90_000,
  toolCallCount: 3,
  output: [
    {
      id: eid(), type: 'thinking', timestamp: NOW - 90 * 1000,
      content: 'Memory leaks in Electron renderers are typically caused by detached DOM nodes, uncleaned event listeners, or closures holding stale references. I\'ll start with a heap snapshot comparison.',
    },
    {
      id: eid(), type: 'tool_call', timestamp: NOW - 85 * 1000,
      tool: 'shell.exec', content: '{ "command": "node --inspect scripts/heap-snapshot.js" }',
    },
    {
      id: eid(), type: 'tool_result', timestamp: NOW - 80 * 1000,
      tool: 'shell.exec', content: 'Heap snapshot saved: snapshot-before.heapsnapshot (24.3 MB)\nHeap snapshot saved: snapshot-after.heapsnapshot (31.7 MB)\nDelta: +7.4 MB after 50 tab switches',
      duration: 5000,
    },
    {
      id: eid(), type: 'thinking', timestamp: NOW - 78 * 1000,
      content: 'The 7.4 MB growth after 50 tab switches is significant. Let me analyze the retained objects to find the leak source.',
    },
    {
      id: eid(), type: 'tool_call', timestamp: NOW - 75 * 1000,
      tool: 'grep.search', content: '{ "pattern": "addEventListener", "path": "src/renderer/", "type": "ts" }',
    },
    {
      id: eid(), type: 'tool_result', timestamp: NOW - 72 * 1000,
      tool: 'grep.search', content: 'Found 18 matches in 7 files:\n  src/renderer/shell/TabBar.tsx:45 — window.addEventListener(\'resize\', handleResize)\n  src/renderer/shell/WebViewManager.tsx:112 — webview.addEventListener(\'dom-ready\', onReady)\n  src/renderer/shell/WebViewManager.tsx:113 — webview.addEventListener(\'did-navigate\', onNavigate)',
      duration: 3000,
    },
    {
      id: eid(), type: 'tool_call', timestamp: NOW - 70 * 1000,
      tool: 'file.read', content: '{ "path": "src/renderer/shell/WebViewManager.tsx", "lines": "100-140" }',
    },
    {
      id: eid(), type: 'tool_result', timestamp: NOW - 68 * 1000,
      tool: 'file.read', content: 'Lines 100-140 of WebViewManager.tsx — useEffect cleanup missing removeEventListener for dom-ready and did-navigate handlers. These accumulate across tab switches.',
      duration: 2000,
    },
    {
      id: eid(), type: 'thinking', timestamp: NOW - 65 * 1000,
      content: 'Found it. WebViewManager.tsx adds event listeners in useEffect but never removes them. Each tab switch mounts a new component instance, adding more listeners without cleaning up old ones. I\'ll add proper cleanup.',
    },
  ],
};

const okrSession: AgentSession = {
  id: 'session-3',
  prompt: 'Draft Q2 OKR document from Notion pages',
  status: 'stuck',
  createdAt: NOW - 25 * 60 * 1000,
  elapsedMs: 180_000,
  toolCallCount: 2,
  output: [
    {
      id: eid(), type: 'thinking', timestamp: NOW - 25 * 60 * 1000,
      content: 'I\'ll connect to the Notion API, fetch the Q2 planning pages, and structure them into an OKR format.',
    },
    {
      id: eid(), type: 'tool_call', timestamp: NOW - 24 * 60 * 1000,
      tool: 'notion.search', content: '{ "query": "Q2 2026 OKR", "filter": { "property": "object", "value": "page" } }',
    },
    {
      id: eid(), type: 'tool_result', timestamp: NOW - 23 * 60 * 1000 - 50_000,
      tool: 'notion.search', content: 'Found 3 pages: "Q2 Planning", "Engineering Goals Q2", "Product Roadmap Q2"',
      duration: 10_000,
    },
    {
      id: eid(), type: 'tool_call', timestamp: NOW - 23 * 60 * 1000 - 45_000,
      tool: 'notion.get_page', content: '{ "page_id": "abc-123-def" }',
    },
    {
      id: eid(), type: 'error', timestamp: NOW - 23 * 60 * 1000 - 40_000,
      content: 'Notion API rate limit exceeded (429). Retry-After: 60s. The API has been returning 429 for the last 3 attempts.',
    },
    {
      id: eid(), type: 'thinking', timestamp: NOW - 23 * 60 * 1000 - 38_000,
      content: 'Rate limited by Notion. I\'ve exhausted retries. Waiting for user intervention or API quota reset.',
    },
  ],
};

const draftSession: AgentSession = {
  id: 'session-4',
  prompt: 'Refactor the authentication middleware to use JWT tokens instead of session cookies',
  status: 'draft',
  createdAt: NOW - 10 * 1000,
  elapsedMs: 0,
  toolCallCount: 0,
  output: [],
};

export const MOCK_SESSIONS: AgentSession[] = [
  draftSession,
  memoryLeakSession,
  okrSession,
  slackSession,
];
