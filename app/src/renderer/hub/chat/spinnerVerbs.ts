import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Cycling "Working" verb shown next to the spinner while an agent is busy.
 * Inspired by jaehongpark-agent/claude-code-spinner-verbs - playful gerunds
 * that rotate every few seconds so a long-running task feels alive instead
 * of stuck on one word.
 *
 * All presets are pure data - add a new key to PRESETS and it appears in
 * Settings automatically. The "custom" key is reserved for the user's own
 * list, edited via SettingsPane.
 */

export type SpinnerPresetId =
  | 'classic'
  | 'playful'
  | 'cafe'
  | 'wizard'
  | 'lab'
  | 'cosmic'
  | 'forge'
  | 'custom';

export interface SpinnerPreset {
  label: string;
  description: string;
  verbs: ReadonlyArray<string>;
}

export const PRESETS: Readonly<Record<Exclude<SpinnerPresetId, 'custom'>, SpinnerPreset>> = {
  classic: {
    label: 'Classic',
    description: 'Just "Working".',
    verbs: ['Working'],
  },
  playful: {
    label: 'Playful',
    description: 'Whimsical gerunds that rotate while the agent runs.',
    verbs: [
      'Brewing',
      'Pondering',
      'Conjuring',
      'Whisking',
      'Forging',
      'Hatching',
      'Tinkering',
      'Simmering',
      'Wrangling',
      'Spelunking',
      'Noodling',
      'Marinating',
      'Untangling',
      'Percolating',
      'Doodling',
    ],
  },
  cafe: {
    label: 'Cafe',
    description: 'Espresso bar vibes.',
    verbs: ['Brewing', 'Steeping', 'Frothing', 'Pressing', 'Drizzling', 'Whisking', 'Pouring', 'Tamping', 'Grinding'],
  },
  wizard: {
    label: 'Wizard',
    description: 'Arcane and overconfident.',
    verbs: ['Conjuring', 'Enchanting', 'Divining', 'Scrying', 'Summoning', 'Incanting', 'Bewitching', 'Channeling'],
  },
  lab: {
    label: 'Lab',
    description: 'Lab-coat earnest.',
    verbs: ['Calibrating', 'Synthesizing', 'Analyzing', 'Hypothesizing', 'Computing', 'Modelling', 'Refining', 'Measuring'],
  },
  cosmic: {
    label: 'Cosmic',
    description: 'Space-opera dramatic.',
    verbs: ['Orbiting', 'Warping', 'Aligning', 'Charting', 'Navigating', 'Stargazing', 'Refracting', 'Drifting'],
  },
  forge: {
    label: 'Forge',
    description: 'Hammer-and-anvil verbs.',
    verbs: ['Forging', 'Hammering', 'Tempering', 'Quenching', 'Smelting', 'Annealing', 'Shaping', 'Polishing'],
  },
};

export const DEFAULT_CUSTOM_VERBS: ReadonlyArray<string> = [
  'Working',
  'Thinking',
  'Cooking',
];

export const MIN_CYCLE_MS = 600;
export const MAX_CYCLE_MS = 8000;
export const DEFAULT_CYCLE_MS = 2200;

interface SpinnerVerbsState {
  presetId: SpinnerPresetId;
  customVerbs: string[];
  cycleMs: number;
  setPreset: (id: SpinnerPresetId) => void;
  setCustomVerbs: (verbs: string[]) => void;
  setCycleMs: (ms: number) => void;
}

export const useSpinnerVerbsStore = create<SpinnerVerbsState>()(
  persist(
    (set) => ({
      presetId: 'playful',
      customVerbs: [...DEFAULT_CUSTOM_VERBS],
      cycleMs: DEFAULT_CYCLE_MS,
      setPreset: (id) => set(() => {
        console.log('[spinnerVerbs] setPreset', { id });
        return { presetId: id };
      }),
      setCustomVerbs: (verbs) => set(() => {
        const cleaned = verbs.map((v) => v.trim()).filter(Boolean);
        console.log('[spinnerVerbs] setCustomVerbs', { count: cleaned.length });
        return { customVerbs: cleaned };
      }),
      setCycleMs: (ms) => set(() => {
        const clamped = Math.max(MIN_CYCLE_MS, Math.min(MAX_CYCLE_MS, Math.round(ms)));
        console.log('[spinnerVerbs] setCycleMs', { ms: clamped });
        return { cycleMs: clamped };
      }),
    }),
    {
      name: 'hub-spinner-verbs',
    },
  ),
);

/** Resolve the active verb list. Falls back to ['Working'] if custom is empty. */
export function selectActiveVerbs(state: SpinnerVerbsState): ReadonlyArray<string> {
  if (state.presetId === 'custom') {
    return state.customVerbs.length > 0 ? state.customVerbs : ['Working'];
  }
  return PRESETS[state.presetId].verbs;
}

/**
 * Hook: returns a verb from the active list, rotating every `cycleMs`.
 * Re-runs only on store changes and on the interval tick, so it's safe to
 * call from any number of `<ChatThinking>`-style indicators.
 *
 * The starting index is randomized per mount so re-opening a session doesn't
 * always show the same first word, but the rotation order is stable for the
 * lifetime of the indicator.
 */
export function useCyclingVerb(): string {
  const presetId = useSpinnerVerbsStore((s) => s.presetId);
  const customVerbs = useSpinnerVerbsStore((s) => s.customVerbs);
  const cycleMs = useSpinnerVerbsStore((s) => s.cycleMs);

  const verbs = (() => {
    if (presetId === 'custom') return customVerbs.length > 0 ? customVerbs : ['Working'];
    return PRESETS[presetId].verbs;
  })();

  const [idx, setIdx] = useState(() => Math.floor(Math.random() * Math.max(1, verbs.length)));

  // Reset index when the active list changes (preset switch / custom edit)
  // so we don't land on a stale out-of-range slot for a frame.
  useEffect(() => {
    setIdx((prev) => (verbs.length === 0 ? 0 : prev % verbs.length));
  }, [verbs]);

  useEffect(() => {
    if (verbs.length <= 1) return;
    const id = window.setInterval(() => {
      setIdx((prev) => (prev + 1) % verbs.length);
    }, cycleMs);
    return () => window.clearInterval(id);
  }, [verbs, cycleMs]);

  return verbs[idx] ?? 'Working';
}
