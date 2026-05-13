import { describe, expect, it } from 'vitest';
import { createTermTranslatorState, hlEventToTermBytes } from '../../../src/main/hl/streamToTerm';

describe('streamToTerm skill tool suppression', () => {
  it('renders agent-skill flag/help calls that do not produce synthetic skill events', () => {
    const state = createTermTranslatorState();

    const toolBytes = hlEventToTermBytes({
      type: 'tool_call',
      name: 'Bash',
      args: { command: 'agent-skill validate --help' },
      iteration: 1,
    }, state);
    const resultBytes = hlEventToTermBytes({
      type: 'tool_result',
      name: 'Bash',
      ok: true,
      preview: 'Usage: agent-skill validate <id>',
      ms: 3,
    }, state);

    expect(toolBytes).toContain('Bash');
    expect(toolBytes).toContain('agent-skill validate --help');
    expect(resultBytes).toContain('Usage: agent-skill validate');
  });

  it('still suppresses target-bearing agent-skill calls for synthetic skill rows', () => {
    const state = createTermTranslatorState();

    const toolBytes = hlEventToTermBytes({
      type: 'tool_call',
      name: 'Bash',
      args: { command: 'agent-skill view domain/github/scraping --json' },
      iteration: 1,
    }, state);
    const resultBytes = hlEventToTermBytes({
      type: 'tool_result',
      name: 'Bash',
      ok: true,
      preview: '# GitHub Scraping',
      ms: 3,
    }, state);
    const skillBytes = hlEventToTermBytes({
      type: 'skill_used',
      path: 'agent-skill view domain/github/scraping --json',
      domain: 'domain',
      topic: 'github/scraping',
    }, state);

    expect(toolBytes).toBe('');
    expect(resultBytes).toBe('');
    expect(skillBytes).toContain('Read skill domain/github/scraping');
  });
});
