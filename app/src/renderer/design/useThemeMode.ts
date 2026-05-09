/*
 * useThemeMode — React hook around themeMode.ts.
 *
 * Returns [mode, setMode, resolved]. Components subscribe so the UI
 * stays in sync with cross-tab updates and OS-level "system" flips.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  getThemeMode,
  resolveThemeMode,
  setThemeMode,
  subscribeThemeMode,
  type ResolvedThemeMode,
  type ThemeMode,
} from './themeMode';

export function useThemeMode(): {
  mode: ThemeMode;
  resolved: ResolvedThemeMode;
  setMode: (mode: ThemeMode) => void;
} {
  const [mode, setModeState] = useState<ThemeMode>(() => getThemeMode());
  const [resolved, setResolvedState] = useState<ResolvedThemeMode>(() => resolveThemeMode(getThemeMode()));

  useEffect(() => {
    return subscribeThemeMode((nextMode, nextResolved) => {
      setModeState(nextMode);
      setResolvedState(nextResolved);
    });
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    const nextResolved = setThemeMode(next);
    setModeState(next);
    setResolvedState(nextResolved);
  }, []);

  return { mode, setMode, resolved };
}
