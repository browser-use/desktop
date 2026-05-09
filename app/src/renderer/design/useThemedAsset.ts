/*
 * useThemedAsset — returns the asset variant matching the resolved theme.
 * Centralizes the dark/light asset switch so individual components don't
 * each subscribe to themeMode.
 */

import { useThemeMode } from './useThemeMode';

export function useThemedAsset<T>(dark: T, light: T): T {
  const { resolved } = useThemeMode();
  return resolved === 'light' ? light : dark;
}
