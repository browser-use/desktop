type HeaderMap = Record<string, string>;

export interface BrowserIdentity {
  userAgent: string;
  firefoxVersion: string;
  jsPlatform: string;
  platformLabel: string;
  acceptLanguageHeader: string;
  acceptLanguageOverride: string;
  language: string;
  languages: string[];
}

const USER_AGENT_CLIENT_HINT_HEADERS = [
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-ch-ua-arch',
  'sec-ch-ua-bitness',
  'sec-ch-ua-full-version',
  'sec-ch-ua-full-version-list',
  'sec-ch-ua-form-factors',
  'sec-ch-ua-model',
  'sec-ch-ua-platform-version',
  'sec-ch-ua-wow64',
] as const;

function firefoxVersion(version = '140.0'): string {
  return /^\d+\.\d+(?:\.\d+)?$/.test(version) ? version : '140.0';
}

function platformParts(platform: NodeJS.Platform): Pick<BrowserIdentity, 'jsPlatform' | 'platformLabel'> & { uaPlatform: string } {
  if (platform === 'win32') {
    return {
      uaPlatform: 'Windows NT 10.0; Win64; x64',
      jsPlatform: 'Win32',
      platformLabel: 'Windows',
    };
  }
  if (platform === 'linux') {
    return {
      uaPlatform: 'X11; Linux x86_64',
      jsPlatform: 'Linux x86_64',
      platformLabel: 'Linux',
    };
  }
  return {
    uaPlatform: 'Macintosh; Intel Mac OS X 10.15',
    jsPlatform: 'MacIntel',
    platformLabel: 'macOS',
  };
}

export function buildBrowserIdentity(opts: {
  firefoxVersion?: string;
  platform?: NodeJS.Platform;
} = {}): BrowserIdentity {
  const version = firefoxVersion(opts.firefoxVersion);
  const platform = platformParts(opts.platform ?? process.platform);
  const userAgent = `Mozilla/5.0 (${platform.uaPlatform}; rv:${version}) Gecko/20100101 Firefox/${version}`;
  return {
    userAgent,
    firefoxVersion: version,
    jsPlatform: platform.jsPlatform,
    platformLabel: platform.platformLabel,
    acceptLanguageHeader: 'en-US,en;q=0.9',
    acceptLanguageOverride: 'en-US,en',
    language: 'en-US',
    languages: ['en-US', 'en'],
  };
}

function setHeader(headers: HeaderMap, name: string, value: string): void {
  const existing = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  headers[existing ?? name] = value;
}

function deleteHeader(headers: HeaderMap, name: string): void {
  const existing = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  if (existing) delete headers[existing];
}

export function withBrowserIdentityHeaders(headers: HeaderMap, identity = buildBrowserIdentity()): HeaderMap {
  const next = { ...headers };
  setHeader(next, 'User-Agent', identity.userAgent);
  setHeader(next, 'Accept-Language', identity.acceptLanguageHeader);
  for (const header of USER_AGENT_CLIENT_HINT_HEADERS) deleteHeader(next, header);
  return next;
}
