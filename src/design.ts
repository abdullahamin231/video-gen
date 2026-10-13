/** Design tokens shared by the Remotion renderer. */
export const C = {
  bg: '#08090d',
  bgSoft: '#0e1016',
  panel: '#14171f',
  line: '#242936',
  text: '#f4f6fb',
  dim: '#8d95a8',
  faint: '#5a6175',
  good: '#22e08a',
  bad: '#ff4d6d',
  accent: '#59c2ff',
  gold: '#ffd166',
} as const;

export const FONT = {
  fontFamily:
    '"Inter", "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif',
  fontVariantNumeric: 'tabular-nums',
} as const;

export const toneColor = (t?: string) =>
  t === 'good'
    ? C.good
    : t === 'bad'
      ? C.bad
      : t === 'accent'
        ? C.accent
        : t === 'neutral'
          ? C.dim
          : C.gold;
