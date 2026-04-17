/**
 * Skeleton.tsx — reusable loading skeleton with shimmer animation.
 *
 * Props:
 *   width    — CSS value (px, %, rem, etc.) or number (treated as px)
 *   height   — CSS value or number (px)
 *   radius   — CSS border-radius value or keyof RADII tokens
 *   variant  — 'rect' | 'text' | 'circle'
 *
 * Shimmer animation respects prefers-reduced-motion — collapses to static
 * muted block when motion is reduced.
 *
 * Export: also exported from base/index.ts barrel.
 * No !important, no Inter font references.
 */

import React, { forwardRef, HTMLAttributes, CSSProperties } from 'react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BLOCK = 'agb-skeleton' as const;

// Default dimensions per variant
const VARIANT_DEFAULTS = {
  rect:   { width: '100%', height: '16px', radius: '5px' },
  text:   { width: '80%',  height: '12px', radius: '3px' },
  circle: { width: '40px', height: '40px', radius: '9999px' },
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkeletonVariant = 'rect' | 'text' | 'circle';

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  /** Width — number treated as px string, string passed through as-is. */
  width?: number | string;
  /** Height — number treated as px string, string passed through as-is. */
  height?: number | string;
  /** Border radius — number treated as px, string passed through. */
  radius?: number | string;
  /** Shape variant. Defaults to 'rect'. */
  variant?: SkeletonVariant;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPxString(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return `${value}px`;
  return value;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Skeleton = forwardRef<HTMLSpanElement, SkeletonProps>(
  function Skeleton(
    {
      width,
      height,
      radius,
      variant = 'rect',
      className = '',
      style,
      ...rest
    },
    ref,
  ) {
    const defaults = VARIANT_DEFAULTS[variant];

    const computedStyle: CSSProperties = {
      width:        toPxString(width)  ?? defaults.width,
      height:       toPxString(height) ?? defaults.height,
      borderRadius: toPxString(radius) ?? defaults.radius,
      display:      'block',
      ...style,
    };

    const classes = [BLOCK, `${BLOCK}--${variant}`, className]
      .filter(Boolean)
      .join(' ');

    return (
      <span
        ref={ref}
        className={classes}
        style={computedStyle}
        aria-hidden="true"
        {...rest}
      />
    );
  },
);

Skeleton.displayName = 'Skeleton';

export default Skeleton;
