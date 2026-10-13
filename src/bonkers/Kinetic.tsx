import React from 'react';
import {clamp01, E, rand, scrambleChar, springAt, breathe, srand} from './ease';

const MONO = '"Space Mono", "JetBrains Mono", ui-monospace, monospace';
const DISPLAY = '"Archivo Black", "Anton", "Inter", system-ui, sans-serif';

/* ---------------------------------------------------------------- *
 * Per-character kinetic reveal. Nothing fades in as a block.        *
 * Each glyph rises from a mask with overshoot + keeps idle motion.  *
 * ---------------------------------------------------------------- */
export const Kinetic: React.FC<{
  text: string;
  frame: number;
  start: number;
  perChar?: number; // frames between chars
  size?: number;
  color?: string;
  weight?: number;
  font?: string;
  letterSpacing?: string;
  effect?: 'rise' | 'drop' | 'flip' | 'stretch' | 'scale';
  idle?: number; // idle wobble amplitude px
  seed?: number;
  skew?: number;
  lineHeight?: number;
  style?: React.CSSProperties;
  align?: string;
}> = ({
  text,
  frame,
  start,
  perChar = 2.2,
  size = 90,
  color = '#fff',
  weight = 900,
  font = DISPLAY,
  letterSpacing = '-0.02em',
  effect = 'rise',
  idle = 2.5,
  seed = 0,
  skew = 0,
  lineHeight = 1.0,
  style,
  align = 'left',
}) => {
  const words = text.split(' ');
  let idx = 0;
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
        justifyContent: align === 'center' ? 'center' : 'flex-start',
        gap: '0 0.28em',
        fontFamily: font,
        fontWeight: weight,
        fontSize: size,
        letterSpacing,
        color,
        lineHeight,
        ...style,
      }}
    >
      {words.map((word, wi) => (
        <div key={wi} style={{display: 'inline-flex', whiteSpace: 'nowrap'}}>
          {word.split('').map((ch, ci) => {
            const i = idx++;
            const t = clamp01((frame - start - i * perChar) / 9);
            const s = springAt(t, {freq: 2.3, damp: 7});
            // per-char idle so glyphs never sit still
            const iw = Math.sin(frame * 0.07 + i * 0.9) * idle;
            let transform = '';
            let opacity = clamp01(t * 3);
            if (effect === 'rise') transform = `translateY(${(1 - s) * 100}%) translateY(${iw}px)`;
            else if (effect === 'drop') transform = `translateY(${-(1 - s) * 120}%) translateY(${iw}px)`;
            else if (effect === 'flip')
              transform = `perspective(600px) rotateX(${(1 - s) * -92}deg) translateY(${iw}px)`;
            else if (effect === 'stretch')
              transform = `scaleY(${0.1 + s * 0.9}) scaleX(${1.6 - s * 0.6}) translateY(${iw}px)`;
            else transform = `scale(${0.2 + s * 0.8}) translateY(${iw}px)`;
            return (
              <span
                key={ci}
                style={{
                  display: 'inline-block',
                  transform: `${transform} skewX(${skew}deg)`,
                  transformOrigin: 'bottom center',
                  opacity,
                }}
              >
                {ch}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

/* ---------------------------------------------------------------- *
 * Scramble / decrypt reveal                                        *
 * ---------------------------------------------------------------- */
export const Scramble: React.FC<{
  text: string;
  frame: number;
  start: number;
  perChar?: number;
  size?: number;
  color?: string;
  font?: string;
  weight?: number;
  style?: React.CSSProperties;
}> = ({text, frame, start, perChar = 1.6, size = 46, color = '#22e08a', font = MONO, weight = 700, style}) => (
  <span style={{fontFamily: font, fontSize: size, color, fontWeight: weight, letterSpacing: '0.02em', ...style}}>
    {text.split('').map((ch, i) => (
      <span key={i}>{scrambleChar(ch, i, frame, start, perChar)}</span>
    ))}
  </span>
);

/* ---------------------------------------------------------------- *
 * Single word that SLAMS in with overshoot + impact, then breathes *
 * ---------------------------------------------------------------- */
export const SlamWord: React.FC<{
  text: string;
  frame: number;
  start: number;
  size?: number;
  color?: string;
  bg?: string;
  font?: number;
  pad?: string;
  rotate?: number;
  seed?: number;
  style?: React.CSSProperties;
}> = ({text, frame, start, size = 120, color = '#0a0a0a', bg = '#ffd166', pad = '0.05em 0.28em', rotate = -3, seed = 0, style}) => {
  const t = clamp01((frame - start) / 12);
  const s = springAt(t, {freq: 1.8, damp: 8.5}); // heavy overshoot
  const idleRot = rotate + Math.sin(frame * 0.05 + seed) * 1.2;
  const sc = 0.4 + s * 0.6;
  return (
    <span
      style={{
        display: 'inline-block',
        background: bg,
        color,
        fontFamily: DISPLAY,
        fontWeight: 900,
        fontSize: size,
        padding: pad,
        lineHeight: 1,
        transform: `rotate(${idleRot}deg) scale(${sc})`,
        opacity: clamp01(t * 4),
        boxShadow: `0 0 ${40 * s}px ${bg}66`,
        ...style,
      }}
    >
      {text}
    </span>
  );
};

/* ---------------------------------------------------------------- *
 * Uppercase kicker label with letter-spacing reveal + underline    *
 * ---------------------------------------------------------------- */
export const Kicker: React.FC<{
  text: string;
  frame: number;
  start: number;
  color?: string;
  size?: number;
}> = ({text, frame, start, color = '#59c2ff', size = 24}) => {
  const t = clamp01((frame - start) / 14);
  const s = E.outExpo(t);
  return (
    <div style={{display: 'inline-flex', alignItems: 'center', gap: 18, fontFamily: MONO, fontSize: size, fontWeight: 700, color, letterSpacing: '0.35em', textTransform: 'uppercase'}}>
      <span style={{width: 20 + s * 46, height: 3, background: color, boxShadow: `0 0 12px ${color}`}} />
      <span style={{opacity: clamp01((frame - start) / 5), transform: `translateX(${(1 - s) * -14}px)`, display: 'inline-block'}}>
        {text.split('').map((c, i) => (
          <span key={i} style={{display: 'inline-block', transform: `translateY(${Math.sin(frame * 0.08 + i) * 1.4}px)`}}>
            {c}
          </span>
        ))}
      </span>
    </div>
  );
};

/* ---------------------------------------------------------------- *
 * Rapid count-up number with aggressive easing + tail              *
 * ---------------------------------------------------------------- */
export const CountUp: React.FC<{
  to: number;
  frame: number;
  start: number;
  dur?: number;
  prefix?: string;
  suffix?: string;
  size?: number;
  color?: string;
  pad?: number;
  decimals?: number;
}> = ({to, frame, start, dur = 26, prefix = '', suffix = '', size = 80, color = '#ff4d6d', pad = 0, decimals = 0}) => {
  const t = clamp01((frame - start) / dur);
  const e = E.outExpo(t);
  const v = to * e;
  const txt = decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString('en-US');
  const jitter = t < 0.85 ? srand(Math.floor(frame * 3)) * (1 - t) * 2 : 0;
  return (
    <span style={{fontFamily: DISPLAY, fontWeight: 900, fontSize: size, color, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em', display: 'inline-block', transform: `translateY(${jitter}px)`}}>
      {prefix}
      {txt.padStart(pad, '0')}
      {suffix}
    </span>
  );
};
