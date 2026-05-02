import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const helpers = require('../../../src/main/hl/stock/helpers.js');

type CdpCall = { method: string; params: Record<string, unknown> };

function createMockContext() {
  const calls: CdpCall[] = [];
  const ctx = {
    cdp: {
      send: async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        if (method === 'Runtime.evaluate') return { result: { objectId: 'globalThisObject' } };
        if (method === 'Runtime.callFunctionOn') return { result: { value: true } };
        if (method === 'Runtime.releaseObject') return {};
        throw new Error(`unexpected CDP method: ${method}`);
      },
    },
  };
  return { ctx, calls };
}

describe('stock helpers CDP script calls', () => {
  test('reactSetValue passes selector and value as CDP arguments', async () => {
    const { ctx, calls } = createMockContext();
    const selector = 'input[name="q"]';
    const value = 'hello"; alert(1); //';

    await helpers.reactSetValue(ctx, selector, value);

    const call = calls.find((entry) => entry.method === 'Runtime.callFunctionOn');
    expect(call?.params.arguments).toEqual([{ value: selector }, { value }]);
    expect(call?.params.functionDeclaration).not.toContain(value);
    expect(calls.at(-1)).toEqual({
      method: 'Runtime.releaseObject',
      params: { objectId: 'globalThisObject' },
    });
  });

  test('dispatchKey passes keyboard data as CDP arguments', async () => {
    const { ctx, calls } = createMockContext();
    const selector = 'button[data-x="</script>"]';

    await helpers.dispatchKey(ctx, selector, 'Enter', 'keydown');

    const call = calls.find((entry) => entry.method === 'Runtime.callFunctionOn');
    expect(call?.params.arguments).toEqual([
      { value: selector },
      { value: 'Enter' },
      { value: 'keydown' },
      { value: 13 },
    ]);
    expect(call?.params.functionDeclaration).not.toContain(selector);
  });

  test('captureDialogs executes a static function with no interpolated arguments', async () => {
    const { ctx, calls } = createMockContext();

    await helpers.captureDialogs(ctx);

    const call = calls.find((entry) => entry.method === 'Runtime.callFunctionOn');
    expect(call?.params.arguments).toEqual([]);
    expect(call?.params.functionDeclaration).toContain('window.__dialogs__');
  });
});
