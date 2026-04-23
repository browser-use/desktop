import React, { useMemo, useState, useCallback } from 'react';
import { extractHostname, getFaviconUrl, isDefaultFavicon, sortDomains } from './domain-utils';

interface DomainListProps {
  domains: string[] | null | undefined;
  collapsible?: boolean;
  /** Custom header content that replaces the default "Cookie Domains (N)" label + globe. */
  header?: React.ReactNode;
}

export function DomainList({ domains, collapsible = false, header }: DomainListProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [domainsWithDefaultFavicons, setDomainsWithDefaultFavicons] = useState<Set<string>>(new Set());

  const handleFaviconLoad = useCallback((domain: string, isDefault: boolean) => {
    if (isDefault) {
      setDomainsWithDefaultFavicons((prev) => new Set(prev).add(domain));
    }
  }, []);

  const processedDomains = useMemo(() => {
    if (!domains || domains.length === 0) return [];
    const valid = domains.filter((d) => d && d.trim().length > 0);
    return sortDomains(valid, domainsWithDefaultFavicons);
  }, [domains, domainsWithDefaultFavicons]);

  const previewDomains = useMemo(() => processedDomains.slice(0, 5), [processedDomains]);
  const hasMoreThanFive = processedDomains.length > 5;

  if (!domains || domains.length === 0) {
    return (
      <div className="dl-empty">
        <GlobeIcon />
        <span>No cookie domains stored</span>
      </div>
    );
  }

  return (
    <div className="dl-container">
      {collapsible && (
        <button
          className="dl-header"
          onClick={() => setIsExpanded(!isExpanded)}
          type="button"
        >
          <div className="dl-header-left">
            {header ?? (
              <>
                <GlobeIcon />
                <span className="dl-header-label">
                  Cookie Domains{processedDomains.length > 0 && ` (${processedDomains.length})`}
                </span>
              </>
            )}
          </div>

          <div className="dl-header-right">
            {processedDomains.length > 0 && (
              <>
                <div className="dl-preview-row">
                  {previewDomains.map((domain, index) => (
                    <FaviconPreview
                      key={`preview-${domain}-${index}`}
                      domain={domain}
                      onFaviconLoad={handleFaviconLoad}
                    />
                  ))}
                </div>
                {hasMoreThanFive && <span className="dl-more">...</span>}
              </>
            )}
            <span className="dl-chevron">{isExpanded ? '\u25B4' : '\u25BE'}</span>
          </div>
        </button>
      )}

      {isExpanded && (
        <div className="dl-body">
          <div className={`dl-scroll ${processedDomains.length > 5 ? 'dl-scroll-limited' : ''}`}>
            {processedDomains.map((domain, index) => (
              <DomainItem
                key={`${domain}-${index}`}
                domain={domain}
                onFaviconLoad={handleFaviconLoad}
              />
            ))}
          </div>

          {collapsible && (
            <button
              className="dl-collapse-btn"
              onClick={() => setIsExpanded(false)}
              type="button"
            >
              <span className="dl-chevron">{'\u25B4'}</span>
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DomainItem({
  domain,
  onFaviconLoad,
}: {
  domain: string;
  onFaviconLoad: (domain: string, isDefault: boolean) => void;
}) {
  const [showFallback, setShowFallback] = useState(false);
  const hostname = extractHostname(domain);
  const faviconUrl = getFaviconUrl(domain);

  const handleLoad = async (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    const def = await isDefaultFavicon(img);
    onFaviconLoad(domain, def);
  };

  const handleError = () => {
    setShowFallback(true);
    onFaviconLoad(domain, true);
  };

  return (
    <div className="dl-item" title={domain}>
      <div className="dl-item-icon">
        {!showFallback ? (
          <img
            src={faviconUrl}
            alt=""
            width={16}
            height={16}
            className="dl-favicon"
            onLoad={handleLoad}
            onError={handleError}
          />
        ) : (
          <GlobeIcon />
        )}
      </div>
      <span className="dl-item-hostname">{hostname}</span>
    </div>
  );
}

function FaviconPreview({
  domain,
  onFaviconLoad,
}: {
  domain: string;
  onFaviconLoad: (domain: string, isDefault: boolean) => void;
}) {
  const [showFallback, setShowFallback] = useState(false);
  const faviconUrl = getFaviconUrl(domain);

  const handleLoad = async (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    const def = await isDefaultFavicon(img);
    onFaviconLoad(domain, def);
  };

  const handleError = () => {
    setShowFallback(true);
    onFaviconLoad(domain, true);
  };

  return (
    <div className="dl-preview-circle" title={extractHostname(domain)}>
      {!showFallback ? (
        <img
          src={faviconUrl}
          alt=""
          width={16}
          height={16}
          className="dl-preview-img"
          onLoad={handleLoad}
          onError={handleError}
        />
      ) : (
        <GlobeIcon />
      )}
    </div>
  );
}

function GlobeIcon() {
  return (
    <svg className="dl-globe" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
