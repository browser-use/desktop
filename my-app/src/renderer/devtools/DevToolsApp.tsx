import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ConsolePanel } from './panels/ConsolePanel';
import { ElementsPanel } from './panels/ElementsPanel';
import { NetworkPanel } from './panels/NetworkPanel';
import { PlaceholderPanel } from './panels/PlaceholderPanel';

declare const devtoolsAPI: {
  attach: () => Promise<{ success: boolean; error?: string }>;
  detach: () => Promise<{ success: boolean }>;
  send: (method: string, params?: Record<string, unknown>) => Promise<{ success: boolean; result?: unknown; error?: string }>;
  isAttached: () => Promise<boolean>;
  getActiveTabInfo: () => Promise<{ id: string; url: string; title: string; favicon: string | null; isLoading: boolean } | null>;
  onCdpEvent: (cb: (method: string, params: unknown) => void) => () => void;
  onTabChanged: (cb: (tabId: string) => void) => () => void;
};

type PanelId =
  | 'elements'
  | 'console'
  | 'sources'
  | 'network'
  | 'performance'
  | 'memory'
  | 'application'
  | 'security'
  | 'lighthouse'
  | 'recorder';

interface PanelDef {
  id: PanelId;
  label: string;
  icon: string;
}

const PANELS: PanelDef[] = [
  { id: 'elements', label: 'Elements', icon: '◇' },
  { id: 'console', label: 'Console', icon: '▸' },
  { id: 'sources', label: 'Sources', icon: '{ }' },
  { id: 'network', label: 'Network', icon: '⇄' },
  { id: 'performance', label: 'Performance', icon: '◔' },
  { id: 'memory', label: 'Memory', icon: '▦' },
  { id: 'application', label: 'Application', icon: '⊞' },
  { id: 'security', label: 'Security', icon: '⊡' },
  { id: 'lighthouse', label: 'Lighthouse', icon: '☆' },
  { id: 'recorder', label: 'Recorder', icon: '●' },
];

const PLACEHOLDER_DESCRIPTIONS: Record<string, string> = {
  sources: 'Debug JavaScript with breakpoints, watch expressions, call stack inspection, and code snippets.',
  performance: 'Record and analyze runtime performance with flame charts, Web Vitals overlay, and frame rendering.',
  memory: 'Take heap snapshots, track allocation timelines, and sample memory usage over time.',
  application: 'Inspect storage (localStorage, sessionStorage, IndexedDB, cookies), service workers, and manifest.',
  security: 'View TLS certificate details, mixed content warnings, and connection security information.',
  lighthouse: 'Run performance, accessibility, best practices, and SEO audits on the current page.',
  recorder: 'Record user flows, replay interactions, measure performance, and export as Puppeteer scripts.',
};

type ConnectionState = 'disconnected' | 'connecting' | 'connected';

interface TabInfo {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
}

export function DevToolsApp(): React.ReactElement {
  const [activePanel, setActivePanel] = useState<PanelId>('console');
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [tabInfo, setTabInfo] = useState<TabInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cdpListenersRef = useRef<Array<(method: string, params: unknown) => void>>([]);
  const cleanupRef = useRef<(() => void) | null>(null);

  const subscribeCdp = useCallback((listener: (method: string, params: unknown) => void) => {
    cdpListenersRef.current.push(listener);
    return () => {
      cdpListenersRef.current = cdpListenersRef.current.filter((l) => l !== listener);
    };
  }, []);

  const sendCdp = useCallback(async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    const resp = await devtoolsAPI.send(method, params);
    if (!resp.success) throw new Error(resp.error ?? 'CDP command failed');
    return resp.result;
  }, []);

  const connect = useCallback(async () => {
    console.log('[DevToolsApp] connecting...');
    setConnectionState('connecting');
    setError(null);

    const info = await devtoolsAPI.getActiveTabInfo();
    if (!info) {
      setError('No active tab found');
      setConnectionState('disconnected');
      return;
    }
    setTabInfo(info);

    const resp = await devtoolsAPI.attach();
    if (!resp.success) {
      console.error('[DevToolsApp] attach failed:', resp.error);
      setError(resp.error ?? 'Failed to attach debugger');
      setConnectionState('disconnected');
      return;
    }

    const cleanup = devtoolsAPI.onCdpEvent((method, params) => {
      for (const listener of cdpListenersRef.current) {
        try {
          listener(method, params);
        } catch (err) {
          console.error('[DevToolsApp] cdp listener error:', err);
        }
      }
    });
    cleanupRef.current = cleanup;

    setConnectionState('connected');
    console.log('[DevToolsApp] connected to tab:', info.title);
  }, []);

  useEffect(() => {
    void connect();
    return () => {
      cleanupRef.current?.();
      void devtoolsAPI.detach();
    };
  }, [connect]);

  const renderPanel = (): React.ReactElement => {
    if (connectionState !== 'connected') {
      return (
        <div className="devtools-connect-overlay">
          <div className="panel-placeholder-icon">⚡</div>
          <div className="panel-placeholder-title">
            {connectionState === 'connecting' ? 'Connecting...' : 'DevTools'}
          </div>
          {error && (
            <div style={{ color: 'var(--color-status-error)', fontSize: 'var(--font-size-sm)' }}>
              {error}
            </div>
          )}
          <button
            className="devtools-connect-btn"
            onClick={() => void connect()}
            disabled={connectionState === 'connecting'}
          >
            {connectionState === 'connecting' ? 'Connecting...' : 'Connect to Active Tab'}
          </button>
        </div>
      );
    }

    switch (activePanel) {
      case 'console':
        return <ConsolePanel sendCdp={sendCdp} subscribeCdp={subscribeCdp} />;
      case 'elements':
        return <ElementsPanel sendCdp={sendCdp} subscribeCdp={subscribeCdp} />;
      case 'network':
        return <NetworkPanel sendCdp={sendCdp} subscribeCdp={subscribeCdp} />;
      default:
        return (
          <PlaceholderPanel
            name={PANELS.find((p) => p.id === activePanel)?.label ?? activePanel}
            description={PLACEHOLDER_DESCRIPTIONS[activePanel] ?? ''}
          />
        );
    }
  };

  return (
    <div className="devtools-layout">
      <div className="devtools-titlebar">
        <div className="devtools-target-info">
          {tabInfo?.favicon && (
            <img className="devtools-target-favicon" src={tabInfo.favicon} alt="" />
          )}
          {tabInfo && (
            <>
              <span className="devtools-target-title">{tabInfo.title || 'Untitled'}</span>
              <span className="devtools-target-url">{tabInfo.url}</span>
            </>
          )}
        </div>
        <div className="devtools-status">
          <span
            className="devtools-status-dot"
            data-state={connectionState}
          />
          <span>{connectionState}</span>
        </div>
      </div>

      <div className="devtools-tabs">
        {PANELS.map((panel) => (
          <button
            key={panel.id}
            className="devtools-tab"
            data-active={activePanel === panel.id ? 'true' : 'false'}
            onClick={() => setActivePanel(panel.id)}
          >
            <span className="devtools-tab-icon">{panel.icon}</span>
            {panel.label}
          </button>
        ))}
      </div>

      <div className="devtools-content">
        {renderPanel()}
      </div>
    </div>
  );
}
