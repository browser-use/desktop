/**
 * Engine adapter registry. Adapters self-register at module load time so
 * adding a new engine is a single import + `register()` call — no central
 * switch/enum to edit.
 */

import { mainLogger } from '../../logger';
import type { EngineAdapter } from './types';

const adapters = new Map<string, EngineAdapter>();

export function register(adapter: EngineAdapter): void {
  if (adapters.has(adapter.id)) {
    mainLogger.warn('engines.registry.duplicateId', { id: adapter.id });
    return;
  }
  adapters.set(adapter.id, adapter);
  mainLogger.info('engines.registry.register', { id: adapter.id, displayName: adapter.displayName });
}

export function get(id: string): EngineAdapter | undefined {
  return adapters.get(id);
}

export function list(): EngineAdapter[] {
  return Array.from(adapters.values());
}

/** Preferred default when a session has no engine set. */
export const DEFAULT_ENGINE_ID = 'claude-code';
