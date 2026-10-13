import React from 'react';
import {AbsoluteFill} from 'remotion';
import {clamp01, E, springAt, drift, wobble, rand, srand, breathe, map} from './ease';
import {Kinetic, SlamWord} from './Kinetic';
import {DISPLAY, MONO, UI} from './Bits1';
import {F, SCENE_CUT} from './beats';

/* ---------------------------------------------------------------- *
 * Zoom-through transition (blur + light-leak flash + chroma split) *
 * ---------------------------------------------------------------- */
export const zoomBlur = (frame: number) => {
  const cut = F(SCENE_CUT);
  const d = frame - cut;
  const g = Math.exp(-(d * d) / 90); // gaussian around the cut
  return {
    blur: g * 26,
    flash: Math.pow(g, 0.7),
    scale: 1 + g * 0.18,
    chroma: g * 12,
  };
};

export const TransitionFX: React.FC<{frame: number}> = ({frame}) => {
  const {flash, chroma} = zoomBlur(frame);
  if (flash < 0.01) return null;
  const hue = (frame * 8) % 360;
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {/* light-leak flash */}
      <AbsoluteFill style={{background: `radial-gradient(circle at 50% 50%, hsla(${hue},100%,85%,${flash * 0.9}) 0%, hsla(${(hue + 60) % 360},100%,60%,${flash * 0.5}) 35%, transparent 75%)`, mixBlendMode: 'screen'}} />
      {/* chromatic glitch bars */}
      {chroma > 1 ? (
        <AbsoluteFill style={{mixBlendMode: 'screen', opacity: flash}}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{position: 'absolute', left: 0, right: 0, top: (rand(frame * 3 + i) * 1080) | 0, height: 6 + rand(frame + i) * 40, background: i % 2 ? `rgba(255,0,80,0.4)` : `rgba(0,255,220,0.4)`, transform: `translateX(${srand(frame + i) * chroma}px)`}} />
          ))}
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- *
 * Glitch overlay (used at brain-stop / impacts) — RGB split        *
 * ---------------------------------------------------------------- */
