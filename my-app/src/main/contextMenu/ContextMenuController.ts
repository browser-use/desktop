/**
 * ContextMenuController — right-click context menus for page content.
 *
 * Attaches to each WebContentsView's 'context-menu' event and builds a
 * Chrome-parity menu based on what was clicked (page, link, image, selection,
 * editable, or password field).
 */

import { Menu, MenuItem, clipboard, shell, type BrowserWindow, type WebContents, type ContextMenuParams } from 'electron';
import { mainLogger } from '../logger';
import type { PasswordStore } from '../passwords/PasswordStore';

const SETTINGS_PASSWORDS_URL = 'chrome://settings/passwords';

export interface ContextMenuDeps {
  win: BrowserWindow;
  createTab: (url: string) => void;
  navigateActive: (url: string) => void;
  passwordStore?: PasswordStore;
}

export function attachContextMenu(wc: WebContents, deps: ContextMenuDeps): void {
  wc.on('context-menu', (_event, params) => {
    const menu = buildMenu(params, wc, deps);
    if (menu.items.length > 0) {
      menu.popup({ window: deps.win });
    }
  });
}

function buildMenu(params: ContextMenuParams, wc: WebContents, deps: ContextMenuDeps): Menu {
  const menu = new Menu();
  const hasLink = !!params.linkURL;
  const hasImage = params.mediaType === 'image';
  const hasSelection = !!params.selectionText;
  const isEditable = params.isEditable;
  const isPasswordField = params.formControlType === 'input-password';
  const pageUrl = wc.getURL();

  if (hasLink) {
    buildLinkMenu(menu, params, wc, deps);
  } else if (hasImage) {
    buildImageMenu(menu, params, wc, deps);
  } else if (hasSelection) {
    buildSelectionMenu(menu, params, wc, deps);
  } else if (isEditable && isPasswordField) {
    buildPasswordMenu(menu, params, wc, deps);
  } else if (isEditable) {
    buildEditableMenu(menu, params, wc);
  } else {
    buildPageMenu(menu, params, wc, deps, pageUrl);
  }

  return menu;
}

function buildPageMenu(
  menu: Menu, params: ContextMenuParams, wc: WebContents,
  deps: ContextMenuDeps, pageUrl: string,
): void {
  menu.append(new MenuItem({
    label: 'Back',
    enabled: wc.canGoBack(),
    click: () => wc.goBack(),
  }));
  menu.append(new MenuItem({
    label: 'Forward',
    enabled: wc.canGoForward(),
    click: () => wc.goForward(),
  }));
  menu.append(new MenuItem({
    label: 'Reload',
    click: () => wc.reload(),
  }));
  menu.append(new MenuItem({ type: 'separator' }));
  menu.append(new MenuItem({
    label: 'Save Page As…',
    click: () => {
      wc.savePage(pageUrl, 'HTMLComplete').catch((err) => {
        mainLogger.warn('contextMenu.savePage.failed', { error: (err as Error).message });
      });
    },
  }));
  menu.append(new MenuItem({ type: 'separator' }));
  menu.append(new MenuItem({
    label: 'View Page Source',
    click: () => deps.createTab(`view-source:${pageUrl}`),
  }));
  menu.append(new MenuItem({
    label: 'Inspect',
    click: () => {
      mainLogger.debug('contextMenu.inspect', { x: params.x, y: params.y });
      wc.inspectElement(params.x, params.y);
    },
  }));
}

function buildLinkMenu(menu: Menu, params: ContextMenuParams, wc: WebContents, deps: ContextMenuDeps): void {
  menu.append(new MenuItem({
    label: 'Open Link in New Tab',
    click: () => deps.createTab(params.linkURL),
  }));
  menu.append(new MenuItem({ type: 'separator' }));
  menu.append(new MenuItem({
    label: 'Copy Link Address',
    click: () => clipboard.writeText(params.linkURL),
  }));
  menu.append(new MenuItem({
    label: 'Save Link As…',
    enabled: false,
  }));
  menu.append(new MenuItem({ type: 'separator' }));
  menu.append(new MenuItem({
    label: 'Inspect',
    click: () => {
      mainLogger.debug('contextMenu.inspect', { x: params.x, y: params.y });
      wc.inspectElement(params.x, params.y);
    },
  }));
}

function buildImageMenu(menu: Menu, params: ContextMenuParams, wc: WebContents, deps: ContextMenuDeps): void {
  menu.append(new MenuItem({
    label: 'Open Image in New Tab',
    click: () => deps.createTab(params.srcURL),
  }));
  menu.append(new MenuItem({ type: 'separator' }));
  menu.append(new MenuItem({
    label: 'Copy Image',
    click: () => {
      deps.win.webContents.copyImageAt(params.x, params.y);
    },
  }));
  menu.append(new MenuItem({
    label: 'Copy Image Address',
    click: () => clipboard.writeText(params.srcURL),
  }));
  menu.append(new MenuItem({
    label: 'Save Image As…',
    enabled: false,
  }));
  menu.append(new MenuItem({ type: 'separator' }));
  menu.append(new MenuItem({
    label: 'Inspect',
    click: () => {
      mainLogger.debug('contextMenu.inspect', { x: params.x, y: params.y });
      wc.inspectElement(params.x, params.y);
    },
  }));
}

