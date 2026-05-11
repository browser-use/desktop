import { describe, it } from 'vitest';
import { execSync } from 'node:child_process';
import { summarizeBashCommand } from '../../../src/renderer/hub/chat/toolLabels';

const DB = `${process.env.HOME}/Library/Application Support/Browser Use/sessions.db`;

describe('corpus coverage', () => {
  it('runs the summarizer against every real bash call in sessions.db and prints stats', () => {
    let rows: { command: string }[] = [];
    try {
      const json = execSync(
        `sqlite3 -json "${DB}" "SELECT DISTINCT json_extract(payload,'$.args.command') AS command FROM session_events WHERE type='tool_call' AND json_extract(payload,'$.name')='Bash'"`,
        { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
      );
      rows = JSON.parse(json);
    } catch {
      // No DB on this machine — skip silently.
      console.log('corpus: sessions.db not available, skipping');
      return;
    }

    const stats: Record<string, number> = {};
    const unmapped: string[] = [];
    for (const { command } of rows) {
      if (!command) continue;
      const s = summarizeBashCommand(command);
      const key = s ? s.completed + (s.value ? ` · ${s.value.slice(0, 50)}` : '') : '__UNMAPPED__';
      stats[key] = (stats[key] || 0) + 1;
      if (!s) unmapped.push(command.split('\n')[0].slice(0, 140));
    }

    const sorted = Object.entries(stats).sort((a, b) => b[1] - a[1]);
    console.log(`\n=== corpus: ${rows.length} unique commands ===`);
    for (const [k, n] of sorted) console.log(`${String(n).padStart(4)}  ${k}`);
    console.log('\n=== first 15 unmapped ===');
    for (const u of unmapped.slice(0, 15)) console.log('  ' + u);
  });
});
