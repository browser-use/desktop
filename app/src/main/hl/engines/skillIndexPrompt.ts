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
