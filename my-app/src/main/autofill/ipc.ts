/**
 * autofill/ipc.ts — IPC handlers for address and payment card management.
 *
 * Registers all autofill: channels via ipcMain.handle.
 * Call registerAutofillHandlers() once after app.whenReady().
 *
 * Security invariants:
 *   - Full card numbers are NEVER logged.
 *   - CVC is NEVER stored or logged.
 *   - revealCardNumber requires biometric gate.
 */

import { ipcMain } from 'electron';
import { mainLogger } from '../logger';
import { assertString } from '../ipc-validators';
import type { AutofillStore } from './AutofillStore';
import { requireBiometric } from '../passwords/BiometricAuth';
import type { SavedAddress } from './AutofillStore';

// IPC channels — addresses
const CH_ADDR_SAVE   = 'autofill:address-save';
const CH_ADDR_LIST   = 'autofill:address-list';
const CH_ADDR_UPDATE = 'autofill:address-update';
const CH_ADDR_DELETE = 'autofill:address-delete';

// IPC channels — cards
const CH_CARD_SAVE   = 'autofill:card-save';
const CH_CARD_LIST   = 'autofill:card-list';
const CH_CARD_REVEAL = 'autofill:card-reveal';
const CH_CARD_UPDATE = 'autofill:card-update';
const CH_CARD_DELETE = 'autofill:card-delete';

// IPC channels — batch
const CH_DELETE_ALL  = 'autofill:delete-all';

const CHANNEL_COUNT = 10;

let _store: AutofillStore | null = null;

export interface RegisterAutofillHandlersOptions {
  store: AutofillStore;
}

