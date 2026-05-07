import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const helpers = require('../../../src/main/hl/stock/helpers.js') as {
  browserHarnessCommand: () => string;
  connectSnippet: string;
};

describe('stock helpers browser-harness-js bridge', () => {
  test('points legacy helpers readers at the vendored browser-harness-js CLI', () => {
    expect(helpers.browserHarnessCommand()).toMatch(/browser-harness-js\/sdk\/browser-harness-js$/);
    expect(helpers.connectSnippet).toBe('await connectToAssignedTarget()');
  });
});
