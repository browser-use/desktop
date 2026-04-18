/**
 * Design system barrel export.
 *
 * Usage:
 *   import { tokens, SHELL_COLORS, ONBOARDING_COLORS, loadFonts } from '@/design'
 *   import '@/design/theme.global.css'
 *   import '@/design/theme.shell.css'      // or theme.onboarding.css
 *
 * Theme switching at runtime:
 *   document.documentElement.dataset.theme = 'shell'      // main app
 *   document.documentElement.dataset.theme = 'onboarding' // onboarding flow
 */

// Tokens
export {
  tokens,
  SPACING,
  RADII,
  DURATIONS,
  EASINGS,
  FONT_SIZES,
  LINE_HEIGHTS,
  FONT_WEIGHTS,
  SHELL_COLORS,
  ONBOARDING_COLORS,
  Z_INDEX,
} from './tokens';

export type {
  Tokens,
  SpacingKey,
  RadiusKey,
  DurationKey,
  EasingKey,
} from './tokens';

// Font loader
export { loadFonts, getFontStack, FONT_FAMILIES } from './fonts';
