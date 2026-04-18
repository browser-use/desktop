/**
 * ContentCategoryStore — persistent global and per-site toggles for content
 * categories (sound, images, JavaScript, pop-ups, intrusive ads, automatic
 * downloads, protected content, clipboard).
 *
 * Follows the PermissionStore/BookmarkStore pattern: debounced atomic writes
 * to userData/content-categories.json (300ms).
 *
 * Global defaults map each category to 'allow' | 'block' | 'ask'.
 * Per-site overrides are keyed by origin + category.
 */

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { mainLogger } from '../logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FILE_NAME = 'content-categories.json';
const DEBOUNCE_MS = 300;
const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CategoryState = 'allow' | 'block' | 'ask';

export type ContentCategory =
  | 'sound'
  | 'images'
  | 'javascript'
  | 'popups'
  | 'ads'
  | 'automatic-downloads'
  | 'protected-content'
  | 'clipboard-read'
  | 'clipboard-write';

export interface SiteCategoryOverride {
  origin: string;
  category: ContentCategory;
  state: CategoryState;
  updatedAt: number;
}

export interface PersistedCategories {
  version: typeof SCHEMA_VERSION;
  defaults: Record<ContentCategory, CategoryState>;
  overrides: SiteCategoryOverride[];
}

// ---------------------------------------------------------------------------
// Default states (Chrome-parity)
// ---------------------------------------------------------------------------

const DEFAULT_CATEGORY_STATES: Record<ContentCategory, CategoryState> = {
  sound:                'allow',
  images:               'allow',
  javascript:           'allow',
  popups:               'block',
  ads:                  'block',
  'automatic-downloads': 'ask',
  'protected-content':   'allow',
  'clipboard-read':      'ask',
  'clipboard-write':     'allow',
};

function makeEmpty(): PersistedCategories {
  return {
    version: SCHEMA_VERSION,
    defaults: { ...DEFAULT_CATEGORY_STATES },
    overrides: [],
  };
}

// ---------------------------------------------------------------------------
// Store class
// ---------------------------------------------------------------------------

export class ContentCategoryStore {
  private readonly filePath: string;
  private state: PersistedCategories;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(dataDir?: string) {
    this.filePath = path.join(dataDir ?? app.getPath('userData'), FILE_NAME);
    mainLogger.info('ContentCategoryStore.constructor', { filePath: this.filePath });
    this.state = this.load();
    mainLogger.info('ContentCategoryStore.init', {
      overrideCount: this.state.overrides.length,
    });
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private load(): PersistedCategories {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedCategories;
      if (parsed.version !== SCHEMA_VERSION || !Array.isArray(parsed.overrides)) {
        mainLogger.warn('ContentCategoryStore.load.invalid', { msg: 'Resetting content-categories' });
        return makeEmpty();
      }
      // Back-fill any missing defaults added after initial schema
      for (const [cat, state] of Object.entries(DEFAULT_CATEGORY_STATES) as Array<[ContentCategory, CategoryState]>) {
        if (!(cat in parsed.defaults)) {
          parsed.defaults[cat] = state;
        }
      }
      mainLogger.info('ContentCategoryStore.load.ok', { overrideCount: parsed.overrides.length });
      return parsed;
    } catch {
      mainLogger.info('ContentCategoryStore.load.fresh', { msg: 'No content-categories.json — starting fresh' });
      return makeEmpty();
    }
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flushSync(), DEBOUNCE_MS);
  }

  flushSync(): void {
    if (!this.dirty) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8');
      mainLogger.info('ContentCategoryStore.flushSync.ok');
    } catch (err) {
      mainLogger.error('ContentCategoryStore.flushSync.failed', { error: (err as Error).message });
    }
    this.dirty = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Global defaults
  // -------------------------------------------------------------------------

  getDefault(category: ContentCategory): CategoryState {
    return this.state.defaults[category] ?? DEFAULT_CATEGORY_STATES[category];
  }

  getDefaults(): Record<ContentCategory, CategoryState> {
    return { ...this.state.defaults };
  }

  setDefault(category: ContentCategory, state: CategoryState): void {
    this.state.defaults[category] = state;
    mainLogger.info('ContentCategoryStore.setDefault', { category, state });
    this.schedulePersist();
  }

  // -------------------------------------------------------------------------
  // Per-site overrides
  // -------------------------------------------------------------------------

  getSiteOverride(origin: string, category: ContentCategory): CategoryState {
    const record = this.state.overrides.find(
      (r) => r.origin === origin && r.category === category,
    );
    if (record) return record.state;
    return this.getDefault(category);
  }

  setSiteOverride(origin: string, category: ContentCategory, state: CategoryState): void {
    const existing = this.state.overrides.find(
      (r) => r.origin === origin && r.category === category,
    );
    if (existing) {
      existing.state = state;
      existing.updatedAt = Date.now();
    } else {
      this.state.overrides.push({ origin, category, state, updatedAt: Date.now() });
    }
    mainLogger.info('ContentCategoryStore.setSiteOverride', { origin, category, state });
    this.schedulePersist();
  }

  removeSiteOverride(origin: string, category: ContentCategory): boolean {
    const before = this.state.overrides.length;
    this.state.overrides = this.state.overrides.filter(
      (r) => !(r.origin === origin && r.category === category),
    );
    if (this.state.overrides.length < before) {
      mainLogger.info('ContentCategoryStore.removeSiteOverride', { origin, category });
      this.schedulePersist();
      return true;
    }
    return false;
  }

  getOverridesForOrigin(origin: string): SiteCategoryOverride[] {
    return this.state.overrides.filter((r) => r.origin === origin);
  }

  getAllOverrides(): SiteCategoryOverride[] {
    return [...this.state.overrides];
  }

  clearOrigin(origin: string): void {
    this.state.overrides = this.state.overrides.filter((r) => r.origin !== origin);
    mainLogger.info('ContentCategoryStore.clearOrigin', { origin });
    this.schedulePersist();
  }

  resetAllOverrides(): void {
    this.state.overrides = [];
    mainLogger.info('ContentCategoryStore.resetAllOverrides');
    this.schedulePersist();
  }
}
