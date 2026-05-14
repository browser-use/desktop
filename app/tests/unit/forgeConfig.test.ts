import path from 'node:path';
import { describe, expect, it } from 'vitest';
import forgeConfig from '../../forge.config';

function ignore(file: string): boolean {
  const fn = forgeConfig.packagerConfig?.ignore;
  if (typeof fn !== 'function') throw new Error('Expected packagerConfig.ignore to be a function');
  return fn(file);
}

describe('forge packager ignore', () => {
  it('keeps Vite output for both packager-relative and absolute file paths', () => {
    const appRoot = path.resolve(__dirname, '../..');

    expect(ignore('/.vite/build/main.js')).toBe(false);
    expect(ignore(path.join(appRoot, '.vite', 'build', 'main.js'))).toBe(false);
  });

  it('ignores non-Vite sources for both packager-relative and absolute file paths', () => {
    const appRoot = path.resolve(__dirname, '../..');

    expect(ignore('/src/main/index.ts')).toBe(true);
    expect(ignore(path.join(appRoot, 'src', 'main', 'index.ts'))).toBe(true);
  });
});
