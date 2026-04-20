import React, { useState, useEffect, useCallback } from 'react';
import { DomainList } from './DomainList';

interface ChromeProfile {
  directory: string;
  name: string;
  email: string;
  avatarIcon: string;
}

interface CookieImportResult {
  total: number;
  imported: number;
  failed: number;
  skipped: number;
  domains: string[];
  failedDomains: string[];
  errorReasons: Record<string, number>;
}

declare global {
  interface Window {
    onboardingAPI: {
      detectChromeProfiles: () => Promise<ChromeProfile[]>;
      importChromeProfileCookies: (profileDir: string) => Promise<CookieImportResult>;
      saveApiKey: (key: string) => Promise<void>;
      testApiKey: (key: string) => Promise<{ success: boolean; error?: string }>;
      complete: () => Promise<void>;
      whatsapp: {
        connect: () => Promise<{ status: string }>;
        disconnect: () => Promise<{ status: string }>;
        status: () => Promise<{ status: string; identity: string | null }>;
      };
      onWhatsappQr: (cb: (dataUrl: string) => void) => () => void;
      onChannelStatus: (cb: (channelId: string, status: string, detail?: string) => void) => () => void;
    };
  }
}

type Step = 'profile' | 'apikey' | 'whatsapp';

export function OnboardingApp() {
  const [step, setStep] = useState<Step>('profile');
  const [profiles, setProfiles] = useState<ChromeProfile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [importing, setImporting] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<CookieImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.onboardingAPI.detectChromeProfiles().then((p) => {
      setProfiles(p);
      setLoadingProfiles(false);
    }).catch((err) => {
      console.error('[onboarding] detectProfiles failed', err);
      setLoadingProfiles(false);
    });
  }, []);

  const handleImportProfile = useCallback(async (profileDir: string) => {
    setImporting(profileDir);
    setImportError(null);
    setImportResult(null);
    try {
      const result = await window.onboardingAPI.importChromeProfileCookies(profileDir);
      setImportResult(result);
    } catch (err) {
      setImportError((err as Error).message);
    } finally {
      setImporting(null);
    }
  }, []);

  const handleSkipProfile = useCallback(() => {
    setStep('apikey');
  }, []);

  const handleTestKey = useCallback(async () => {
    if (!apiKey.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await window.onboardingAPI.testApiKey(apiKey.trim());
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }, [apiKey]);

  const [waStatus, setWaStatus] = useState<string>('disconnected');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [waIdentity, setWaIdentity] = useState<string | null>(null);

  const handleSaveKeyAndContinue = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await window.onboardingAPI.saveApiKey(apiKey.trim());
      setStep('whatsapp');
    } catch (err) {
      console.error('[onboarding] save key failed', err);
    } finally {
      setSaving(false);
    }
  }, [apiKey]);

  const handleConnectWhatsApp = useCallback(async () => {
    setQrDataUrl(null);
    await window.onboardingAPI.whatsapp.connect();
  }, []);

  const handleFinish = useCallback(async () => {
    try {
      await window.onboardingAPI.complete();
    } catch (err) {
      console.error('[onboarding] complete failed', err);
    }
  }, []);

  useEffect(() => {
    if (step !== 'whatsapp') return;
    const unsubQr = window.onboardingAPI.onWhatsappQr((dataUrl) => {
      setQrDataUrl(dataUrl);
    });
    const unsubStatus = window.onboardingAPI.onChannelStatus((channelId, status, detail) => {
      if (channelId !== 'whatsapp') return;
      setWaStatus(status);
      if (status === 'connected' && detail) {
        setWaIdentity(detail);
        setQrDataUrl(null);
      }
    });
    return () => { unsubQr(); unsubStatus(); };
  }, [step]);

  return (
    <div className="onboarding-container">
      <div className="onboarding-drag-region" />

      <div className="onboarding-content">
        <div className="step-indicator">
          <div className={`step-dot ${step === 'profile' ? 'active' : 'done'}`} />
          <div className="step-line" />
          <div className={`step-dot ${step === 'apikey' ? 'active' : step === 'whatsapp' ? 'done' : ''}`} />
          <div className="step-line" />
          <div className={`step-dot ${step === 'whatsapp' ? 'active' : ''}`} />
        </div>

        {step === 'profile' && (
          <div className="step-panel">
            <h1 className="step-title">Import Chrome Profile</h1>
            <p className="step-subtitle">
              Import your cookies so agents can browse as you, or start fresh.
            </p>

            {loadingProfiles && (
              <div className="profile-loading">Detecting Chrome profiles...</div>
            )}

            {!loadingProfiles && profiles.length === 0 && (
              <div className="profile-empty">
                <p>No Chrome profiles found.</p>
                <button className="btn btn-primary" onClick={handleSkipProfile}>
                  Continue without import
                </button>
              </div>
            )}

            {!loadingProfiles && profiles.length > 0 && (
              <div className="profile-list">
                {profiles.map((p) => (
                  <button
                    key={p.directory}
                    className="profile-card"
                    onClick={() => handleImportProfile(p.directory)}
                    disabled={importing !== null}
                  >
                    <div className="profile-avatar">
                      {p.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="profile-info">
                      <div className="profile-name">{p.name}</div>
                      {p.email && <div className="profile-email">{p.email}</div>}
                      <div className="profile-dir">{p.directory}</div>
                    </div>
                    {importing === p.directory && (
                      <div className="profile-spinner" />
                    )}
                  </button>
                ))}

                <button
                  className="profile-card profile-card-skip"
                  onClick={handleSkipProfile}
                  disabled={importing !== null}
                >
                  <div className="profile-avatar profile-avatar-skip">+</div>
                  <div className="profile-info">
                    <div className="profile-name">Start fresh</div>
                    <div className="profile-email">No cookie import</div>
                  </div>
                </button>
              </div>
            )}

            {importResult && (
              <div className="import-results">
                <div className="import-result import-result-success">
                  Imported {importResult.imported.toLocaleString()} cookies from {importResult.domains.length} domains
                </div>

                <DomainList domains={importResult.domains} collapsible />

                {importResult.failedDomains.length > 0 && (
                  <div className="import-failed-section">
                    <div className="import-result import-result-error">
                      {importResult.failed} cookies failed from {importResult.failedDomains.length} domains
                    </div>
                    {Object.keys(importResult.errorReasons).length > 0 && (
                      <div className="error-reasons">
                        {Object.entries(importResult.errorReasons)
                          .sort(([, a], [, b]) => b - a)
                          .map(([reason, count]) => (
                            <div key={reason} className="error-reason-row">
                              <span className="error-reason-count">{count}</span>
                              <span className="error-reason-text">{reason}</span>
                            </div>
                          ))}
                      </div>
                    )}
                    <DomainList domains={importResult.failedDomains} collapsible />
                  </div>
                )}

                <button
                  className="btn btn-primary import-continue-btn"
                  onClick={() => setStep('apikey')}
                >
                  Continue
                </button>
              </div>
            )}

            {importError && (
              <div className="import-result import-result-error">
                {importError}
              </div>
            )}
          </div>
        )}

        {step === 'apikey' && (
          <div className="step-panel">
            <h1 className="step-title">Anthropic API Key</h1>
            <p className="step-subtitle">
              Your key is stored locally in the system keychain.
            </p>

            <div className="apikey-input-wrap">
              <input
                type={showKey ? 'text' : 'password'}
                className="apikey-input"
                placeholder="sk-ant-..."
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setTestResult(null);
                }}
                spellCheck={false}
                autoFocus
              />
              <button
                className="apikey-toggle"
                onClick={() => setShowKey(!showKey)}
                tabIndex={-1}
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>

            <div className="apikey-actions">
              <button
                className="btn btn-secondary"
                onClick={handleTestKey}
                disabled={!apiKey.trim() || testing}
              >
                {testing ? 'Testing...' : 'Test Key'}
              </button>

              <button
                className="btn btn-primary"
                onClick={handleSaveKeyAndContinue}
                disabled={!apiKey.trim() || saving}
              >
                {saving ? 'Saving...' : 'Continue'}
              </button>
            </div>

            {testResult && (
              <div className={`test-result ${testResult.success ? 'test-result-success' : 'test-result-error'}`}>
                {testResult.success ? 'Key is valid' : testResult.error || 'Invalid key'}
              </div>
            )}

            <button className="back-btn" onClick={() => setStep('profile')}>
              Back
            </button>
          </div>
        )}

        {step === 'whatsapp' && (
          <div className="step-panel">
            <h1 className="step-title">Connect WhatsApp</h1>
            <p className="step-subtitle">
              Receive agent notifications and trigger tasks from WhatsApp.
            </p>

            {waStatus === 'connected' ? (
              <div className="wa-connected">
                <div className="wa-connected__icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="wa-connected__text">
                  Connected as {waIdentity ?? 'WhatsApp'}
                </p>
              </div>
            ) : waStatus === 'qr_ready' || qrDataUrl ? (
              <div className="wa-qr">
                {qrDataUrl ? (
                  <img className="wa-qr__img" src={qrDataUrl} alt="WhatsApp QR code" />
                ) : (
                  <div className="wa-qr__loading">Generating QR...</div>
                )}
                <p className="wa-qr__hint">
                  Open WhatsApp on your phone, go to Linked Devices, and scan this code
                </p>
              </div>
            ) : waStatus === 'connecting' ? (
              <div className="wa-connecting">
                <div className="profile-spinner" />
                <p>Connecting...</p>
              </div>
            ) : (
              <button className="btn btn-secondary wa-connect-btn" onClick={handleConnectWhatsApp}>
                Connect WhatsApp
              </button>
            )}

            <div className="apikey-actions">
              {waStatus !== 'connected' && (
                <button className="btn btn-secondary" onClick={handleFinish}>
                  Skip for now
                </button>
              )}
              <button className="btn btn-primary" onClick={handleFinish}>
                {waStatus === 'connected' ? 'Get Started' : 'Get Started'}
              </button>
            </div>

            <button className="back-btn" onClick={() => setStep('apikey')}>
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