export function registerAutofillHandlers(opts: RegisterAutofillHandlersOptions): void {
  mainLogger.info('autofill.ipc.register');
  _store = opts.store;

  // ---------------------------------------------------------------------------
  // Address handlers
  // ---------------------------------------------------------------------------

  ipcMain.handle(CH_ADDR_SAVE, (_e, payload: Omit<SavedAddress, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (!_store) throw new Error('AutofillStore not initialised');
    const fullName    = assertString(payload?.fullName ?? '',    'fullName',    200);
    const company     = assertString(payload?.company ?? '',     'company',     200);
    const addressLine1 = assertString(payload?.addressLine1 ?? '', 'addressLine1', 500);
    const addressLine2 = assertString(payload?.addressLine2 ?? '', 'addressLine2', 500);
    const city        = assertString(payload?.city ?? '',        'city',        200);
    const state       = assertString(payload?.state ?? '',       'state',       100);
    const postalCode  = assertString(payload?.postalCode ?? '',  'postalCode',  20);
    const country     = assertString(payload?.country ?? '',     'country',     100);
    const phone       = assertString(payload?.phone ?? '',       'phone',       50);
    const email       = assertString(payload?.email ?? '',       'email',       200);
    mainLogger.info(CH_ADDR_SAVE, { country });
    return _store.saveAddress({ fullName, company, addressLine1, addressLine2, city, state, postalCode, country, phone, email });
  });

  ipcMain.handle(CH_ADDR_LIST, () => {
    if (!_store) throw new Error('AutofillStore not initialised');
    mainLogger.info(CH_ADDR_LIST);
    return _store.listAddresses();
  });

  ipcMain.handle(CH_ADDR_UPDATE, (_e, payload: { id: string } & Partial<Omit<SavedAddress, 'id' | 'createdAt' | 'updatedAt'>>) => {
    if (!_store) throw new Error('AutofillStore not initialised');
    const id = assertString(payload?.id, 'id', 100);
    mainLogger.info(CH_ADDR_UPDATE, { id });
    const { id: _id, ...patch } = payload;
    return _store.updateAddress(id, patch);
  });

  ipcMain.handle(CH_ADDR_DELETE, (_e, id: string) => {
    if (!_store) throw new Error('AutofillStore not initialised');
    const validId = assertString(id, 'id', 100);
    mainLogger.info(CH_ADDR_DELETE, { id: validId });
    return _store.deleteAddress(validId);
  });

  // ---------------------------------------------------------------------------
  // Card handlers
  // ---------------------------------------------------------------------------

  ipcMain.handle(CH_CARD_SAVE, (_e, payload: {
    nameOnCard: string;
    cardNumber: string;
    expiryMonth: string;
    expiryYear: string;
    nickname: string;
  }) => {
    if (!_store) throw new Error('AutofillStore not initialised');
    const nameOnCard  = assertString(payload?.nameOnCard ?? '',  'nameOnCard',  200);
    const cardNumber  = assertString(payload?.cardNumber ?? '',  'cardNumber',  25);
    const expiryMonth = assertString(payload?.expiryMonth ?? '', 'expiryMonth', 2);
    const expiryYear  = assertString(payload?.expiryYear ?? '',  'expiryYear',  4);
    const nickname    = assertString(payload?.nickname ?? '',    'nickname',    100);
    mainLogger.info(CH_CARD_SAVE, { nameOnCard, expiryMonth, expiryYear });
    return _store.saveCard({ nameOnCard, cardNumber, expiryMonth, expiryYear, nickname });
  });

  ipcMain.handle(CH_CARD_LIST, () => {
    if (!_store) throw new Error('AutofillStore not initialised');
    mainLogger.info(CH_CARD_LIST);
    return _store.listCards();
  });

  ipcMain.handle(CH_CARD_REVEAL, async (_e, id: string) => {
    if (!_store) throw new Error('AutofillStore not initialised');
    const validId = assertString(id, 'id', 100);
    mainLogger.info(CH_CARD_REVEAL, { id: validId });
    await requireBiometric('reveal a saved payment card');
    return _store.revealCardNumber(validId);
  });

  ipcMain.handle(CH_CARD_UPDATE, async (_e, payload: {
    id: string;
    nameOnCard?: string;
    cardNumber?: string;
    expiryMonth?: string;
    expiryYear?: string;
    nickname?: string;
  }) => {
    if (!_store) throw new Error('AutofillStore not initialised');
    const id = assertString(payload?.id, 'id', 100);
    mainLogger.info(CH_CARD_UPDATE, { id });
    await requireBiometric('edit a saved payment card');
    const patch: {
      nameOnCard?: string;
      cardNumber?: string;
      expiryMonth?: string;
      expiryYear?: string;
      nickname?: string;
    } = {};
    if (payload.nameOnCard !== undefined)  patch.nameOnCard  = assertString(payload.nameOnCard,  'nameOnCard',  200);
    if (payload.cardNumber !== undefined)  patch.cardNumber  = assertString(payload.cardNumber,  'cardNumber',  25);
    if (payload.expiryMonth !== undefined) patch.expiryMonth = assertString(payload.expiryMonth, 'expiryMonth', 2);
    if (payload.expiryYear !== undefined)  patch.expiryYear  = assertString(payload.expiryYear,  'expiryYear',  4);
    if (payload.nickname !== undefined)    patch.nickname    = assertString(payload.nickname,    'nickname',    100);
    return _store.updateCard(id, patch);
  });

  ipcMain.handle(CH_CARD_DELETE, (_e, id: string) => {
    if (!_store) throw new Error('AutofillStore not initialised');
    const validId = assertString(id, 'id', 100);
    mainLogger.info(CH_CARD_DELETE, { id: validId });
    return _store.deleteCard(validId);
  });

  // ---------------------------------------------------------------------------
  // Batch clear
  // ---------------------------------------------------------------------------

  ipcMain.handle(CH_DELETE_ALL, () => {
    if (!_store) throw new Error('AutofillStore not initialised');
    mainLogger.info(CH_DELETE_ALL);
    _store.deleteAll();
  });

  mainLogger.info('autofill.ipc.register.ok', { channelCount: CHANNEL_COUNT });
}

export function unregisterAutofillHandlers(): void {
  mainLogger.info('autofill.ipc.unregister');
  ipcMain.removeHandler(CH_ADDR_SAVE);
  ipcMain.removeHandler(CH_ADDR_LIST);
  ipcMain.removeHandler(CH_ADDR_UPDATE);
  ipcMain.removeHandler(CH_ADDR_DELETE);
  ipcMain.removeHandler(CH_CARD_SAVE);
  ipcMain.removeHandler(CH_CARD_LIST);
  ipcMain.removeHandler(CH_CARD_REVEAL);
  ipcMain.removeHandler(CH_CARD_UPDATE);
  ipcMain.removeHandler(CH_CARD_DELETE);
  ipcMain.removeHandler(CH_DELETE_ALL);
  _store = null;
  mainLogger.info('autofill.ipc.unregister.ok');
}

/**
 * Called by ClearDataController when the user clears "autofill" data.
 * Exported so the privacy clear path can invoke it without going through IPC.
 */
export function clearAutofillData(): void {
  if (!_store) {
    mainLogger.warn('autofill.clearAutofillData.noStore');
    return;
  }
  _store.deleteAll();
  mainLogger.info('autofill.clearAutofillData.ok');
}
