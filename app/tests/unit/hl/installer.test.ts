import { describe, expect, it } from 'vitest';
import { windowsInstallerSpawnSpec } from '../../../src/main/hl/engines/installer';

describe('engine installer Windows launcher', () => {
  it('runs the generated install script directly instead of routing through cmd start', () => {
    const scriptPath = 'C:\\Users\\Ada Lovelace\\AppData\\Local\\Temp\\browser-use-install-123\\install.cmd';

    const spec = windowsInstallerSpawnSpec(scriptPath, {
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    });

    expect(spec).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/k', scriptPath],
    });
    expect(spec.args.join(' ')).not.toContain('start');
    expect(spec.args.join(' ')).not.toContain('Codex Installer');
  });
});
