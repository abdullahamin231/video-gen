/**
 * Bonkers animation toolkit — pure functions of time/frame.
 * Everything deterministic: no Math.random / Date.now at render time.
 */

export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number) => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) =>
  b === a ? 0 : (v - a) / (b - a);

/** Map v from [in0,in1] to [out0,out1], clamped. */
export const map = (
  v: number,
  in0: number,
  in1: number,
  out0: number,
  out1: number,
) => lerp(out0, out1, clamp01(invLerp(in0, in1, v)));

/* ---------------------------------------------------------------- *
 * Easings                                                           *
 * ---------------------------------------------------------------- */
export const E = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => t * (2 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  inQuart: (t: number) => t * t * t * t,
  outQuart: (t: number) => 1 - Math.pow(1 - t, 4),
  inOutQuart: (t: number) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  // Aggressive expo — snaps then eases out long tail. Great for counters.
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inExpo: (t: number) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  inOutExpo: (t: number) =>
    t <= 0
      ? 0
      : t >= 1
        ? 1
        : t < 0.5
          ? Math.pow(2, 20 * t - 10) / 2
          : (2 - Math.pow(2, -20 * t + 10)) / 2,
  // Overshoot — springs past target then settles. "Slam + settle".
  outBack: (t: number, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  outBackSoft: (t: number) => E.outBack(t, 1.1),
  outBackHeavy: (t: number) => E.outBack(t, 2.6),
  inBack: (t: number, s = 1.70158) => (s + 1) * t * t * t - s * t * t,
  // Elastic — big bounce snap-back.
  outElastic: (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  outBounce: (t: number) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

/** Normalized 0..1 progress over a frame window with easing. */
export const prog = (frame: number, start: number, dur: number, ease = E.outCubic) =>
  ease(clamp01((frame - start) / Math.max(1, dur)));

/* ---------------------------------------------------------------- *
 * Springs (physics-ish, deterministic, overshoot-capable)          *
 * ---------------------------------------------------------------- */
/**
 * Damped harmonic spring evaluated in closed form.
 * Returns 0..~1 with overshoot depending on damping.
 * `freq` = oscillations over the settle window, `damp` = decay (higher = less bounce).
 */
export const springAt = (
  t: number,
  {freq = 3.2, damp = 5.5}: {freq?: number; damp?: number} = {},
) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const env = Math.exp(-damp * t);
  return 1 - env * Math.cos(freq * Math.PI * t);
};

/** Snappy spring with mild overshoot — entrances. */
export const slam = (t: number) => springAt(t, {freq: 2.4, damp: 6.5});
/** Bouncy spring — playful elements. */
export const bounceIn = (t: number) => springAt(t, {freq: 3.6, damp: 4.2});
/** Heavy overshoot — big impacts settle. */
export const thud = (t: number) => springAt(t, {freq: 1.7, damp: 8.5});

/* ---------------------------------------------------------------- *
 * Deterministic pseudo-random & noise                               *
 * ---------------------------------------------------------------- */
/** Hash-based PRNG → 0..1 from an integer seed. */
export const rand = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** Signed -1..1. */
export const srand = (i: number) => rand(i) * 2 - 1;

/** Smooth 1D value noise over time for a given seed → -1..1. */
export const noise1 = (seed: number, t: number) => {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f); // smoothstep
  return lerp(srand(seed * 1000 + i), srand(seed * 1000 + i + 1), u);
};
/** Fractal noise (2 octaves) → -1..1. */
export const fbm1 = (seed: number, t: number) =>
  noise1(seed, t) * 0.66 + noise1(seed + 7, t * 2.1) * 0.34;

/* ---------------------------------------------------------------- *
 * Idle motion — the anti-"everything holds still" helpers          *
 * ---------------------------------------------------------------- */
/** Continuous sine drift. amplitude in px, period in frames. */
export const drift = (frame: number, amp: number, period: number, phase = 0) =>
  Math.sin((frame / period) * Math.PI * 2 + phase) * amp;
/** Two-axis organic drift using noise. */
export const float2 = (
  frame: number,
  ax: number,
  ay: number,
  px: number,
  py: number,
  seed = 0,
) => ({
  x: fbm1(seed + 1, frame / px) * ax,
  y: fbm1(seed + 2, frame / py) * ay,
});
/** Breathing scale oscillation around 1. */
export const breathe = (frame: number, amount = 0.02, period = 90, phase = 0) =>
  1 + Math.sin((frame / period) * Math.PI * 2 + phase) * amount;
/** Gentle rotation wobble in degrees. */
export const wobble = (frame: number, amount = 2, period = 120, phase = 0) =>
  Math.sin((frame / period) * Math.PI * 2 + phase) * amount;

/* ---------------------------------------------------------------- *
 * Impacts & shakes                                                  *
 * ---------------------------------------------------------------- */
/** Decaying shake offset. `strength` px, decays over `dur` frames. */
export const impact = (
  frame: number,
  at: number,
  strength: number,
  dur = 18,
  seed = 0,
) => {
  const t = (frame - at) / dur;
  if (t < 0 || t > 1) return {x: 0, y: 0, rot: 0};
  const decay = Math.exp(-4.5 * t) * (1 - t);
  return {
    x: srand(seed + 1) * strength * decay * Math.cos(t * 42),
    y: srand(seed + 2) * strength * decay * Math.sin(t * 37),
    rot: srand(seed + 3) * strength * 0.06 * decay * Math.sin(t * 30),
  };
};

/* ---------------------------------------------------------------- *
 * Scramble / decrypt text                                           *
 * ---------------------------------------------------------------- */
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=/<>?';
/**
 * Per-character reveal with scramble. Characters before `reveal` (0..len)
 * are settled; near the frontier they show random glyphs; after → hidden.
 */
export const scrambleChar = (
  ch: string,
  index: number,
  frame: number,
  start: number,
  perChar: number,
  seed = 0,
) => {
  if (ch === ' ') return ' ';
  const local = frame - start - index * perChar;
  if (local >= 6) return ch; // settled
  if (local < 0) return ''; // not yet
  const g = Math.floor(rand(seed * 97 + index * 13 + Math.floor(frame / 2)) * GLYPHS.length);
  return GLYPHS[g];
};
