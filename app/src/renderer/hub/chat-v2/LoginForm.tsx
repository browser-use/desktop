/**
 * LoginForm — credential entry surface rendered for a `login` fenced block.
 *
 * Mirrors the OptionList / AskForm pattern: agent emits the fence, the
 * component renders in place, and on submit we resume the session with a
 * structured user turn. The agent reads the credentials on its next turn
 * and types them into the live browser view.
 *
 * Two affordances:
 *   - Primary: username + password fields → "Login for <site>:\n…" turn.
 *   - Escape: "Log in manually in the browser" link → opens the site
 *             externally and resumes with "I'll log in to <site> myself".
 *
 * Persistence is transcript-derived (same as OptionList): on reload we
 * read the next user turn and reconstruct the receipt view. The
 * receipt NEVER re-renders the plaintext password — only the agent's
 * raw transcript carries it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LoginPayload } from './htmlBlocks';
import './loginForm.css';

interface Props {
  payload: LoginPayload | null;
  complete: boolean;
  error?: string;
  sessionId?: string;
  /** User reply turn that follows this form, if any. */
  nextUserText?: string | null;
}

type Mode = 'live' | 'submitted-credentials';

export function LoginForm(props: Props): React.ReactElement {
  const { payload, complete, error, sessionId, nextUserText } = props;
  if (!payload) {
    if (complete && error) {
      return (
        <div className="chatv2-login" data-testid="chatv2-login" data-state="error">
          <div className="chatv2-login__error">login block ignored: {error}</div>
        </div>
      );
    }
    return <LoginFormSkeleton />;
  }
  return <LoginFormReady payload={payload} sessionId={sessionId} nextUserText={nextUserText} />;
}

function LoginFormSkeleton(): React.ReactElement {
  return (
    <div className="chatv2-login" data-testid="chatv2-login" data-state="loading">
      <div className="chatv2-login__skel-line chatv2-login__skel-line--med" />
      <div className="chatv2-login__skel-input" />
      <div className="chatv2-login__skel-input" />
    </div>
  );
}

interface ReadyProps {
  payload: LoginPayload;
  sessionId?: string;
  nextUserText?: string | null;
}

function siteFaviconUrl(url: string): string | undefined {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
  } catch {
    return undefined;
  }
}

function siteHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function LoginFormReady({ payload, sessionId, nextUserText }: ReadyProps): React.ReactElement {
  const { site, url, prompt, usernameLabel, passwordLabel } = payload;
  const usernameLbl = usernameLabel || 'Username';
  const passwordLbl = passwordLabel || 'Password';

  const transcriptMode = useMemo(
    () => deriveLoginSubmissionMode(nextUserText, site),
    [nextUserText, site],
  );

  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [mode, setMode] = useState<Mode>(transcriptMode ?? 'live');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [localSubmit, setLocalSubmit] = useState<boolean>(false);
  const usernameRef = useRef<HTMLInputElement | null>(null);

  // Late-arriving transcript: hydrate if it shows up after first paint.
  useEffect(() => {
    if (!transcriptMode || localSubmit) return;
    setMode(transcriptMode);
  }, [transcriptMode, localSubmit]);

  // Auto-focus the username field on first mount (live state only).
  useEffect(() => {
    if (mode === 'live' && usernameRef.current) {
      usernameRef.current.focus({ preventScroll: true });
    }
  }, [mode]);

  const canSubmit = username.trim().length > 0 && password.length > 0;

  const submitCredentials = useCallback(async (): Promise<void> => {
    if (!canSubmit || mode !== 'live') return;
    if (!sessionId) {
      setSubmitError('no active session');
      return;
    }
    const message = `Login for ${site}:\nusername: ${username}\npassword: ${password}`;
    setLocalSubmit(true);
    setMode('submitted-credentials');
    setSubmitError(null);
    try {
      const result = await window.electronAPI?.sessions?.resume(sessionId, message);
      if (result?.error) {
        setSubmitError(result.error);
        setMode('live');
        setLocalSubmit(false);
      }
    } catch (err) {
      setSubmitError((err as Error).message);
      setMode('live');
      setLocalSubmit(false);
    }
  }, [canSubmit, mode, sessionId, site, username, password]);

  const openBrowserView = useCallback((): void => {
    // Same action the chatbar's BrowserPreview thumbnail performs — opens
    // the in-app WebContentsView so the user can log in directly there.
    // No synthetic chat message; the user signals "done" by typing their
    // own next message.
    window.dispatchEvent(new CustomEvent('chatv2:open-browser'));
  }, []);

  if (mode === 'submitted-credentials') {
    return (
      <div
        className="chatv2-login chatv2-login--submitted"
        data-testid="chatv2-login"
        data-state="submitted"
      >
        <div className="chatv2-login__receipt">
          <div className="chatv2-login__receipt-title">
            Submitted credentials for {site}
          </div>
          <SiteAttribution url={url} site={site} />
          <div className="chatv2-login__receipt-meta">
            agent will type these into the live tab
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chatv2-login" data-testid="chatv2-login" data-state="live">
      <div className="chatv2-login__head">
        <div className="chatv2-login__prompt">
          {prompt || `Sign in to ${site}`}
        </div>
        <SiteAttribution url={url} site={site} />
      </div>

      <form
        className="chatv2-login__form"
        onSubmit={(e) => { e.preventDefault(); void submitCredentials(); }}
      >
        <label className="chatv2-login__field">
          <span className="chatv2-login__field-label">{usernameLbl}</span>
          <input
            ref={usernameRef}
            type="text"
            className="chatv2-login__input"
            autoComplete="username"
            spellCheck={false}
            autoCapitalize="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>

        <label className="chatv2-login__field">
          <span className="chatv2-login__field-label">{passwordLbl}</span>
          <div className="chatv2-login__password-wrap">
            <input
              type={showPassword ? 'text' : 'password'}
              className="chatv2-login__input"
              autoComplete="current-password"
              spellCheck={false}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="chatv2-login__reveal"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              {showPassword ? 'hide' : 'show'}
            </button>
          </div>
        </label>

        <ManualLoginLink site={site} onClick={openBrowserView} />

        <div className="chatv2-login__foot">
          <button
            type="submit"
            className="chatv2-login__submit"
            disabled={!canSubmit}
          >
            Send to agent
          </button>
        </div>

        {submitError && (
          <div className="chatv2-login__submit-error">{submitError}</div>
        )}
      </form>
    </div>
  );
}

/** Hostname + favicon row under the prompt — same credibility cue
 *  OptionList uses for its "Results from <site>" attribution. */
function SiteAttribution({ url, site }: { url: string; site: string }): React.ReactElement | null {
  const [broken, setBroken] = useState<boolean>(false);
  const host = siteHostname(url);
  const src = siteFaviconUrl(url);
  if (!host) return null;
  return (
    <div className="chatv2-login__attribution">
      {src && !broken && (
        <img
          className="chatv2-login__attribution-icon"
          src={src}
          alt=""
          width={12}
          height={12}
          onError={() => setBroken(true)}
        />
      )}
      <span className="chatv2-login__attribution-text">
        <b className="chatv2-login__attribution-site">{site}</b>
        <span className="chatv2-login__attribution-sep" aria-hidden="true">·</span>
        <span className="chatv2-login__attribution-host">{host}</span>
      </span>
    </div>
  );
}

function ManualLoginLink({ site, onClick }: { site: string; onClick: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      className="chatv2-login__manual-link"
      onClick={onClick}
    >
      <span>log in on {site} myself</span>
      <svg
        className="chatv2-login__manual-link-arrow"
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 17 L17 7 M9 7 H17 V15" />
      </svg>
    </button>
  );
}

/**
 * Detect whether `text` is the user-reply turn that follows this login
 * form and, if so, which mode the form should restore to. Returns null
 * when the text isn't a login reply for this `site`.
 *
 * Exported for tests.
 */
export function deriveLoginSubmissionMode(
  text: string | null | undefined,
  site: string,
): 'submitted-credentials' | null {
  if (!text) return null;
  if (text.trimStart().startsWith(`Login for ${site}:`)) return 'submitted-credentials';
  return null;
}
