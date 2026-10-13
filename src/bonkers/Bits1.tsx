import React from 'react';
import {clamp01, E, springAt, drift, breathe, wobble, rand, srand, scrambleChar, map} from './ease';
import {CountUp, Kinetic, Scramble, SlamWord} from './Kinetic';

export const DISPLAY = '"Archivo Black","Anton","Inter",system-ui,sans-serif';
export const MONO = '"Space Mono","JetBrains Mono",ui-monospace,monospace';
export const UI = '"Inter",system-ui,sans-serif';

/** Reusable entrance progress (spring w/ overshoot). */
export const enter = (frame: number, start: number, dur = 13, freq = 2.2, damp = 7) =>
  springAt(clamp01((frame - start) / dur), {freq, damp});

/* ================================================================ *
 * PC TOWER — line-drawn, traces itself on                          *
 * ================================================================ */
const trace = (frame: number, start: number, dur: number) => {
  const p = E.outCubic(clamp01((frame - start) / dur));
  return {strokeDashoffset: 1 - p, opacity: p > 0 ? 1 : 0};
};
export const PCTower: React.FC<{frame: number; start: number}> = ({frame, start}) => {
  // continuous scan line inside + breathing glow
  const glow = breathe(frame, 0.4, 60);
  const scan = ((frame * 3) % 200);
  return (
    <div style={{position: 'relative', width: 260, height: 420}}>
      <svg width="260" height="420" viewBox="0 0 260 420" style={{overflow: 'visible', filter: `drop-shadow(0 0 ${14 * glow}px #59c2ff88)`}}>
        <g stroke="#59c2ff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
          {[
            'M40 20 L220 20 L220 400 L40 400 Z',
            'M40 20 L20 40 L20 420 L40 400',
            'M220 20 L240 40 L240 420 L220 400',
            'M40 400 L20 420 L220 420 L240 420',
            'M60 60 L200 60 L200 90 L60 90 Z', // vent
            'M60 110 L200 110', 'M60 130 L200 130', 'M60 150 L200 150',
            'M70 200 L190 200 L190 320 L70 320 Z', // glass panel
            'M95 355 L165 355', // power btn
          ].map((d, i) => {
            const t = trace(frame, start + i * 2.5, 16);
            return <path key={i} d={d} pathLength={1} strokeDasharray={1} strokeDashoffset={t.strokeDashoffset} opacity={t.opacity * (0.55 + 0.45 * rand(i))} />;
          })}
          {/* spinning fan circles */}
          {[[130, 260, 45]].map(([cx, cy, r], i) => (
            <circle key={i} cx={cx} cy={cy} r={r} pathLength={1} strokeDasharray={1} strokeDashoffset={trace(frame, start + 30, 18).strokeDashoffset} opacity={0.7} />
          ))}
        </g>
        <g stroke="#22e08a" strokeWidth="2.5" fill="none" opacity={clamp01((frame - start - 30) / 12)}>
          <circle cx="130" cy="260" r="30" opacity={0.5} />
          {[0, 1, 2, 3].map((b) => (
            <line key={b} x1="130" y1="260" x2={130 + Math.cos(frame * 0.3 + (b * Math.PI) / 2) * 30} y2={260 + Math.sin(frame * 0.3 + (b * Math.PI) / 2) * 30} opacity={0.8} />
          ))}
        </g>
        {/* scan line */}
        <rect x="70" y={180 + (scan % 150)} width="120" height="3" fill="#59c2ff" opacity={0.5 * clamp01((frame - start - 20) / 10)} />
      </svg>
    </div>
  );
};

/* ================================================================ *
 * CHIP ICON (DEVELOPER)                                            *
 * ================================================================ */
