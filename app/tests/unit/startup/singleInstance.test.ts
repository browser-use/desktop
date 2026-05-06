import { describe, expect, it } from 'vitest';
import {
  compareAppVersions,
  createSingleInstanceLaunchData,
  parseSingleInstanceLaunchData,
  shouldHandoffToNewerInstance,
} from '../../../src/main/startup/singleInstance';

describe('single instance startup helpers', () => {
  it('round-trips launch metadata passed through Electron additionalData', () => {
    const data = createSingleInstanceLaunchData({
      version: '0.0.31',
      execPath: '/Applications/Browser Use.app/Contents/MacOS/Browser Use',
      argv: ['Browser Use', '--flag=value'],
      cwd: '/tmp',
      appPath: '/Applications/Browser Use.app/Contents/Resources/app.asar',
      pid: 1234,
      platform: 'darwin',
    });

    expect(parseSingleInstanceLaunchData(data)).toEqual(data);
  });

  it('rejects malformed launch metadata', () => {
    expect(parseSingleInstanceLaunchData(null)).toBeNull();
    expect(parseSingleInstanceLaunchData({ version: '0.0.31' })).toBeNull();
    expect(parseSingleInstanceLaunchData({
      version: '0.0.31',
      execPath: '/app',
      argv: ['Browser Use', 42],
      cwd: '/tmp',
      appPath: '/app/resources',
      pid: 1234,
      platform: 'darwin',
    })).toBeNull();
  });

  it('compares app versions with v prefixes and patch numbers', () => {
    expect(compareAppVersions('0.0.31', '0.0.30')).toBe(1);
    expect(compareAppVersions('v0.0.30', '0.0.30')).toBe(0);
    expect(compareAppVersions('0.1.0', '0.0.99')).toBe(1);
    expect(compareAppVersions('0.0.29', '0.0.30')).toBe(-1);
    expect(compareAppVersions('0.0.30-beta.1', '0.0.30')).toBe(-1);
    expect(compareAppVersions('0.0.31-beta.1', '0.0.30')).toBe(1);
    expect(compareAppVersions('0.0.30-beta.10', '0.0.30-beta.2')).toBe(1);
    expect(compareAppVersions('0.0.30-beta.2', '0.0.30-beta.10')).toBe(-1);
    expect(compareAppVersions('0.0.30-alpha.1', '0.0.30-alpha.beta')).toBe(-1);
    expect(compareAppVersions('0.0.30-beta.2', '0.0.30-beta')).toBe(1);
    expect(compareAppVersions('0.0.30+build.2', '0.0.30+build.1')).toBe(0);
  });

  it('only hands off when the second launch is newer', () => {
    const incoming = createSingleInstanceLaunchData({
      version: '0.0.31',
      execPath: '/new/Browser Use',
      argv: ['/new/Browser Use'],
      cwd: '/tmp',
      appPath: '/new/resources',
      pid: 1234,
      platform: 'darwin',
    });

    expect(shouldHandoffToNewerInstance('0.0.30', incoming)).toBe(true);
    expect(shouldHandoffToNewerInstance('0.0.31', incoming)).toBe(false);
    expect(shouldHandoffToNewerInstance('0.0.32', incoming)).toBe(false);
    expect(shouldHandoffToNewerInstance('0.0.30', null)).toBe(false);
  });
});
