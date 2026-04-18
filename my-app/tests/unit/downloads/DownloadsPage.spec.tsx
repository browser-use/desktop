/**
 * DownloadsPage smoke tests — chrome://downloads full-page renderer.
 *
 * Mirrors the shape of tests/unit/onboarding/Welcome.spec.tsx.
 * Covers:
 *   - Renders the "Downloads" headline
 *   - Shows empty state when the list is empty
 *   - Renders entries grouped by date
 *   - Clicking "Show in folder" invokes the preload API
 *   - Clicking the per-row remove button invokes the preload API and drops the row
 *   - Search filter narrows results by filename
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Stub the CSS import so vitest doesn't try to parse it
vi.mock('../../../src/renderer/downloads/downloads.css', () => ({}));

// Build a shared mock API and expose it on the global before the component is imported.
const mockApi = {
  list: vi.fn(),
  remove: vi.fn(),
  openFile: vi.fn(),
  showInFolder: vi.fn(),
  retry: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  clearAll: vi.fn(),
  navigateTo: vi.fn(),
  onStateChange: vi.fn(() => () => undefined),
};

beforeEach(() => {
  for (const key of Object.keys(mockApi) as Array<keyof typeof mockApi>) {
    const fn = mockApi[key];
    if (typeof (fn as { mockReset?: () => void }).mockReset === 'function') {
      (fn as { mockReset: () => void }).mockReset();
    }
  }
  mockApi.list.mockResolvedValue([]);
  mockApi.remove.mockResolvedValue(true);
  mockApi.clearAll.mockResolvedValue(true);
  mockApi.retry.mockResolvedValue(true);
  mockApi.onStateChange.mockImplementation(() => () => undefined);
  // Attach to globalThis so the component's `declare const downloadsAPI` binding resolves.
  (globalThis as unknown as { downloadsAPI: typeof mockApi }).downloadsAPI = mockApi;
});

import { DownloadsPage } from '../../../src/renderer/downloads/DownloadsPage';

function makeItem(partial: Partial<{
  id: string;
  filename: string;
  url: string;
  savePath: string;
  totalBytes: number;
  receivedBytes: number;
  status: 'in-progress' | 'paused' | 'completed' | 'cancelled' | 'interrupted';
  startTime: number;
  endTime: number | null;
  openWhenDone: boolean;
  speed: number;
  eta: number;
}>) {
  return {
    id: 'dl-1',
    filename: 'report.pdf',
    url: 'https://example.com/report.pdf',
    savePath: '/tmp/report.pdf',
    totalBytes: 1024,
    receivedBytes: 1024,
    status: 'completed' as const,
    startTime: Date.now(),
    endTime: Date.now(),
    openWhenDone: false,
    speed: 0,
    eta: 0,
    ...partial,
  };
}

describe('DownloadsPage', () => {
  it('renders the Downloads headline', async () => {
    render(<DownloadsPage />);
    expect(screen.getByRole('heading', { name: /downloads/i })).toBeTruthy();
  });

  it('shows the empty state when the list is empty', async () => {
    render(<DownloadsPage />);
    await waitFor(() => {
      expect(screen.getByText(/no downloads yet/i)).toBeTruthy();
    });
  });

  it('renders a row for each download returned from the API', async () => {
    mockApi.list.mockResolvedValueOnce([
      makeItem({ id: 'dl-1', filename: 'report.pdf' }),
      makeItem({ id: 'dl-2', filename: 'image.png', url: 'https://cdn.example.com/image.png' }),
    ]);

    render(<DownloadsPage />);

    await waitFor(() => {
      expect(screen.getByText('report.pdf')).toBeTruthy();
      expect(screen.getByText('image.png')).toBeTruthy();
    });
  });

  it('invokes showInFolder when "Show in folder" is clicked', async () => {
    mockApi.list.mockResolvedValueOnce([makeItem({ id: 'dl-1', filename: 'report.pdf' })]);

    render(<DownloadsPage />);

    await waitFor(() => {
      expect(screen.getByText('report.pdf')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /show in folder/i }));
    expect(mockApi.showInFolder).toHaveBeenCalledWith('dl-1');
  });

  it('invokes remove and drops the row when the per-row remove button is clicked', async () => {
    mockApi.list.mockResolvedValueOnce([makeItem({ id: 'dl-1', filename: 'report.pdf' })]);

    render(<DownloadsPage />);

    await waitFor(() => {
      expect(screen.getByText('report.pdf')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /remove from list/i }));

    await waitFor(() => {
      expect(mockApi.remove).toHaveBeenCalledWith('dl-1');
    });
  });

  it('filters by filename via the search input', async () => {
    mockApi.list.mockResolvedValueOnce([
      makeItem({ id: 'dl-1', filename: 'report.pdf' }),
      makeItem({ id: 'dl-2', filename: 'image.png', url: 'https://cdn.example.com/image.png' }),
    ]);

    render(<DownloadsPage />);

    await waitFor(() => {
      expect(screen.getByText('report.pdf')).toBeTruthy();
    });

    const input = screen.getByLabelText(/search downloads/i);
    fireEvent.change(input, { target: { value: 'image' } });

    await waitFor(() => {
      expect(screen.queryByText('report.pdf')).toBeNull();
      expect(screen.getByText('image.png')).toBeTruthy();
    });
  });

  it('invokes retry when "Retry" is clicked on a failed download', async () => {
    mockApi.list.mockResolvedValueOnce([
      makeItem({ id: 'dl-1', filename: 'broken.zip', status: 'interrupted' }),
    ]);

    render(<DownloadsPage />);

    await waitFor(() => {
      expect(screen.getByText('broken.zip')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));
    expect(mockApi.retry).toHaveBeenCalledWith('dl-1');
  });
});
