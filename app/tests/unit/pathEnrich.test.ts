import { describe, expect, it } from 'vitest';
import { enrichedPath } from '../../src/main/hl/engines/pathEnrich';

describe('pathEnrich', () => {
  it('keeps Windows PATH semicolon-delimited and adds common user CLI dirs', () => {
    const result = enrichedPath('C:\\Windows\\System32;C:\\Tools', {
      platform: 'win32',
      homedir: 'C:\\Users\\Ada',
      env: {
        LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local',
      },
    });

    const parts = result.split(';');
    expect(parts.slice(0, 2)).toEqual(['C:\\Windows\\System32', 'C:\\Tools']);
    expect(parts).toContain('C:\\Users\\Ada\\AppData\\Roaming\\npm');
    expect(parts).toContain('C:\\Users\\Ada\\.bcode\\bin');
    expect(parts).toContain('C:\\Users\\Ada\\.cargo\\bin');
  });

  it('uses POSIX delimiters for Linux-style paths', () => {
    const result = enrichedPath('/usr/bin:/bin', {
      platform: 'linux',
      homedir: '/home/ada',
      env: {},
    });

    const parts = result.split(':');
    expect(parts.slice(0, 2)).toEqual(['/usr/bin', '/bin']);
    expect(parts).toContain('/home/ada/.local/bin');
    expect(parts).toContain('/home/ada/.cargo/bin');
  });

  it('adds bundled Codex.app CLI locations on macOS', () => {
    const result = enrichedPath('/usr/bin:/bin', {
      platform: 'darwin',
      homedir: '/Users/ada',
      env: {},
    });

    const parts = result.split(':');
    expect(parts).toContain('/Applications/Codex.app/Contents/Resources');
    expect(parts).toContain('/Users/ada/Applications/Codex.app/Contents/Resources');
  });
});
