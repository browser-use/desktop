export type SingleInstanceLaunchData = {
  version: string;
  execPath: string;
  argv: string[];
  cwd: string;
  appPath: string;
  pid: number;
  platform: NodeJS.Platform;
};

export function createSingleInstanceLaunchData(input: {
  version: string;
  execPath: string;
  argv: string[];
  cwd: string;
  appPath: string;
  pid: number;
  platform: NodeJS.Platform;
}): SingleInstanceLaunchData {
  return {
    version: input.version,
    execPath: input.execPath,
    argv: input.argv,
    cwd: input.cwd,
    appPath: input.appPath,
    pid: input.pid,
    platform: input.platform,
  };
}

export function parseSingleInstanceLaunchData(value: unknown): SingleInstanceLaunchData | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.version !== 'string'
    || typeof record.execPath !== 'string'
    || !Array.isArray(record.argv)
    || !record.argv.every((arg) => typeof arg === 'string')
    || typeof record.cwd !== 'string'
    || typeof record.appPath !== 'string'
    || typeof record.pid !== 'number'
    || typeof record.platform !== 'string'
  ) {
    return null;
  }

  return {
    version: record.version,
    execPath: record.execPath,
    argv: record.argv,
    cwd: record.cwd,
    appPath: record.appPath,
    pid: record.pid,
    platform: record.platform as NodeJS.Platform,
  };
}

export function compareAppVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  const length = Math.max(leftVersion.parts.length, rightVersion.parts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftVersion.parts[index] ?? 0;
    const rightPart = rightVersion.parts[index] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  if (leftVersion.prerelease && !rightVersion.prerelease) return -1;
  if (!leftVersion.prerelease && rightVersion.prerelease) return 1;
  if (leftVersion.prerelease && rightVersion.prerelease) {
    return leftVersion.prerelease.localeCompare(rightVersion.prerelease);
  }
  return 0;
}

export function shouldHandoffToNewerInstance(currentVersion: string, incoming: SingleInstanceLaunchData | null): incoming is SingleInstanceLaunchData {
  return Boolean(incoming?.execPath && compareAppVersions(incoming.version, currentVersion) > 0);
}

function parseVersion(version: string): { parts: number[]; prerelease: string | null } {
  const [main, prerelease = null] = version
    .trim()
    .replace(/^v/i, '')
    .split('-', 2);
  const parts = main
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
  return { parts, prerelease };
}