export const ChipIcon: React.FC<{frame: number; start: number; label?: string}> = ({frame, start, label = 'DEVELOPER'}) => {
  const s = enter(frame, start, 14, 2.6, 6.5);
  const rot = wobble(frame, 3, 100, 0.4);
  const pulse = breathe(frame, 0.06, 50);
  return (
    <div style={{transform: `scale(${0.3 + s * 0.7}) rotate(${rot}deg)`, opacity: clamp01((frame - start) / 6), textAlign: 'center'}}>
      <svg width="150" height="150" viewBox="0 0 150 150" style={{filter: `drop-shadow(0 0 ${16 * pulse}px #22e08a99)`}}>
        <rect x="35" y="35" width="80" height="80" rx="12" fill="#0b1a14" stroke="#22e08a" strokeWidth="3" />
        <rect x="55" y="55" width="40" height="40" rx="6" fill="#22e08a" opacity={0.25 + 0.15 * Math.sin(frame * 0.2)} />
        {[55, 75, 95].map((p) => (
          <g key={p} stroke="#22e08a" strokeWidth="3">
            <line x1={p} y1="20" x2={p} y2="35" /><line x1={p} y1="115" x2={p} y2="130" />
            <line x1="20" y1={p} x2="35" y2={p} /><line x1="115" y1={p} x2="130" y2={p} />
          </g>
        ))}
      </svg>
      <div style={{fontFamily: MONO, fontSize: 22, fontWeight: 700, color: '#22e08a', letterSpacing: '0.18em', marginTop: 6}}>{label}</div>
    </div>
  );
};

/* ================================================================ *
 * SUBSCRIPTION CARD ($20 / MO) — strikethrough animates             *
 * ================================================================ */
export const SubCard: React.FC<{frame: number; start: number}> = ({frame, start}) => {
  const s = enter(frame, start, 15, 2.4, 6);
  const strikeStart = start + 20;
  const strike = E.inOutCubic(clamp01((frame - strikeStart) / 10));
  const shake = strike > 0 && strike < 1 ? srand(Math.floor(frame)) * 4 * (1 - strike) : 0;
  return (
    <div style={{transform: `scale(${0.4 + s * 0.6}) translateY(${(1 - s) * 40}px)`, opacity: clamp01((frame - start) / 6), position: 'relative', width: 240}}>
      <div style={{background: '#12141c', border: '1px solid #2a2f3d', borderRadius: 16, padding: '22px 24px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', transform: `translateX(${shake}px)`}}>
        <div style={{fontFamily: UI, fontSize: 18, color: '#8d95a8', fontWeight: 600}}>Chatbot Premium</div>
        <div style={{fontFamily: DISPLAY, fontSize: 52, color: '#f4f6fb', marginTop: 4, position: 'relative', display: 'inline-block'}}>
          $20
          <span style={{fontFamily: UI, fontSize: 22, color: '#8d95a8', fontWeight: 700}}> / mo</span>
          {/* animated strikethrough */}
          <div style={{position: 'absolute', left: -6, top: '52%', height: 7, width: `${strike * 108}%`, background: '#ff4d6d', borderRadius: 4, boxShadow: '0 0 14px #ff4d6d', transform: 'rotate(-6deg)'}} />
        </div>
      </div>
      {strike >= 1 ? (
        <div style={{position: 'absolute', top: -18, right: -14, transform: `rotate(${8 + wobble(frame, 4, 40)}deg)`, fontFamily: DISPLAY, fontSize: 30, color: '#ff4d6d', textShadow: '0 0 16px #ff4d6d'}}>✕</div>
      ) : null}
    </div>
  );
};

/* ================================================================ *
 * "OWN IT" lock chip                                                *
 * ================================================================ */
export const OwnChip: React.FC<{frame: number; start: number}> = ({frame, start}) => {
  const s = enter(frame, start, 14, 2.6, 6.5);
  return (
    <div style={{transform: `scale(${0.3 + s * 0.7})`, opacity: clamp01((frame - start) / 6), textAlign: 'center'}}>
      <svg width="140" height="140" viewBox="0 0 140 140" style={{filter: `drop-shadow(0 0 14px #ffd16688)`}}>
        <rect x="38" y="66" width="64" height="52" rx="10" fill="#1c1608" stroke="#ffd166" strokeWidth="3" />
        <path d="M50 66 V50 a20 20 0 0 1 40 0 V66" fill="none" stroke="#ffd166" strokeWidth="3" />
        <circle cx="70" cy="90" r="6" fill="#ffd166" />
        <rect x="67" y="92" width="6" height="14" rx="3" fill="#ffd166" />
      </svg>
      <div style={{fontFamily: MONO, fontSize: 22, fontWeight: 700, color: '#ffd166', letterSpacing: '0.18em', marginTop: 6}}>OWN IT</div>
    </div>
  );
};

