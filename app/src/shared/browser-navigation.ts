export type NormalizedNavigation =
  | { ok: true; url: string; kind: 'url' | 'search' }
  | { ok: false; error: string };

const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:', 'file:']);
const SEARCH_URL = 'https://www.google.com/search?q=';

function hasScheme(input: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(input);
}

function isLikelyHost(input: string): boolean {
  if (/\s/.test(input)) return false;
  if (/^localhost(?::\d+)?(?:[/?#].*)?$/i.test(input)) return true;
  if (/^\[[0-9a-f:]+\](?::\d+)?(?:[/?#].*)?$/i.test(input)) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#].*)?$/.test(input)) return true;
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:[/?#].*)?$/i.test(input);
}

function validateUrl(raw: string): NormalizedNavigation {
  try {
    const parsed = new URL(raw);
    if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
      return { ok: false, error: `Unsupported URL scheme: ${parsed.protocol.replace(':', '')}` };
    }
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.hostname) {
      return { ok: false, error: 'Enter a valid web address.' };
    }
    return { ok: true, url: parsed.toString(), kind: 'url' };
  } catch {
    return { ok: false, error: 'Enter a valid web address.' };
  }
}

export function normalizeBrowserNavigationInput(input: string): NormalizedNavigation {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'Enter a URL or search query.' };

  if (isLikelyHost(trimmed)) {
    const scheme = /^localhost(?::|[/?#]|$)/i.test(trimmed) || /^\d{1,3}(?:\.\d{1,3}){3}/.test(trimmed)
      ? 'http://'
      : 'https://';
    return validateUrl(`${scheme}${trimmed}`);
  }

  if (hasScheme(trimmed)) {
    return validateUrl(trimmed);
  }

  return {
    ok: true,
    url: `${SEARCH_URL}${encodeURIComponent(trimmed)}`,
    kind: 'search',
  };
}
