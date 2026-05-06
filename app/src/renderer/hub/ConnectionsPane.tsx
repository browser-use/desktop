import React, { useEffect, useState, useCallback, useMemo } from 'react';
import anthropicLogo from './anthropic-logo.svg';
import claudeCodeLogo from './claude-code-logo.svg';
import openaiLogo from './openai-logo.svg';
import codexLogo from './codex-logo.svg';
import opencodeLogo from './opencode-logo-dark.svg';
import kimiLogo from './kimi-color.svg';
import qwenLogo from './qwen-color.svg';
import minimaxLogo from './minimax-color.svg';
import { CookieBrowser, type CookieBrowserApi } from '../shared/CookieBrowser';

type WaStatus = 'disconnected' | 'connecting' | 'qr_ready' | 'connected' | 'error';
type AuthType = 'oauth' | 'apiKey' | 'none';
interface AuthStatus {
  type: AuthType;
  masked?: string;
  subscriptionType?: string | null;
  expiresAt?: number;
}
interface OpenAiStatus {
  present: boolean;
  masked?: string;
}
interface EngineCliStatus {
  installed: boolean;
  authed: boolean;
  version?: string;
  error?: string;
}
interface BrowserCodeProvider {
  id: string;
  name: string;
  defaultModel: string;
  models: Array<{ id: string; label: string }>;
}
interface BrowserCodeStatus {
  keys: Record<string, { masked: string; lastModel?: string }>;
  active: string | null;
  installed?: { installed: boolean; version?: string; error?: string };
  providers: BrowserCodeProvider[];
}

const BROWSER_CODE_PROVIDER_LOGOS: Record<string, string> = {
  moonshotai: kimiLogo,
  alibaba: qwenLogo,
  minimax: minimaxLogo,
};

function friendlyKeyError(raw?: string): string {
  if (!raw) return 'Key rejected by provider';
  const s = raw.toLowerCase();
  if (s.includes('credit') || s.includes('quota') || s.includes('insufficient') || s.includes('balance')) {
    return 'Out of credits — top up your provider account.';
  }
  if (s.includes('invalid') || s.includes('401') || s.includes('unauthorized') || s.includes('authentication')) {
    return 'Invalid API key — double-check it in your provider dashboard.';
  }
  if (s.includes('rate') || s.includes('429')) {
    return 'Rate limit exceeded — try again in a moment.';
  }
  if (s.includes('network') || s.includes('fetch') || s.includes('econnrefused') || s.includes('timeout') || s.includes('aborted')) {
    return 'Network error — check your connection and retry.';
  }
  if (s.includes('no api key saved')) return 'No saved key to test for this provider.';
  return raw;
}

interface ConnectionsPaneProps {
  embedded?: boolean;
}

