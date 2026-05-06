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
    return comparePrereleaseVersions(leftVersion.prerelease, rightVersion.prerelease);
  }
  return 0;
}

export function shouldHandoffToNewerInstance(currentVersion: string, incoming: SingleInstanceLaunchData | null): incoming is SingleInstanceLaunchData {
  return Boolean(incoming?.execPath && compareAppVersions(incoming.version, currentVersion) > 0);
}

function parseVersion(version: string): { parts: number[]; prerelease: string | null } {
  const [versionWithoutBuild] = version
    .trim()
    .replace(/^v/i, '')
    .split('+', 1);
  const prereleaseSeparator = versionWithoutBuild.indexOf('-');
  const main = prereleaseSeparator === -1
    ? versionWithoutBuild
    : versionWithoutBuild.slice(0, prereleaseSeparator);
  const prerelease = prereleaseSeparator === -1
    ? null
    : versionWithoutBuild.slice(prereleaseSeparator + 1);
  const parts = main
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
  return { parts, prerelease };
}

function comparePrereleaseVersions(left: string, right: string): number {
  const leftIdentifiers = left.split('.');
  const rightIdentifiers = right.split('.');
  const length = Math.max(leftIdentifiers.length, rightIdentifiers.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftIdentifiers[index];
    const rightIdentifier = rightIdentifiers[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;

    const result = comparePrereleaseIdentifier(leftIdentifier, rightIdentifier);
    if (result !== 0) return result;
  }
  return 0;
}

function comparePrereleaseIdentifier(left: string, right: string): number {
  const leftIsNumeric = isNumericIdentifier(left);
  const rightIsNumeric = isNumericIdentifier(right);
  if (leftIsNumeric && rightIsNumeric) {
    const leftNumber = BigInt(left);
    const rightNumber = BigInt(right);
    if (leftNumber > rightNumber) return 1;
    if (leftNumber < rightNumber) return -1;
    return 0;
  }
  if (leftIsNumeric && !rightIsNumeric) return -1;
  if (!leftIsNumeric && rightIsNumeric) return 1;
  if (left > right) return 1;
  if (left < right) return -1;
  return 0;
}

function isNumericIdentifier(value: string): boolean {
  return /^\d+$/.test(value);
}