/* ================================================================ *
 * SEARCH BAR — types "GPUs" + blinking caret                       *
 * ================================================================ */
export const SearchBar: React.FC<{frame: number; start: number; width?: number}> = ({frame, start, width = 720}) => {
  const s = enter(frame, start, 16, 2.2, 7);
  const typeStart = start + 12;
  const typed = Math.floor(clamp01((frame - typeStart) / 22) * 4);
  const query = 'GPUs'.slice(0, typed);
  const caretOn = Math.floor(frame / 8) % 2 === 0;
  const done = typed >= 4;
  return (
    <div style={{transform: `scaleX(${0.7 + s * 0.3}) translateY(${(1 - s) * -30}px)`, opacity: clamp01((frame - start) / 6), transformOrigin: 'center'}}>
      <div style={{width, display: 'flex', alignItems: 'center', gap: 16, background: '#0f1219', border: '1px solid #2a2f3d', borderRadius: 999, padding: '20px 30px', boxShadow: '0 24px 60px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.02)'}}>
        <svg width="30" height="30" viewBox="0 0 30 30" style={{flexShrink: 0, opacity: 0.8, transform: `rotate(${done ? 0 : -8}deg)`}}>
          <circle cx="13" cy="13" r="9" stroke="#8d95a8" strokeWidth="2.5" fill="none" />
          <line x1="20" y1="20" x2="27" y2="27" stroke="#8d95a8" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <div style={{fontFamily: UI, fontSize: 40, color: '#f4f6fb', fontWeight: 500, display: 'flex', alignItems: 'center'}}>
          {query}
          <span style={{width: 3, height: 44, background: done && caretOn ? 'transparent' : '#59c2ff', marginLeft: 3, boxShadow: done && caretOn ? 'none' : '0 0 10px #59c2ff'}} />
        </div>
      </div>
    </div>
  );
};

/* ================================================================ *
 * GPU PRICE CARD — slams onto the shelf with price tag             *
 * ================================================================ */
export const GpuCard: React.FC<{
  frame: number;
  start: number;
  name: string;
  sub?: string;
  price: number;
  prefix?: string;
  suffix?: string;
  color?: string;
  countDur?: number;
  pad?: number;
  big?: boolean;
}> = ({frame, start, name, sub, price, prefix = '$', suffix = '', color = '#ff4d6d', countDur = 24, pad = 0, big}) => {
  const s = springAt(clamp01((frame - start) / 12), {freq: 1.9, damp: 8.5});
  const settle = clamp01((frame - start - 12) / 20);
  const idle = Math.sin(frame * 0.06 + start) * 3;
  const tilt = (1 - s) * 12 + wobble(frame, 1.2, 90, start);
  return (
    <div style={{transform: `translateY(${(1 - s) * -140 + idle}px) rotate(${tilt}deg) scale(${0.5 + s * 0.5})`, opacity: clamp01((frame - start) / 5), transformOrigin: 'bottom center'}}>
      <div style={{background: 'linear-gradient(160deg,#161a24,#0d1017)', border: `1px solid ${color}55`, borderTop: `4px solid ${color}`, borderRadius: 16, padding: big ? '26px 34px' : '20px 26px', boxShadow: `0 26px 60px rgba(0,0,0,0.6), 0 0 ${30 * settle}px ${color}44`, minWidth: big ? 300 : 240}}>
        <div style={{fontFamily: MONO, fontSize: big ? 20 : 17, color: '#8d95a8', letterSpacing: '0.14em', textTransform: 'uppercase'}}>{name}</div>
        {sub ? <div style={{fontFamily: UI, fontSize: 16, color: '#5a6175', marginTop: 2}}>{sub}</div> : null}
        <div style={{marginTop: 10}}>
          <CountUp to={price} frame={frame} start={start + 4} dur={countDur} prefix={prefix} suffix={suffix} size={big ? 62 : 50} color={color} pad={pad} />
        </div>
      </div>
    </div>
  );
};

