import { app } from 'electron';
import { afterEach, describe, expect, it } from 'vitest';
import { allowMockBrowserCodeTests, mockTestResult } from '../../../src/main/settings/apiKeyIpc';

const originalNodeEnv = process.env.NODE_ENV;
const originalPackaged = app.isPackaged;

function setPackaged(value: boolean): void {
  Object.defineProperty(app, 'isPackaged', {
    value,
    configurable: true,
  });
}

describe('apiKeyIpc BrowserCode mock test gating', () => {
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    setPackaged(originalPackaged);
  });

  it('disables BrowserCode mock API key results in packaged production mode', () => {
    process.env.NODE_ENV = 'production';
    setPackaged(true);

    expect(allowMockBrowserCodeTests()).toBe(false);
    expect(mockTestResult('mock:ok')).toBeNull();
  });

  it('keeps BrowserCode mock API key results available in development mode', () => {
    process.env.NODE_ENV = 'development';
    setPackaged(true);

    expect(allowMockBrowserCodeTests()).toBe(true);
    expect(mockTestResult('mock:ok')).toEqual({ success: true });
  });
});
