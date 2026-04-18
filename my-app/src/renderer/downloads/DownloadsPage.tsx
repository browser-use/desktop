import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type DownloadStatus =
  | 'in-progress'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'interrupted';

interface DownloadItemDTO {
  id: string;
  filename: string;
  url: string;
  savePath: string;
  totalBytes: number;
  receivedBytes: number;
  status: DownloadStatus;
  startTime: number;
  endTime: number | null;
  openWhenDone: boolean;
  speed: number;
  eta: number;
}

declare const downloadsAPI: {
  list: () => Promise<DownloadItemDTO[]>;
  remove: (id: string) => Promise<boolean>;
  openFile: (id: string) => Promise<void>;
  showInFolder: (id: string) => Promise<void>;
  retry: (id: string) => Promise<boolean>;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  clearAll: () => Promise<boolean>;
  navigateTo: (url: string) => Promise<void>;
  onStateChange: (cb: (items: DownloadItemDTO[]) => void) => () => void;
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function getDateLabel(ts: number): string {
  const now = new Date();
  const date = new Date(ts);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const entryDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (entryDate.getTime() === today.getTime()) return 'Today';
  if (entryDate.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function groupByDate(items: DownloadItemDTO[]): Map<string, DownloadItemDTO[]> {
  const groups = new Map<string, DownloadItemDTO[]>();
  for (const item of items) {
    const label = getDateLabel(item.startTime);
    const group = groups.get(label);
    if (group) {
      group.push(item);
    } else {
      groups.set(label, [item]);
    }
  }
  return groups;
}

function domainLabel(pageUrl: string): string {
  try {
    return new URL(pageUrl).hostname.replace(/^www\./, '');
  } catch {
    return pageUrl;
  }
}

function statusLabel(dl: DownloadItemDTO): string {
  switch (dl.status) {
    case 'completed':
      return formatBytes(dl.receivedBytes);
    case 'in-progress': {
      const totalLabel = dl.totalBytes > 0 ? formatBytes(dl.totalBytes) : 'unknown size';
      return `${formatBytes(dl.receivedBytes)} of ${totalLabel}`;
    }
    case 'paused':
      return 'Paused';
    case 'cancelled':
      return 'Cancelled';
    case 'interrupted':
      return 'Failed';
    default:
      return '';
  }
}

export function DownloadsPage(): React.ReactElement {
  const [items, setItems] = useState<DownloadItemDTO[]>([]);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const searchRef = useRef<HTMLInputElement>(null);

  const fetchDownloads = useCallback(async () => {
    setLoading(true);
    try {
      const result = await downloadsAPI.list();
      setItems(result);
    } catch (err) {
      console.error('DownloadsPage.fetch.failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDownloads();
  }, [fetchDownloads]);

  useEffect(() => {
    const unsubscribe = downloadsAPI.onStateChange((next) => {
      setItems(next);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(val);
    }, 200);
  }, []);

  const handleOpen = useCallback((id: string) => {
    downloadsAPI.openFile(id);
  }, []);

  const handleShowInFolder = useCallback((id: string) => {
    downloadsAPI.showInFolder(id);
  }, []);

  const handleRemove = useCallback(async (id: string) => {
    await downloadsAPI.remove(id);
    setItems((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const handleRetry = useCallback((id: string) => {
    downloadsAPI.retry(id);
  }, []);

  const handlePause = useCallback((id: string) => {
    downloadsAPI.pause(id);
  }, []);

  const handleResume = useCallback((id: string) => {
    downloadsAPI.resume(id);
  }, []);

  const handleCancel = useCallback((id: string) => {
    downloadsAPI.cancel(id);
  }, []);

  const handleNavigate = useCallback((url: string) => {
    downloadsAPI.navigateTo(url);
  }, []);

  const handleClearAll = useCallback(async () => {
    await downloadsAPI.clearAll();
    setItems([]);
  }, []);

  const filteredItems = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    const sorted = [...items].sort((a, b) => b.startTime - a.startTime);
    if (!q) return sorted;
    return sorted.filter((d) => {
      const filename = d.filename.toLowerCase();
      const url = d.url.toLowerCase();
      return filename.includes(q) || url.includes(q);
    });
  }, [items, debouncedQuery]);

  const groups = groupByDate(filteredItems);

  return (
    <div className="downloads">
      <header className="downloads__header">
        <h1 className="downloads__title">Downloads</h1>
        {items.length > 0 && (
          <button
            type="button"
            className="downloads__clear-all"
            onClick={handleClearAll}
            aria-label="Clear all downloads"
          >
            Clear all
          </button>
        )}
      </header>

      <div className="downloads__search-container">
        <svg className="downloads__search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
          <line x1="11" y1="11" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          ref={searchRef}
          className="downloads__search"
          type="text"
          value={query}
          onChange={handleQueryChange}
          placeholder="Search downloads"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          aria-label="Search downloads"
        />
      </div>

      <div className="downloads__content">
        {loading && items.length === 0 ? (
          <div className="downloads__empty">Loading...</div>
        ) : filteredItems.length === 0 ? (
          <div className="downloads__empty">
            {debouncedQuery ? 'No results found' : 'No downloads yet'}
          </div>
        ) : (
          Array.from(groups.entries()).map(([dateLabel, groupItems]) => (
            <div key={dateLabel} className="downloads__group">
              <h2 className="downloads__date-label">{dateLabel}</h2>
              <div className="downloads__entries">
                {groupItems.map((dl) => (
                  <DownloadRow
                    key={dl.id}
                    dl={dl}
                    onOpen={handleOpen}
                    onShowInFolder={handleShowInFolder}
                    onRemove={handleRemove}
                    onRetry={handleRetry}
                    onPause={handlePause}
                    onResume={handleResume}
                    onCancel={handleCancel}
                    onNavigate={handleNavigate}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

interface DownloadRowProps {
  dl: DownloadItemDTO;
  onOpen: (id: string) => void;
  onShowInFolder: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onNavigate: (url: string) => void;
}

function DownloadRow({
  dl,
  onOpen,
  onShowInFolder,
  onRemove,
  onRetry,
  onPause,
  onResume,
  onCancel,
  onNavigate,
}: DownloadRowProps): React.ReactElement {
  const isActive = dl.status === 'in-progress' || dl.status === 'paused';
  const isCompleted = dl.status === 'completed';
  const isFailed = dl.status === 'interrupted' || dl.status === 'cancelled';
  const percent =
    dl.totalBytes > 0 ? Math.min(100, Math.round((dl.receivedBytes / dl.totalBytes) * 100)) : 0;

  return (
    <div
      className={`downloads__entry downloads__entry--${dl.status}`}
      data-testid="download-row"
    >
      <div className="downloads__file-icon" aria-hidden="true">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <path
            d="M7 4h13l6 6v18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="var(--color-bg-elevated)"
          />
          <path d="M20 4v6h6" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </div>

      <div className="downloads__entry-body">
        <button
          type="button"
          className="downloads__entry-filename"
          onClick={() => (isCompleted ? onOpen(dl.id) : undefined)}
          disabled={!isCompleted}
          title={isCompleted ? `Open ${dl.filename}` : dl.filename}
        >
          {dl.filename}
        </button>

        <button
          type="button"
          className="downloads__entry-source"
          onClick={() => onNavigate(dl.url)}
          title={dl.url}
        >
          {domainLabel(dl.url)}
        </button>

        <div className="downloads__entry-status">
          <span className="downloads__entry-status-text">{statusLabel(dl)}</span>
          {isActive && dl.totalBytes > 0 && (
            <div className="downloads__progress" aria-label={`${percent} percent`}>
              <div
                className="downloads__progress-fill"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
        </div>

        <div className="downloads__entry-actions">
          {isCompleted && (
            <>
              <button
                type="button"
                className="downloads__action"
                onClick={() => onShowInFolder(dl.id)}
              >
                Show in folder
              </button>
            </>
          )}
          {dl.status === 'in-progress' && (
            <>
              <button
                type="button"
                className="downloads__action"
                onClick={() => onPause(dl.id)}
              >
                Pause
              </button>
              <button
                type="button"
                className="downloads__action"
                onClick={() => onCancel(dl.id)}
              >
                Cancel
              </button>
            </>
          )}
          {dl.status === 'paused' && (
            <>
              <button
                type="button"
                className="downloads__action"
                onClick={() => onResume(dl.id)}
              >
                Resume
              </button>
              <button
                type="button"
                className="downloads__action"
                onClick={() => onCancel(dl.id)}
              >
                Cancel
              </button>
            </>
          )}
          {isFailed && (
            <button
              type="button"
              className="downloads__action"
              onClick={() => onRetry(dl.id)}
            >
              Retry
            </button>
          )}
        </div>
      </div>

      <button
        type="button"
        className="downloads__entry-remove"
        onClick={() => onRemove(dl.id)}
        title="Remove from list"
        aria-label="Remove from list"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
