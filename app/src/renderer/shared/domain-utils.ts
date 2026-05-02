const GOOGLE_FAVICON_SERVICE_URL = 'https://t3.gstatic.com/faviconV2';
const DOMAIN_FAVICON_SIZE = 64;
export const DOMAIN_FAVICON_DISPLAY_SIZE = 16;

const DEFAULT_FAVICON_URL =
  'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://nonexistent-domain-12345.com&size=64';

export function getFaviconUrl(domain: string): string {
  try {
    const domainWithProtocol = domain.startsWith('http') ? domain : `https://${domain}`;
    const url = new URL(domainWithProtocol);
    const encodedUrl = encodeURIComponent(url.origin);
    return `${GOOGLE_FAVICON_SERVICE_URL}?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodedUrl}&size=${DOMAIN_FAVICON_SIZE}`;
  } catch {
    const encodedUrl = encodeURIComponent(`https://${domain}`);
    return `${GOOGLE_FAVICON_SERVICE_URL}?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodedUrl}&size=${DOMAIN_FAVICON_SIZE}`;
  }
}

export function extractHostname(domain: string): string {
  try {
    const domainWithProtocol = domain.startsWith('http') ? domain : `https://${domain}`;
    const url = new URL(domainWithProtocol);
    return url.hostname;
  } catch {
    return domain;
  }
}

export function sortDomains(domains: string[], domainsWithDefaultFavicons?: Set<string>): string[] {
  return [...domains].sort((a, b) => {
    if (domainsWithDefaultFavicons) {
      const aHasDefault = domainsWithDefaultFavicons.has(a);
      const bHasDefault = domainsWithDefaultFavicons.has(b);
      if (aHasDefault !== bHasDefault) {
        return aHasDefault ? 1 : -1;
      }
    }
    const hostnameA = extractHostname(a).toLowerCase();
    const hostnameB = extractHostname(b).toLowerCase();
    return hostnameA.localeCompare(hostnameB);
  });
}

let defaultFaviconDataUrlCache: string | null = null;
let defaultFaviconLoadPromise: Promise<string> | null = null;

async function loadDefaultFaviconDataUrl(): Promise<string> {
  if (defaultFaviconDataUrlCache) return defaultFaviconDataUrlCache;
  if (defaultFaviconLoadPromise) return defaultFaviconLoadPromise;

  defaultFaviconLoadPromise = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) { defaultFaviconLoadPromise = null; reject(new Error('No canvas context')); return; }
        ctx.drawImage(img, 0, 0);
        defaultFaviconDataUrlCache = canvas.toDataURL('image/png');
        resolve(defaultFaviconDataUrlCache);
      } catch (error) { defaultFaviconLoadPromise = null; reject(error); }
    };
    img.onerror = () => { defaultFaviconLoadPromise = null; reject(new Error('Failed to load default favicon')); };
    img.src = DEFAULT_FAVICON_URL;
  });

  return defaultFaviconLoadPromise;
}

export async function isDefaultFavicon(img: HTMLImageElement): Promise<boolean> {
  try {
    const defaultDataUrl = await loadDefaultFaviconDataUrl();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0);
    const imgDataUrl = canvas.toDataURL('image/png');
    return imgDataUrl === defaultDataUrl;
  } catch {
    return img.naturalWidth === 16 && img.naturalHeight === 16;
  }
}
