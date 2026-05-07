import { describe, expect, it } from 'vitest';
import { userFacingIpcError } from '../../../src/renderer/shared/ipcErrors';

describe('userFacingIpcError', () => {
  it('strips Electron remote-method wrappers from import errors', () => {
    expect(userFacingIpcError(new Error(
      "Error invoking remote method 'chrome-import:import-cookies': Error: Could not copy the browser profile cookie store.",
    ))).toBe('Could not copy the browser profile cookie store.');
  });

  it('preserves plain errors', () => {
    expect(userFacingIpcError(new Error('Cookie sync failed'))).toBe('Cookie sync failed');
  });
});