/* ================================================================ *
 * SERVER SHELF — dual tier, rises from below                       *
 * ================================================================ */
export const ServerShelf: React.FC<{frame: number; start: number; children?: React.ReactNode}> = ({frame, start, children}) => {
  const s = enter(frame, start, 22, 1.6, 8);
  return (
    <div style={{transform: `translateY(${(1 - s) * 320}px)`, opacity: clamp01((frame - start) / 8)}}>
      <div style={{position: 'relative', width: 1040, height: 470}}>
        {/* rack frame */}
        <svg width="1040" height="470" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
          <g stroke="#3a4152" strokeWidth="4" fill="none">
            <rect x="10" y="10" width="1020" height="450" rx="10" />
            <line x1="10" y1="235" x2="1030" y2="235" />
          </g>
          {[60, 410].map((y, i) => (
            <rect key={i} x="10" y={y} width="1020" height="4" fill="#59c2ff" opacity={0.12 + 0.08 * Math.sin(frame * 0.1 + i)} />
          ))}
        </svg>
        <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-around', flexWrap: 'wrap', padding: '30px 40px'}}>
          {children}
        </div>
      </div>
    </div>
  );
};

/* ================================================================ *
 * BRAIN ICON — pink, flashing / short-circuiting                   *
 * ================================================================ */
export const BrainIcon: React.FC<{frame: number; start: number; size?: number; glitch?: boolean}> = ({frame, start, size = 170, glitch}) => {
  const s = enter(frame, start, 12, 3, 5.5);
  const flash = 0.6 + 0.4 * (Math.floor(frame / 4) % 2);
  const g = glitch ? srand(Math.floor(frame / 2)) * 6 : 0;
  return (
    <div style={{transform: `scale(${0.2 + s * 0.8})`, opacity: clamp01((frame - start) / 5)}}>
      <svg width={size} height={size} viewBox="0 0 170 170" style={{filter: `drop-shadow(0 0 ${22 * flash}px #ff5 dbb) drop-shadow(0 0 ${22 * flash}px #ff4d9d)`, transform: `translateX(${g}px)`}}>
        <g fill="#ff4d9d" stroke="#ff9dc7" strokeWidth="2.5">
          <path d="M55 40 C30 40 25 70 40 80 C25 95 35 125 60 122 C70 138 100 138 108 120 C135 125 148 95 130 80 C150 65 140 40 115 44 C105 28 70 28 55 40 Z" />
        </g>
        <g stroke="#7a1c46" strokeWidth="2" fill="none" opacity="0.6">
          <path d="M70 50 q10 15 0 30 q-10 15 0 30" /><path d="M100 50 q-10 15 0 30 q10 15 0 30" />
          <path d="M55 80 h60" />
        </g>
      </svg>
    </div>
  );
};

/* ================================================================ *
 * PROMPT BOX ("ONE MODEL")                                         *
 * ================================================================ */
export const PromptBox: React.FC<{frame: number; start: number; text?: string; width?: number}> = ({frame, start, text = 'ONE MODEL', width = 420}) => {
  const s = enter(frame, start, 15, 2.3, 6.5);
  const caret = Math.floor(frame / 9) % 2 === 0;
  return (
    <div style={{width, transform: `scaleX(${0.8 + s * 0.2}) translateY(${(1 - s) * 24}px)`, opacity: clamp01((frame - start) / 6), background: '#0d0f16', border: '1px solid #ff4d9d66', borderRadius: 14, padding: '22px 26px', boxShadow: '0 0 40px #ff4d9d33, inset 0 0 0 1px rgba(255,255,255,0.02)'}}>
      <div style={{fontFamily: MONO, fontSize: 16, color: '#ff4d9d', letterSpacing: '0.2em', marginBottom: 8}}>PROMPT ▸</div>
      <div style={{fontFamily: UI, fontSize: 34, color: '#f4f6fb', fontWeight: 600, display: 'flex', alignItems: 'center'}}>
        {text}
        <span style={{width: 3, height: 34, background: caret ? '#ff4d9d' : 'transparent', marginLeft: 4, boxShadow: caret ? '0 0 10px #ff4d9d' : 'none'}} />
      </div>
    </div>
  );
};
