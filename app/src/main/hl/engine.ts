/**
 * Engine selection — hardcoded to hl-inprocess (TypeScript agent).
 * The Python daemon path was removed.
 */

export type EngineId = 'hl-inprocess';

export function getEngine(): EngineId {
  return 'hl-inprocess';
}

export function setEngine(_engine: EngineId): void {
  // no-op
}
