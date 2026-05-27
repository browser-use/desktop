/**
 * ErrorBoundary — React error boundary.
 *
 * Shows "Something broke" + a reload button.
 * Uses CSS classes from empty-states.css.
 * No !important, no Inter font, no sparkles icon.
 */

import React, { Component, ErrorInfo } from 'react';
import i18n from '../../i18n';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional custom fallback. If provided, renders instead of the default UI. */
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Inline the message/stack into the first arg so Electron's
    // `console-message` forwarder (window.ts) captures everything in
    // renderer.log — passing structured args yields "[object Object]" because
    // only the first formatted string survives the IPC.
    const stack = error.stack ?? '(no stack)';
    const componentStack = info.componentStack ?? '(no component stack)';
    console.error(`[ErrorBoundary] ${error.name}: ${error.message}\nstack: ${stack}\ncomponentStack: ${componentStack}`);
  }

  private handleReload = (): void => {
    // Reset state so subtree can remount
    this.setState({ hasError: false, errorMessage: null });
    // Also reload the window as a fallback
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <div className="empty-state" data-variant="error" role="alert" aria-label={i18n.t('Something broke')}>
        <p className="empty-state__heading">{i18n.t('Something broke')}</p>
        <p className="empty-state__body">{i18n.t('An unexpected error occurred. You can try reloading.')}</p>

        <button
          type="button"
          className="empty-state__reload-btn"
          onClick={this.handleReload}
        >
          {i18n.t('Reload')}
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