export const Glitch: React.FC<{frame: number; intensity: number}> = ({frame, intensity}) => {
  if (intensity <= 0.01) return null;
  return (
    <AbsoluteFill style={{pointerEvents: 'none', mixBlendMode: 'screen', opacity: intensity}}>
      {[-1, 1].map((s) => (
        <AbsoluteFill key={s} style={{background: s < 0 ? 'rgba(255,0,60,0.12)' : 'rgba(0,255,220,0.12)', transform: `translateX(${s * intensity * 8}px)`}} />
      ))}
      {Array.from({length: 6}).map((_, i) => (
        <div key={i} style={{position: 'absolute', left: 0, right: 0, top: rand(frame * 2 + i) * 1080, height: 2 + rand(frame + i * 7) * 14, background: 'rgba(255,255,255,0.15)', transform: `translateX(${srand(frame * 5 + i) * 30 * intensity}px)`}} />
      ))}
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- *
 * Intro title — kinetic hook over the first ~2s                    *
 * ---------------------------------------------------------------- */
export const IntroTitle: React.FC<{frame: number}> = ({frame}) => {
  const out = clamp01((frame - F(1.7)) / 8);
  if (out >= 1) return null;
  const zoom = 1 + E.inQuad(clamp01(frame / 50)) * 0.5;
  return (
    <AbsoluteFill style={{pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 1 - out, transform: `scale(${zoom})`}}>
      <div style={{textAlign: 'center'}}>
        <div style={{overflow: 'hidden'}}>
          <Kinetic text="CAN A 9-YEAR-OLD GPU" frame={frame} start={F(0.15)} perChar={1.6} size={104} color="#f4f6fb" effect="rise" idle={3} align="center" />
        </div>
        <div style={{marginTop: 6}}>
          <Kinetic text="BEAT TODAY'S BEST?" frame={frame} start={F(0.55)} perChar={1.6} size={104} color="#ffd166" effect="rise" idle={3} align="center" />
        </div>
        {/* underline sweep */}
        <div style={{height: 6, background: 'linear-gradient(90deg,#59c2ff,#ff4d6d)', width: `${E.outExpo(clamp01((frame - F(0.9)) / 14)) * 70}%`, margin: '18px auto 0', boxShadow: '0 0 20px #59c2ff'}} />
      </div>
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- *
 * Chrome — persistent HUD, always in motion                        *
 * ---------------------------------------------------------------- */
const fmt = (frame: number) => {
  const s = Math.floor(frame / 30);
  const ff = Math.floor(frame % 30);
  return `00:${String(s).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
};

export const Chrome: React.FC<{frame: number; duration: number}> = ({frame, duration}) => {
  const isS1 = frame < F(SCENE_CUT);
  const recBlink = Math.floor(frame / 10) % 2 === 0;
  return (
    <AbsoluteFill style={{pointerEvents: 'none', fontFamily: MONO}}>
      {/* top-left: REC + timecode */}
      <div style={{position: 'absolute', top: 34, left: 44, display: 'flex', alignItems: 'center', gap: 14}}>
        <span style={{width: 14, height: 14, borderRadius: 8, background: recBlink ? '#ff4d6d' : '#4a1520', boxShadow: recBlink ? '0 0 12px #ff4d6d' : 'none'}} />
        <span style={{fontSize: 22, color: '#f4f6fb', letterSpacing: '0.14em', fontVariantNumeric: 'tabular-nums'}}>{fmt(frame)}</span>
        <span style={{fontSize: 16, color: '#8d95a8', letterSpacing: '0.2em'}}>· GPU-STORY</span>
      </div>

      {/* top-right: scene ticker + live equalizer */}
      <div style={{position: 'absolute', top: 34, right: 44, display: 'flex', alignItems: 'center', gap: 20}}>
        <div style={{display: 'flex', alignItems: 'flex-end', gap: 4, height: 26}}>
          {Array.from({length: 7}).map((_, i) => (
            <span key={i} style={{width: 4, height: 6 + Math.abs(Math.sin(frame * 0.24 + i * 1.3)) * 20, background: '#59c2ff', opacity: 0.8, borderRadius: 2}} />
          ))}
        </div>
        <span style={{fontSize: 20, color: '#f4f6fb', letterSpacing: '0.2em', fontWeight: 700}}>{isS1 ? '01' : '02'}</span>
        <span style={{fontSize: 20, color: '#5a6175', letterSpacing: '0.2em'}}>/ 02</span>
      </div>

      {/* corner breathing brackets */}
      {[[44, 34, 1, 1], [1876, 34, -1, 1], [44, 1046, 1, -1], [1876, 1046, -1, -1]].map(([x, y, sx, sy], i) => (
        <div key={i} style={{position: 'absolute', left: x, top: y, width: 34, height: 34, borderTop: sx > 0 ? '3px solid #59c2ff' : 'none', borderBottom: sx < 0 ? '3px solid #59c2ff' : 'none', borderLeft: sy > 0 ? '3px solid #59c2ff' : 'none', borderRight: sy < 0 ? '3px solid #59c2ff' : 'none', opacity: 0.35 + 0.2 * Math.sin(frame * 0.06 + i), transform: `scale(${breathe(frame, 0.06, 70, i)})`}} />
      ))}

      {/* bottom: progress bar */}
      <div style={{position: 'absolute', left: 44, right: 44, bottom: 40, height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3}}>
        <div style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(frame / duration) * 100}%`, background: 'linear-gradient(90deg,#59c2ff,#ff4d6d)', borderRadius: 3}} />
        <div style={{position: 'absolute', left: `${(frame / duration) * 100}%`, top: -5, width: 14, height: 14, borderRadius: 8, background: '#fff', boxShadow: '0 0 14px #59c2ff', transform: 'translateX(-50%)'}} />
        {/* scene divider tick */}
        <div style={{position: 'absolute', left: `${(F(SCENE_CUT) / duration) * 100}%`, top: -6, width: 2, height: 17, background: '#ffd166'}} />
      </div>
    </AbsoluteFill>
  );
};