function buildSelectionMenu(
  menu: Menu, params: ContextMenuParams, wc: WebContents, deps: ContextMenuDeps,
): void {
  menu.append(new MenuItem({
    label: 'Copy',
    enabled: params.editFlags.canCopy,
    click: () => wc.copy(),
  }));
  menu.append(new MenuItem({ type: 'separator' }));

  const query = params.selectionText.trim().slice(0, 80);
  menu.append(new MenuItem({
    label: `Search Google for "${query.length > 40 ? query.slice(0, 40) + '…' : query}"`,
    click: () => deps.createTab(`https://www.google.com/search?q=${encodeURIComponent(params.selectionText.trim())}`),
  }));
  menu.append(new MenuItem({ type: 'separator' }));
  menu.append(new MenuItem({
    label: 'Inspect',
    click: () => {
      mainLogger.debug('contextMenu.inspect', { x: params.x, y: params.y });
      wc.inspectElement(params.x, params.y);
    },
  }));
}

function buildEditableMenu(menu: Menu, params: ContextMenuParams, wc: WebContents): void {
  menu.append(new MenuItem({
    label: 'Undo',
    enabled: params.editFlags.canUndo,
    click: () => wc.undo(),
  }));
  menu.append(new MenuItem({
    label: 'Redo',
    enabled: params.editFlags.canRedo,
    click: () => wc.redo(),
  }));
  menu.append(new MenuItem({ type: 'separator' }));
  menu.append(new MenuItem({
    label: 'Cut',
    enabled: params.editFlags.canCut,
    click: () => wc.cut(),
  }));
  menu.append(new MenuItem({
    label: 'Copy',
    enabled: params.editFlags.canCopy,
    click: () => wc.copy(),
  }));
  menu.append(new MenuItem({
    label: 'Paste',
    enabled: params.editFlags.canPaste,
    click: () => wc.paste(),
  }));
  menu.append(new MenuItem({
    label: 'Select All',
    enabled: params.editFlags.canSelectAll,
    click: () => wc.selectAll(),
  }));

  if (params.misspelledWord) {
    menu.append(new MenuItem({ type: 'separator' }));
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      menu.append(new MenuItem({
        label: suggestion,
        click: () => wc.replaceMisspelling(suggestion),
      }));
    }
  }
}

/**
 * Password field context menu — shown when right-clicking a <input type="password">.
 * Mirrors Chrome's password-field menu: Use Password Manager, Suggest Strong Password,
 * and Show Saved Passwords.
 */
function buildPasswordMenu(
  menu: Menu, params: ContextMenuParams, wc: WebContents, deps: ContextMenuDeps,
): void {
  const pageOrigin = (() => {
    try {
      return new URL(wc.getURL()).origin;
    } catch {
      return '';
    }
  })();

  const savedCreds = deps.passwordStore
    ? deps.passwordStore.findCredentialsForOrigin(pageOrigin)
    : [];

  mainLogger.debug('contextMenu.passwordField', {
    origin: pageOrigin,
    savedCredCount: savedCreds.length,
  });

  // "Use Password Manager" — fills saved credentials if any exist for this origin,
  // otherwise opens the saved passwords settings page.
  if (savedCreds.length > 0) {
    const credSubmenu = new Menu();
    for (const cred of savedCreds) {
      credSubmenu.append(new MenuItem({
        label: cred.username || '(no username)',
        click: () => {
          mainLogger.info('contextMenu.passwordField.autofill', { id: cred.id, origin: pageOrigin });
          wc.executeJavaScript(
            `(function() {
              var el = document.activeElement;
              if (!el || el.type !== 'password') {
                el = document.querySelector('input[type="password"]');
              }
              if (el) { el.focus(); }
            })()`,
          ).catch(() => {});
          // Trigger autofill via IPC (calls requireBiometric + revealPassword)
          deps.win.webContents.send('password-autofill-request', { id: cred.id });
        },
      }));
    }
    menu.append(new MenuItem({
      label: 'Use Password Manager',
      submenu: credSubmenu,
    }));
  } else {
    menu.append(new MenuItem({
      label: 'Use Password Manager',
      click: () => {
        mainLogger.info('contextMenu.passwordField.openPasswordManager');
        deps.createTab(SETTINGS_PASSWORDS_URL);
      },
    }));
  }

  menu.append(new MenuItem({ type: 'separator' }));

  // "Suggest Strong Password" — opens the passwords settings page where the user
  // can manage and generate passwords (chrome://settings/passwords parity).
  menu.append(new MenuItem({
    label: 'Suggest Strong Password',
    click: () => {
      mainLogger.info('contextMenu.passwordField.suggestStrongPassword');
      wc.executeJavaScript(
        `(function() {
          var el = document.activeElement;
          if (!el || el.type !== 'password') {
            el = document.querySelector('input[type="password"]');
          }
          if (el) {
            var pwd = Array.from(crypto.getRandomValues(new Uint8Array(16)))
              .map(b => 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*'[b % 63])
              .join('');
            el.focus();
            el.value = pwd;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()`,
      ).catch((err) => {
        mainLogger.warn('contextMenu.passwordField.suggestStrongPassword.failed', {
          error: (err as Error).message,
        });
      });
    },
  }));

  menu.append(new MenuItem({ type: 'separator' }));

  // "Show Saved Passwords" — navigates to chrome://settings/passwords.
  menu.append(new MenuItem({
    label: 'Show Saved Passwords',
    click: () => {
      mainLogger.info('contextMenu.passwordField.showSavedPasswords');
      deps.createTab(SETTINGS_PASSWORDS_URL);
    },
  }));
}