export function ConnectionsPane({ embedded }: ConnectionsPaneProps): React.ReactElement {
  const [waStatus, setWaStatus] = useState<WaStatus>('disconnected');
  const [waIdentity, setWaIdentity] = useState<string | null>(null);
  const [waDetail, setWaDetail] = useState<string | undefined>();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const cookieBrowserApi = useMemo<CookieBrowserApi | null>(() => {
    const api = window.electronAPI?.chromeImport;
    if (!api) return null;
    return {
      detectProfiles: api.detectProfiles,
      importCookies: api.importCookies,
      listCookies: api.listCookies,
      getSyncs: api.getSyncs,
    };
  }, []);

  const [authStatus, setAuthStatus] = useState<AuthStatus>({ type: 'none' });
  const [, setClaudeCodeAvailable] = useState<{ available: boolean; subscriptionType?: string | null }>({ available: false });
  const [claudeStatus, setClaudeStatus] = useState<EngineCliStatus>({ installed: false, authed: false });
  // True while we've spawned `claude auth login --claudeai` and are waiting
  // for the user to complete the OAuth in their browser. Drives the card's
  // 'Waiting for login…' subtitle + button-disabled state.
  const [claudeWaiting, setClaudeWaiting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftKey, setDraftKey] = useState('');
  const [keyStatus, setKeyStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [keyError, setKeyError] = useState<string | null>(null);

  const [openaiStatus, setOpenaiStatus] = useState<OpenAiStatus>({ present: false });
  const [openaiEditing, setOpenaiEditing] = useState(false);
  const [openaiDraft, setOpenaiDraft] = useState('');
  const [openaiKeyStatus, setOpenaiKeyStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [openaiError, setOpenaiError] = useState<string | null>(null);

  const [codexStatus, setCodexStatus] = useState<EngineCliStatus>({ installed: false, authed: false });
  const [codexWaiting, setCodexWaiting] = useState(false);
  // Surfaced from the codex login PTY when --device-auth is in play. Drives
  // the small "one-time code" block below the Codex card so users on
  // restricted networks (no localhost-callback) can still sign in.
  const [codexDeviceCode, setCodexDeviceCode] = useState<string | null>(null);
  const [codexVerificationUrl, setCodexVerificationUrl] = useState<string | null>(null);

  const [browserCodeStatus, setBrowserCodeStatus] = useState<BrowserCodeStatus>({ keys: {}, active: null, providers: [] });
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [browserCodeKeyDraft, setBrowserCodeKeyDraft] = useState('');
  const [browserCodeKeyStatus, setBrowserCodeKeyStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [browserCodeError, setBrowserCodeError] = useState<string | null>(null);
  const [browserCodeErrorProviderId, setBrowserCodeErrorProviderId] = useState<string | null>(null);
  const [installingEngine, setInstallingEngine] = useState<string | null>(null);

  const refreshKey = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.settings?.apiKey) return;
    const status = await api.settings.apiKey.getStatus();
    setAuthStatus(status);
    const cc = await api.settings.claudeCode?.available();
    if (cc) setClaudeCodeAvailable(cc);
  }, []);

  const refreshOpenai = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.settings?.openaiKey) return;
    try {
      const s = await api.settings.openaiKey.getStatus();
      setOpenaiStatus(s);
    } catch (err) {
      console.error('[connections] refreshOpenai failed', err);
    }
  }, []);

  const refreshClaudeCli = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.sessions?.engineStatus) return;
    try {
      const s = await api.sessions.engineStatus('claude-code');
      setClaudeStatus({
        installed: s.installed.installed,
        authed: s.authed.authed,
        version: s.installed.version,
        error: s.installed.error ?? s.authed.error,
      });
      if (s.installed.installed && installingEngine === 'claude-code') setInstallingEngine(null);
    } catch (err) {
      console.error('[connections] refreshClaudeCli failed', err);
    }
  }, [installingEngine]);

  const refreshCodex = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.settings?.codex) return;
    try {
      const s = await api.settings.codex.status();
      setCodexStatus({
        installed: s.installed.installed,
        authed: s.authed.authed,
        version: s.installed.version,
        error: s.installed.error ?? s.authed.error,
      });
      if (s.installed.installed && installingEngine === 'codex') setInstallingEngine(null);
    } catch (err) {
      console.error('[connections] refreshCodex failed', err);
    }
  }, [installingEngine]);

  const refreshBrowserCode = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.settings?.browserCode) return;
    try {
      const s = await api.settings.browserCode.getStatus();
      console.info('[connections] browserCode.status', {
        connectedProviders: Object.keys(s.keys),
        active: s.active,
        installed: s.installed?.installed,
        installedError: s.installed?.error,
      });
      setBrowserCodeStatus(s);
      if (s.installed?.installed && installingEngine === 'browsercode') setInstallingEngine(null);
    } catch (err) {
      console.error('[connections] refreshBrowserCode failed', err);
    }
  }, [installingEngine]);

  const handleInstallEngine = useCallback(async (engineId: string) => {
    const api = window.electronAPI;
    if (!api?.sessions?.engineInstall) return;
    setInstallingEngine(engineId);
    setKeyError(null);
    setOpenaiError(null);
    setBrowserCodeError(null);
    try {
      const result = await api.sessions.engineInstall(engineId);
      console.info('[connections] engine.install.result', { engineId, result });
      if (!result.opened) {
        setInstallingEngine(null);
        const msg = result.error ?? `Failed to open installer for ${engineId}`;
        if (engineId === 'claude-code') setKeyError(msg);
        else if (engineId === 'codex') setOpenaiError(msg);
        else if (engineId === 'browsercode') setBrowserCodeError(msg);
      }
      setTimeout(() => {
        if (engineId === 'claude-code') void refreshClaudeCli();
        if (engineId === 'codex') void refreshCodex();
        if (engineId === 'browsercode') void refreshBrowserCode();
      }, 3000);
      setTimeout(() => {
        setInstallingEngine((current) => (current === engineId ? null : current));
      }, 120000);
    } catch (err) {
      setInstallingEngine(null);
      const msg = (err as Error).message;
      if (engineId === 'claude-code') setKeyError(msg);
      else if (engineId === 'codex') setOpenaiError(msg);
      else if (engineId === 'browsercode') setBrowserCodeError(msg);
    }
  }, [refreshBrowserCode, refreshClaudeCli, refreshCodex]);

  const handleUseClaudeCode = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.settings?.claudeCode) return;
    setKeyError(null);
    if (!claudeStatus.installed) {
      setKeyError('Install Claude Code before signing in.');
      return;
    }
    // Two cases: (a) Claude CLI is already authed → just record the
    // mode preference; (b) it isn't → spawn `claude auth login --claudeai`,
    // let Claude open the browser, poll until creds appear, then record.
    try {
      const cc = await api.settings.claudeCode.available();
      if (cc.available) {
        await api.settings.claudeCode.use();
        await refreshKey();
        return;
      }
      if (!api.settings.claudeCode.login) {
        setKeyError('Login flow not available — run `claude auth login` in a terminal first.');
        return;
      }
      setClaudeWaiting(true);
      const res = await api.settings.claudeCode.login();
      if (!res.ok) {
        setClaudeWaiting(false);
        setKeyError(res.error ?? 'Failed to start Claude login');
      }
      // Browser is now open with the OAuth flow. Polling effect below
      // detects completion and flips claudeWaiting off.
    } catch (err) {
      setClaudeWaiting(false);
      setKeyError((err as Error).message);
    }
  }, [claudeStatus.installed, refreshKey]);

  // Poll while we're waiting for `claude auth login --claudeai` to complete.
  // 1s interval so the panel flips fast once auth.json appears in the CLI's
  // own keychain. Tighter than the global 5s panel refresh.
  useEffect(() => {
    if (!claudeWaiting) return;
    let cancelled = false;
    let attempts = 0;
    const MAX = 180; // 3 minutes
    const tick = async () => {
      if (cancelled) return;
      attempts++;
      const api = window.electronAPI;
      if (!api?.settings?.claudeCode) return;
      try {
        const cc = await api.settings.claudeCode.available();
        if (cc.available) {
          await api.settings.claudeCode.use();
          setClaudeWaiting(false);
          await refreshKey();
          return;
        }
      } catch (err) {
        console.warn('[connections] claude poll failed', err);
      }
      if (attempts >= MAX) { setClaudeWaiting(false); return; }
      setTimeout(tick, 1000);
    };
    void tick();
    return () => { cancelled = true; };
  }, [claudeWaiting, refreshKey]);

  useEffect(() => {
    refreshKey();
    refreshClaudeCli();
    refreshOpenai();
    refreshCodex();
    refreshBrowserCode();
  }, [refreshKey, refreshClaudeCli, refreshOpenai, refreshCodex, refreshBrowserCode]);

  // Periodic refresh while the pane is mounted — catches external state
  // changes (user runs `claude auth logout` in a terminal, codex token
  // expires server-side, etc.) so the panel never goes more than ~5s out
  // of sync with reality.
  useEffect(() => {
    const id = setInterval(() => {
      refreshKey();
      refreshClaudeCli();
      refreshOpenai();
      refreshCodex();
      refreshBrowserCode();
    }, 5000);
    return () => clearInterval(id);
  }, [refreshKey, refreshClaudeCli, refreshOpenai, refreshCodex, refreshBrowserCode]);

  // Poll codex status while user completes the codex OAuth flow. Tighter
  // interval than the 5s panel refresh so the UI flips to "Signed in" the
  // second `~/.codex/auth.json` appears.
  useEffect(() => {
    if (!codexWaiting) return;
    let cancelled = false;
    let attempts = 0;
    const MAX = 180;
    const tick = async () => {
      if (cancelled) return;
      attempts++;
      await refreshCodex();
      if (codexStatus.authed) {
        setCodexWaiting(false);
        setCodexDeviceCode(null);
        setCodexVerificationUrl(null);
        return;
      }
      if (attempts >= MAX) { setCodexWaiting(false); return; }
      setTimeout(tick, 1000);
    };
    void tick();
    return () => { cancelled = true; };
  }, [codexWaiting, refreshCodex, codexStatus.authed]);

  const handleSaveOpenai = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.settings?.openaiKey) return;
    if (!codexStatus.installed) {
      setOpenaiKeyStatus('error');
      setOpenaiError('Install Codex before adding an OpenAI API key.');
      return;
    }
    const trimmed = openaiDraft.trim();
    if (!trimmed) return;
    setOpenaiKeyStatus('testing');
    setOpenaiError(null);
    const test = await api.settings.openaiKey.test(trimmed);
    if (!test.success) {
      setOpenaiKeyStatus('error');
      setOpenaiError(test.error ?? 'Key rejected by OpenAI');
      return;
    }
    await api.settings.openaiKey.save(trimmed);
    setOpenaiKeyStatus('ok');
    setOpenaiDraft('');
    setOpenaiEditing(false);
    await refreshOpenai();
  }, [codexStatus.installed, openaiDraft, refreshOpenai]);

  const handleDeleteOpenai = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.settings?.openaiKey) return;
    await api.settings.openaiKey.delete();
    setOpenaiKeyStatus('idle');
    setOpenaiError(null);
    await refreshOpenai();
  }, [refreshOpenai]);

  const handleStartEditBrowserCode = useCallback((providerId: string) => {
    setEditingProviderId(providerId);
    setBrowserCodeKeyDraft('');
    setBrowserCodeKeyStatus('idle');
    setBrowserCodeError(null);
    setBrowserCodeErrorProviderId(null);
  }, []);

  const handleCancelEditBrowserCode = useCallback(() => {
    setEditingProviderId(null);
    setBrowserCodeKeyDraft('');
    setBrowserCodeKeyStatus('idle');
    setBrowserCodeError(null);
    setBrowserCodeErrorProviderId(null);
  }, []);

  const handleSaveBrowserCode = useCallback(async (providerId: string) => {
    const api = window.electronAPI;
    if (!api?.settings?.browserCode) return;
    if (browserCodeStatus.installed?.installed === false) {
      setBrowserCodeKeyStatus('error');
      setBrowserCodeError('Install BrowserCode before adding a provider API key.');
      setBrowserCodeErrorProviderId(providerId);
      return;
    }
    const apiKey = browserCodeKeyDraft.trim();
    if (!apiKey) return;
    setBrowserCodeError(null);
    setBrowserCodeErrorProviderId(null);
    setBrowserCodeKeyStatus('testing');
    const test = await api.settings.browserCode.test({ providerId, apiKey });
    if (!test.success) {
      setBrowserCodeKeyStatus('error');
      setBrowserCodeError(friendlyKeyError(test.error));
      setBrowserCodeErrorProviderId(providerId);
      return;
    }
    await api.settings.browserCode.save({ providerId, apiKey });
    setBrowserCodeKeyStatus('ok');
    setBrowserCodeKeyDraft('');
    setEditingProviderId(null);
    await refreshBrowserCode();
  }, [browserCodeKeyDraft, browserCodeStatus.installed?.installed, refreshBrowserCode]);

  const handleRemoveBrowserCodeKey = useCallback(async (providerId: string) => {
    const api = window.electronAPI;
    if (!api?.settings?.browserCode) return;
    await api.settings.browserCode.delete({ providerId });
    setBrowserCodeKeyDraft('');
    setBrowserCodeKeyStatus('idle');
    setBrowserCodeError(null);
    setBrowserCodeErrorProviderId(null);
    if (editingProviderId === providerId) setEditingProviderId(null);
    await refreshBrowserCode();
  }, [editingProviderId, refreshBrowserCode]);

  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [testResultByProvider, setTestResultByProvider] = useState<Record<string, { ok: boolean; message: string } | undefined>>({});

  const handleTestBrowserCodeKey = useCallback(async (providerId: string) => {
    const api = window.electronAPI;
    if (!api?.settings?.browserCode) return;
    setTestingProviderId(providerId);
    setTestResultByProvider((prev) => ({ ...prev, [providerId]: undefined }));
    try {
      const result = await api.settings.browserCode.test({ providerId, apiKey: '' });
      const message = result.success
        ? 'Key works'
        : friendlyKeyError(result.error);
      setTestResultByProvider((prev) => ({ ...prev, [providerId]: { ok: result.success, message } }));
    } catch (err) {
      setTestResultByProvider((prev) => ({ ...prev, [providerId]: { ok: false, message: friendlyKeyError((err as Error).message) } }));
    } finally {
      setTestingProviderId(null);
    }
  }, []);

  useEffect(() => {
    const api = window.electronAPI?.settings;
    if (!api?.onFocusBrowserCodeProvider) return;
    const unsubscribe = api.onFocusBrowserCodeProvider((providerId: string) => {
      console.info('[connections] focus browserCode provider', { providerId });
      handleStartEditBrowserCode(providerId);
    });
    return unsubscribe;
  }, [handleStartEditBrowserCode]);

  const handleCodexLogin = useCallback(async (opts?: { deviceAuth?: boolean }) => {
    const api = window.electronAPI;
    if (!api?.settings?.codex) return;
    setCodexWaiting(true);
    setCodexDeviceCode(null);
    setCodexVerificationUrl(null);
    const res = await api.settings.codex.login(opts);
    if (!res.opened) {
      console.warn('[connections] codex login failed', res.error);
      setCodexWaiting(false);
      return;
    }
    if (res.deviceCode) setCodexDeviceCode(res.deviceCode);
    if (res.verificationUrl) setCodexVerificationUrl(res.verificationUrl);
  }, []);
  // Stable callbacks for the Codex login buttons. Plain OAuth is the default;
  // device-auth is the "Having trouble?" fallback for users on networks/setups
  // where the localhost callback can't reach the browser.
  const handleCodexLoginPlain = useCallback(() => handleCodexLogin(), [handleCodexLogin]);
  const handleCodexLoginDeviceAuth = useCallback(() => handleCodexLogin({ deviceAuth: true }), [handleCodexLogin]);

  const handleCodexLogout = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.settings?.codex?.logout) return;
    // codex logout is now a non-interactive subprocess (codex logout writes
    // to ~/.codex/auth.json then exits); no Terminal involvement. Refresh
    // immediately, no polling needed.
    const res = await api.settings.codex.logout();
    if (!res.opened) console.warn('[connections] codex logout failed', res.error);
    setCodexDeviceCode(null);
    setCodexVerificationUrl(null);
    await refreshCodex();
  }, [refreshCodex]);

  const handleSaveKey = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.settings?.apiKey) return;
    if (!claudeStatus.installed) {
      setKeyStatus('error');
      setKeyError('Install Claude Code before adding an Anthropic API key.');
      return;
    }
    const trimmed = draftKey.trim();
    if (!trimmed) return;
    setKeyStatus('testing');
    setKeyError(null);
    const test = await api.settings.apiKey.test(trimmed);
    if (!test.success) {
      setKeyStatus('error');
      setKeyError(test.error ?? 'Key rejected by Anthropic');
      return;
    }
    await api.settings.apiKey.save(trimmed);
    setKeyStatus('ok');
    setDraftKey('');
    setEditing(false);
    await refreshKey();
  }, [claudeStatus.installed, draftKey, refreshKey]);

  const handleDeleteKey = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.settings?.apiKey) return;
    // If user signed in via Claude OAuth, also run `claude logout` in Terminal
    // so the CLI's own keychain entry is cleared — otherwise the next run
    // silently reuses the CLI's stored creds.
    if (authStatus.type === 'oauth' && api.settings.claudeCode?.logout) {
      await api.settings.claudeCode.logout();
    } else {
      await api.settings.apiKey.delete();
    }
    setKeyStatus('idle');
    setKeyError(null);
    await refreshKey();
  }, [authStatus.type, refreshKey]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    api.channels?.whatsapp.status().then((res) => {
      setWaStatus(res.status as WaStatus);
      setWaIdentity(res.identity);
    }).catch(() => {});

    const unsubStatus = api.on?.channelStatus?.((channelId, status, detail) => {
      if (channelId !== 'whatsapp') return;
      setWaStatus(status as WaStatus);
      setWaDetail(detail);
      if (status === 'connected' && detail) {
        setWaIdentity(detail);
        setQrDataUrl(null);
      }
      if (status === 'disconnected' || status === 'error') {
        setQrDataUrl(null);
      }
    });

    const unsubQr = api.on?.whatsappQr?.((dataUrl) => {
      setQrDataUrl(dataUrl);
    });

    return () => {
      unsubStatus?.();
      unsubQr?.();
    };
  }, []);

  const handleConnect = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    setQrDataUrl(null);
    await api.channels.whatsapp.connect();
  }, []);

  const handleDisconnect = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    await api.channels.whatsapp.clearAuth();
    setWaIdentity(null);
    setQrDataUrl(null);
  }, []);

  const handleCancel = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    await api.channels.whatsapp.disconnect();
    setQrDataUrl(null);
  }, []);


  const statusDotClass =
    waStatus === 'connected' ? 'conn-card__dot--connected' :
    waStatus === 'connecting' || waStatus === 'qr_ready' ? 'conn-card__dot--connecting' :
    waStatus === 'error' ? 'conn-card__dot--error' :
    'conn-card__dot--disconnected';

  const statusText =
    waStatus === 'connected' ? `Connected as ${waIdentity ?? 'unknown'}` :
    waStatus === 'connecting' ? 'Connecting...' :
    waStatus === 'qr_ready' ? 'Waiting for scan...' :
    waStatus === 'error' ? (waDetail ?? 'Connection error') :
    'Not connected';

  return (
    <div className={embedded ? 'conn-section' : 'conn-pane'}>
      {!embedded && <span className="conn-pane__title">Connections</span>}

      <span className="conn-pane__section-title">Providers</span>

      <div className="conn-card">
        <div className="conn-card__header">
          <img
            className="conn-card__icon"
            src={authStatus.type === 'oauth' ? claudeCodeLogo : anthropicLogo}
            alt=""
          />
          <div className="conn-card__info">
            <div className="conn-card__title-row">
              <span className="conn-card__name">Anthropic</span>
              <span className={`conn-card__dot ${authStatus.type !== 'none' && claudeStatus.installed ? 'conn-card__dot--connected' : installingEngine === 'claude-code' ? 'conn-card__dot--connecting' : 'conn-card__dot--disconnected'}`} />
            </div>
            <span className="conn-card__subtitle">
              {editing
                ? 'Enter a new key — it will be tested before saving'
                : !claudeStatus.installed && authStatus.type !== 'none'
                ? 'Credentials saved · Claude Code CLI not installed'
                : !claudeStatus.installed
                ? 'Claude Code CLI not installed'
                : claudeWaiting
                ? 'Finish the OAuth flow in your browser…'
                : authStatus.type === 'oauth'
                ? `Signed in with Claude ${authStatus.subscriptionType === 'max' ? 'Max' : authStatus.subscriptionType === 'pro' ? 'Pro' : 'subscription'}`
                : authStatus.type === 'apiKey' && authStatus.masked
                ? `API key · ${authStatus.masked}`
                : 'Not connected'}
            </span>
          </div>
          <div className="conn-card__actions">
            {!editing && !claudeStatus.installed && (
              <button
                className="conn-card__btn conn-card__btn--primary"
                onClick={() => handleInstallEngine('claude-code')}
                disabled={installingEngine === 'claude-code'}
              >
                {installingEngine === 'claude-code' ? 'Installing…' : 'Install Claude Code'}
              </button>
            )}
            {!editing && claudeStatus.installed && authStatus.type === 'none' && (
              <button
                className="conn-card__btn conn-card__btn--primary"
                onClick={handleUseClaudeCode}
                disabled={claudeWaiting}
              >
                {claudeWaiting ? 'Waiting…' : 'Sign in with Claude'}
              </button>
            )}
            {!editing && claudeStatus.installed && authStatus.type === 'none' && (
              <button
                className="conn-card__btn conn-card__btn--secondary"
                onClick={() => { setEditing(true); setDraftKey(''); setKeyStatus('idle'); setKeyError(null); }}
              >
                Add API key
              </button>
            )}
            {!editing && claudeStatus.installed && authStatus.type === 'apiKey' && (
              <button
                className="conn-card__btn conn-card__btn--primary"
                onClick={() => { setEditing(true); setDraftKey(''); setKeyStatus('idle'); setKeyError(null); }}
              >
                Change
              </button>
            )}
            {!editing && authStatus.type !== 'none' && (
              <button className="conn-card__btn conn-card__btn--secondary" onClick={handleDeleteKey}>
                Sign out
              </button>
            )}
            {editing && (
              <button
                className="conn-card__btn conn-card__btn--secondary"
                onClick={() => { setEditing(false); setDraftKey(''); setKeyError(null); setKeyStatus('idle'); }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
        {editing && (
          <div className="conn-card__api-key-edit">
            <input
              type="password"
              className="conn-card__api-key-input"
              placeholder="sk-ant-..."
              value={draftKey}
              onChange={(e) => { setDraftKey(e.target.value); setKeyStatus('idle'); setKeyError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveKey(); }}
              autoFocus
            />
            <button
              className="conn-card__btn conn-card__btn--primary"
              onClick={handleSaveKey}
              disabled={!draftKey.trim() || keyStatus === 'testing'}
            >
              {keyStatus === 'testing' ? 'Testing...' : 'Save'}
            </button>
            {keyStatus === 'error' && keyError && (
              <span className="conn-card__api-key-error">{keyError}</span>
            )}
          </div>
        )}
        {!editing && keyError && (
          <div className="conn-card__api-key-edit">
            <span className="conn-card__api-key-error">{keyError}</span>
          </div>
        )}
      </div>

      <div className="conn-card">
        <div className="conn-card__header">
          <img className="conn-card__icon conn-card__icon--contain" src={opencodeLogo} alt="" />
          <div className="conn-card__info">
            <div className="conn-card__title-row">
              <span className="conn-card__name">BrowserCode</span>
              <span className={`conn-card__dot ${Object.keys(browserCodeStatus.keys).length > 0 && browserCodeStatus.installed?.installed !== false ? 'conn-card__dot--connected' : installingEngine === 'browsercode' ? 'conn-card__dot--connecting' : 'conn-card__dot--disconnected'}`} />
            </div>
            <span className="conn-card__subtitle">
              {browserCodeStatus.installed?.installed === false
                ? 'bcode CLI not installed'
                : Object.keys(browserCodeStatus.keys).length === 0
                ? 'Connect a provider to use BrowserCode with your own API key'
                : `${Object.keys(browserCodeStatus.keys).length} provider${Object.keys(browserCodeStatus.keys).length === 1 ? '' : 's'} connected`}
            </span>
          </div>
          <div className="conn-card__actions">
            {browserCodeStatus.installed?.installed === false && (
              <button
                className="conn-card__btn conn-card__btn--primary"
                onClick={() => handleInstallEngine('browsercode')}
                disabled={installingEngine === 'browsercode'}
              >
                {installingEngine === 'browsercode' ? 'Installing…' : 'Install BrowserCode'}
              </button>
            )}
          </div>
        </div>
        {browserCodeStatus.installed?.installed !== false && browserCodeStatus.providers.map((provider) => {
          const entry = browserCodeStatus.keys[provider.id];
          const connected = !!entry;
          const isEditing = editingProviderId === provider.id;
          const logo = BROWSER_CODE_PROVIDER_LOGOS[provider.id] ?? opencodeLogo;
          return (
            <div key={provider.id} className="conn-card__sub">
              <div className="conn-card__sub-header">
                <img className="conn-card__icon conn-card__icon--small conn-card__icon--contain" src={logo} alt="" />
                <div className="conn-card__info">
                  <div className="conn-card__title-row">
                    <span className="conn-card__name conn-card__name--sub">{provider.name}</span>
                    <span className={`conn-card__dot ${connected ? 'conn-card__dot--connected' : 'conn-card__dot--disconnected'}`} />
                  </div>
                  {(isEditing || connected) && (
                    <span className="conn-card__subtitle">
                      {isEditing
                        ? 'Enter a new key — it will be tested before saving'
                        : `API key · ${entry.masked}`}
                    </span>
                  )}
                </div>
                <div className="conn-card__actions">
                  {!isEditing && !connected && (
                    <button
                      className="conn-card__btn conn-card__btn--primary"
                      onClick={() => handleStartEditBrowserCode(provider.id)}
                    >
                      Connect
                    </button>
                  )}
                  {!isEditing && connected && (
                    <button
                      className="conn-card__btn conn-card__btn--secondary"
                      onClick={() => handleTestBrowserCodeKey(provider.id)}
                      disabled={testingProviderId === provider.id}
                    >
                      {testingProviderId === provider.id ? 'Testing...' : 'Test'}
                    </button>
                  )}
                  {!isEditing && connected && (
                    <button
                      className="conn-card__btn conn-card__btn--primary"
                      onClick={() => handleStartEditBrowserCode(provider.id)}
                    >
                      Update key
                    </button>
                  )}
                  {!isEditing && connected && (
                    <button
                      className="conn-card__btn conn-card__btn--secondary"
                      onClick={() => handleRemoveBrowserCodeKey(provider.id)}
                    >
                      Remove
                    </button>
                  )}
                  {isEditing && (
                    <button
                      className="conn-card__btn conn-card__btn--secondary"
                      onClick={handleCancelEditBrowserCode}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
              {!isEditing && testResultByProvider[provider.id] && (
                <div className="conn-card__api-key-edit">
                  <span className={testResultByProvider[provider.id]!.ok ? 'conn-card__api-key-ok' : 'conn-card__api-key-error'}>
                    {testResultByProvider[provider.id]!.message}
                  </span>
                </div>
              )}
              {isEditing && (
                <div className="conn-card__api-key-edit">
                  <input
                    type="password"
                    className="conn-card__api-key-input"
                    placeholder="sk-..."
                    value={browserCodeKeyDraft}
                    onChange={(e) => { setBrowserCodeKeyDraft(e.target.value); setBrowserCodeKeyStatus('idle'); setBrowserCodeError(null); setBrowserCodeErrorProviderId(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveBrowserCode(provider.id); }}
                    autoFocus
                  />
                  <button
                    className="conn-card__btn conn-card__btn--primary"
                    onClick={() => handleSaveBrowserCode(provider.id)}
                    disabled={!browserCodeKeyDraft.trim() || browserCodeKeyStatus === 'testing'}
                  >
                    {browserCodeKeyStatus === 'testing' ? 'Testing...' : 'Save'}
                  </button>
                  {browserCodeKeyStatus === 'error' && browserCodeError && browserCodeErrorProviderId === provider.id && (
                    <span className="conn-card__api-key-error">{browserCodeError}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {browserCodeError && !editingProviderId && (
          <div className="conn-card__api-key-edit">
            <span className="conn-card__api-key-error">{browserCodeError}</span>
          </div>
        )}
      </div>

      <div className="conn-card">
        <div className="conn-card__header">
          <img
            className="conn-card__icon"
            src={codexStatus.authed ? codexLogo : openaiLogo}
            alt=""
          />
          <div className="conn-card__info">
            <div className="conn-card__title-row">
              <span className="conn-card__name">OpenAI</span>
              <span className={`conn-card__dot ${(codexStatus.authed || openaiStatus.present) && codexStatus.installed ? 'conn-card__dot--connected' : codexWaiting || installingEngine === 'codex' ? 'conn-card__dot--connecting' : 'conn-card__dot--disconnected'}`} />
            </div>
            <span className="conn-card__subtitle">
              {openaiEditing
                ? 'Enter a new key — it will be tested before saving'
                : !codexStatus.installed && openaiStatus.present
                ? 'API key saved · Codex CLI not installed'
                : !codexStatus.installed
                ? 'Codex CLI not installed'
                : openaiStatus.present && openaiStatus.masked
                ? `API key · ${openaiStatus.masked}`
                : codexStatus.authed
                ? `Signed in with ChatGPT subscription${codexStatus.version ? ` · Codex v${codexStatus.version}` : ''}`
                : codexWaiting && codexDeviceCode
                ? 'Enter the code shown below on the verification page.'
                : codexWaiting
                ? 'Finish the OAuth flow in your browser…'
                : 'Not connected'}
            </span>
          </div>
          <div className="conn-card__actions">
            {!openaiEditing && !codexStatus.installed && (
              <button
                className="conn-card__btn conn-card__btn--primary"
                onClick={() => handleInstallEngine('codex')}
                disabled={installingEngine === 'codex'}
              >
                {installingEngine === 'codex' ? 'Installing…' : 'Install Codex'}
              </button>
            )}
            {!openaiEditing && !openaiStatus.present && !codexStatus.authed && codexStatus.installed && (
              <button
                className="conn-card__btn conn-card__btn--primary"
                onClick={handleCodexLoginPlain}
              >
                {codexWaiting ? 'Restart' : 'Sign in with Codex'}
              </button>
            )}
            {!openaiEditing && codexStatus.installed && !openaiStatus.present && !codexStatus.authed && (
              <button
                className="conn-card__btn conn-card__btn--secondary"
                onClick={() => { setOpenaiEditing(true); setOpenaiDraft(''); setOpenaiKeyStatus('idle'); setOpenaiError(null); }}
              >
                Add API key
              </button>
            )}
            {!openaiEditing && codexStatus.installed && openaiStatus.present && (
              <button
                className="conn-card__btn conn-card__btn--secondary"
                onClick={() => { setOpenaiEditing(true); setOpenaiDraft(''); setOpenaiKeyStatus('idle'); setOpenaiError(null); }}
              >
                Change API key
              </button>
            )}
            {!openaiEditing && openaiStatus.present && !codexStatus.authed && (
              <button className="conn-card__btn conn-card__btn--secondary" onClick={handleDeleteOpenai}>
                Sign out
              </button>
            )}
            {!openaiEditing && codexStatus.authed && (
              <button className="conn-card__btn conn-card__btn--secondary" onClick={handleCodexLogout}>
                {openaiStatus.present ? 'Sign out of ChatGPT' : 'Sign out'}
              </button>
            )}
            {openaiEditing && (
              <button
                className="conn-card__btn conn-card__btn--secondary"
                onClick={() => { setOpenaiEditing(false); setOpenaiDraft(''); setOpenaiError(null); setOpenaiKeyStatus('idle'); }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
        {codexDeviceCode && (
          <div className="codex-device-auth">
            <div className="codex-device-auth__label">One-time code</div>
            <div className="codex-device-auth__code">{codexDeviceCode}</div>
            {codexVerificationUrl && (
              <div className="codex-device-auth__hint">
                Verification page should have opened automatically.{' '}
                If not, navigate to{' '}
                <span className="codex-device-auth__url">{codexVerificationUrl}</span>{' '}
                and enter the code above.
              </div>
            )}
          </div>
        )}
        {/* Remote/headless fallback. Mirrors the onboarding affordance —
            ChatGPT accounts need 'Enable device code authorization' in
            Security Settings for this path to work server-side. */}
        {!openaiEditing && !openaiStatus.present && !codexStatus.authed && codexStatus.installed && !codexDeviceCode && (
          <button
            type="button"
            className="codex-device-auth__link codex-device-auth__link--secondary codex-device-auth__fallback"
            onClick={handleCodexLoginDeviceAuth}
          >
            Having trouble? Use device code flow instead
          </button>
        )}
        {openaiEditing && (
          <div className="conn-card__api-key-edit">
            <input
              type="password"
              className="conn-card__api-key-input"
              placeholder="sk-..."
              value={openaiDraft}
              onChange={(e) => { setOpenaiDraft(e.target.value); setOpenaiKeyStatus('idle'); setOpenaiError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveOpenai(); }}
              autoFocus
            />
            <button
              className="conn-card__btn conn-card__btn--primary"
              onClick={handleSaveOpenai}
              disabled={!openaiDraft.trim() || openaiKeyStatus === 'testing'}
            >
              {openaiKeyStatus === 'testing' ? 'Testing...' : 'Save'}
            </button>
            {openaiStatus.present && (
              <button
                className="conn-card__btn conn-card__btn--secondary"
                onClick={() => { void handleDeleteOpenai(); setOpenaiEditing(false); }}
              >
                Remove API key
              </button>
            )}
            {openaiKeyStatus === 'error' && openaiError && (
              <span className="conn-card__api-key-error">{openaiError}</span>
            )}
          </div>
        )}
        {!openaiEditing && openaiError && (
          <div className="conn-card__api-key-edit">
            <span className="conn-card__api-key-error">{openaiError}</span>
          </div>
        )}
      </div>

      <span className="conn-pane__section-title">Connections</span>

      <div className="conn-card">
        <div className="conn-card__header">
          <img
            className="conn-card__icon"
            src="https://static.whatsapp.net/rsrc.php/v3/yP/r/rYZqPCBaG70.png"
            alt=""
          />
          <div className="conn-card__info">
            <div className="conn-card__title-row">
              <span className="conn-card__name">WhatsApp</span>
              <span className={`conn-card__dot ${statusDotClass}`} />
            </div>
            <span className="conn-card__subtitle">
              {waStatus === 'connected' && waIdentity
                ? `Connected as +${waIdentity.replace(/(\d{1})(\d{3})(\d{3})(\d{4})/, '$1 ($2) $3-$4')} — text yourself with @BU to start a session (e.g. "@BU find me a flight to NYC"). Messages without @BU are ignored, so the chat still works as a notes app.`
                : waStatus === 'disconnected'
                ? 'Connect WhatsApp so you can text yourself @BU to launch sessions and get agent notifications back in the same chat.'
                : statusText}
            </span>
          </div>
          <div className="conn-card__actions">
            {waStatus === 'disconnected' && (
              <button className="conn-card__btn conn-card__btn--primary" onClick={handleConnect}>
                Connect
              </button>
            )}
            {(waStatus === 'qr_ready' || waStatus === 'connecting') && (
              <button className="conn-card__btn conn-card__btn--secondary" onClick={handleCancel}>
                Cancel
              </button>
            )}
            {waStatus === 'connected' && (
              <button className="conn-card__btn conn-card__btn--secondary" onClick={handleDisconnect}>
                Disconnect
              </button>
            )}
            {waStatus === 'error' && (
              <button className="conn-card__btn conn-card__btn--primary" onClick={handleConnect}>
                Reconnect
              </button>
            )}
          </div>
        </div>

        {(waStatus === 'qr_ready' || qrDataUrl) && (
          <div className="conn-card__qr">
            {qrDataUrl ? (
              <img
                className="conn-card__qr-img"
                src={qrDataUrl}
                alt="WhatsApp QR code"
              />
            ) : (
              <div className="conn-card__qr-loading">Generating QR...</div>
            )}
            <p className="conn-card__qr-hint">
              Open WhatsApp on your phone, go to Linked Devices, and scan this code. After linking, text yourself with @BU followed by a task (e.g. "@BU summarize my Linear inbox") to start a session — plain notes without @BU are ignored.
            </p>
          </div>
        )}
      </div>

      {cookieBrowserApi && (
        <div className="conn-card conn-card--cookies">
          <CookieBrowser api={cookieBrowserApi} />
        </div>
      )}
    </div>
  );
}

export default ConnectionsPane;
