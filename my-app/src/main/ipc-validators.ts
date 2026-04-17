/**
 * ipc-validators.ts — runtime input validators for IPC handlers.
 *
 * Keeps validation logic separate from handler implementations so it
 * can be unit-tested independently.
 */

export function assertString(value: unknown, field: string, max = 10000): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  if (value.length > max) throw new Error(`${field} exceeds ${max} chars`);
  return value;
}

export function assertOneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}
