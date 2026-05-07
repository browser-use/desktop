export interface InstallStatus {
  installed: boolean;
  version?: string | null;
  error?: string | null;
}

export const INSTALL_STATUS_POLL_INTERVAL_MS = 1000;
export const INSTALL_STATUS_MAX_POLLS = 120;
export const INSTALL_STATUS_VERIFIED_MAX_POLLS = 10;

interface PollInstalledStatusOptions {
  initialInstalled?: InstallStatus;
  maxPolls?: number;
  verifiedMaxPolls?: number;
  intervalMs?: number;
  wait?: (ms: number) => Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

export async function pollInstalledStatus<TStatus extends InstallStatus>(
  refreshStatus: () => Promise<TStatus | null>,
  opts: PollInstalledStatusOptions = {},
): Promise<TStatus | null> {
  const maxPolls = opts.initialInstalled?.installed
    ? opts.verifiedMaxPolls ?? INSTALL_STATUS_VERIFIED_MAX_POLLS
    : opts.maxPolls ?? INSTALL_STATUS_MAX_POLLS;
  const intervalMs = opts.intervalMs ?? INSTALL_STATUS_POLL_INTERVAL_MS;
  const wait = opts.wait ?? delay;

  for (let attempt = 0; attempt < maxPolls; attempt++) {
    const status = await refreshStatus();
    if (status?.installed) return status;
    if (attempt < maxPolls - 1) {
      await wait(intervalMs);
    }
  }

  return null;
}
