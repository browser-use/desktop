import { describe, expect, it, vi } from 'vitest';
import { pollInstalledStatus } from '../../src/renderer/shared/installStatus';

describe('onboarding install status polling', () => {
  it('keeps probing after installer completion until the CLI is detected', async () => {
    const refreshStatus = vi.fn()
      .mockResolvedValueOnce({ installed: false })
      .mockResolvedValueOnce({ installed: false })
      .mockResolvedValueOnce({ installed: true, version: '1.2.3' });
    const wait = vi.fn(async () => undefined);

    const status = await pollInstalledStatus(refreshStatus, {
      initialInstalled: { installed: false },
      maxPolls: 5,
      intervalMs: 25,
      wait,
    });

    expect(status).toEqual({ installed: true, version: '1.2.3' });
    expect(refreshStatus).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(25);
  });

  it('returns null after the bounded retry window without one extra delay', async () => {
    const refreshStatus = vi.fn(async () => ({ installed: false }));
    const wait = vi.fn(async () => undefined);

    const status = await pollInstalledStatus(refreshStatus, {
      maxPolls: 3,
      wait,
    });

    expect(status).toBeNull();
    expect(refreshStatus).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });
});
