/**
 * Per-tab navigation controller: back, forward, reload, navigate.
 * Wraps WebContents navigation methods.
 */

import { WebContentsView } from 'electron';

export interface HistoryEntry {
  url: string;
  title: string;
}

export class NavigationController {
  private view: WebContentsView;

  constructor(view: WebContentsView) {
    this.view = view;
  }

  navigate(url: string): void {
    console.log(`[NavigationController] Navigating to: ${url}`);
    this.view.webContents.loadURL(url);
  }

  goBack(): void {
    if (this.view.webContents.navigationHistory.canGoBack()) {
      console.log('[NavigationController] Going back');
      this.view.webContents.navigationHistory.goBack();
    }
  }

  goForward(): void {
    if (this.view.webContents.navigationHistory.canGoForward()) {
      console.log('[NavigationController] Going forward');
      this.view.webContents.navigationHistory.goForward();
    }
  }

  reload(): void {
    console.log('[NavigationController] Reloading');
    this.view.webContents.reload();
  }

  reloadIgnoringCache(): void {
    console.log('[NavigationController] Hard reload (ignoring cache)');
    this.view.webContents.reloadIgnoringCache();
  }

  canGoBack(): boolean {
    return this.view.webContents.navigationHistory.canGoBack();
  }

  canGoForward(): boolean {
    return this.view.webContents.navigationHistory.canGoForward();
  }

  getCurrentURL(): string {
    return this.view.webContents.getURL();
  }

  getActiveIndex(): number {
    return this.view.webContents.navigationHistory.getActiveIndex();
  }

  getAllEntries(): HistoryEntry[] {
    try {
      const entries = this.view.webContents.navigationHistory.getAllEntries();
      return entries.map((e: { url: string; title: string }) => ({
        url: e.url,
        title: e.title || e.url,
      }));
    } catch {
      return [{ url: this.getCurrentURL(), title: '' }];
    }
  }

  goToIndex(index: number): void {
    console.log(`[NavigationController] Going to history index: ${index}`);
    this.view.webContents.navigationHistory.goToIndex(index);
  }
}
