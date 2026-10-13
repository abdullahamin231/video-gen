import React from 'react';
import {clamp01, E, springAt, drift, breathe, wobble, rand, srand, map} from './ease';
import {CountUp, Kinetic, SlamWord} from './Kinetic';
import {DISPLAY, MONO, UI, enter} from './Bits1';

/* ================================================================ *
 * ROCKET — launches up and escapes (the "moon" gag)                *
 * ================================================================ */
export const Rocket: React.FC<{frame: number; start: number; size?: number}> = ({frame, start, size = 150}) => {
  const t = clamp01((frame - start) / 40);
  const s = E.inQuad(t); // accelerating upward
  const y = -s * 1500;
  const flame = 0.6 + 0.4 * Math.abs(Math.sin(frame * 0.8));
  return (
    <div style={{transform: `translateY(${y}px) rotate(${wobble(frame, 4, 20)}deg)`, opacity: t < 0.02 ? 0 : clamp01((frame - start) / 4)}}>
      <svg width={size} height={size} viewBox="0 0 150 150" style={{filter: 'drop-shadow(0 0 20px #ff9d4dcc)'}}>
        {/* flame */}
        <path d={`M65 118 L75 ${132 + flame * 26} L85 118 Z`} fill="#ff9d3d" opacity={0.9} />
        <path d={`M70 118 L75 ${128 + flame * 16} L80 118 Z`} fill="#ffe27a" />
        {/* body */}
        <path d="M75 18 C95 40 100 78 100 100 L50 100 C50 78 55 40 75 18 Z" fill="#eef2fb" stroke="#c3ccdd" strokeWidth="2" />
        <path d="M75 18 C82 30 86 44 88 58 L62 58 C64 44 68 30 75 18 Z" fill="#ff4d6d" />
        <circle cx="75" cy="70" r="10" fill="#59c2ff" stroke="#2a5f80" strokeWidth="2" />
        <path d="M50 100 L34 122 L50 112 Z" fill="#ff4d6d" /><path d="M100 100 L116 122 L100 112 Z" fill="#ff4d6d" />
      </svg>
    </div>
  );
};

export const Moon: React.FC<{frame: number; start: number; size?: number}> = ({frame, start, size = 120}) => {
  const s = enter(frame, start, 20, 1.8, 8);
  return (
    <div style={{transform: `scale(${0.3 + s * 0.7})`, opacity: clamp01((frame - start) / 8), filter: 'drop-shadow(0 0 24px #cbd5e1aa)'}}>
      <svg width={size} height={size} viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="50" fill="#c9d3e3" />
        <g fill="#a9b5c9"><circle cx="42" cy="46" r="11" /><circle cx="74" cy="60" r="8" /><circle cx="52" cy="80" r="6" /><circle cx="80" cy="86" r="5" /></g>
      </svg>
    </div>
  );
};

/* ================================================================ *
 * CALENDAR — flips pages back to "3 WEEKS AGO"                     *
 * ================================================================ */
export const Calendar: React.FC<{frame: number; start: number}> = ({frame, start}) => {
  const s = enter(frame, start, 14, 2.4, 6);
  const flipT = clamp01((frame - start - 6) / 22);
  const flip = E.inOutCubic(flipT);
  // three page flips (weeks)
  const pages = [0, 1, 2];
  return (
    <div style={{transform: `scale(${0.4 + s * 0.6}) rotate(${(1 - s) * -8 + wobble(frame, 1.5, 90)}deg)`, opacity: clamp01((frame - start) / 5), perspective: 900}}>
      <div style={{width: 360, background: '#0f1219', border: '1px solid #2a2f3d', borderRadius: 18, overflow: 'hidden', boxShadow: '0 30px 70px rgba(0,0,0,0.6)', position: 'relative'}}>
        <div style={{background: '#ff4d6d', height: 54, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontWeight: 700, color: '#fff', letterSpacing: '0.2em', fontSize: 20}}>CALENDAR</div>
        {/* flying pages */}
        {pages.map((p) => {
          const pt = clamp01((frame - start - 6 - p * 5) / 12);
          const pe = E.inQuad(pt);
          return (
            <div key={p} style={{position: 'absolute', top: 54, left: 0, right: 0, height: 260, background: '#f4f6fb', opacity: (1 - pe) * (pt > 0 ? 1 : 0), transform: `translateY(${-pe * 40}px) rotateX(${pe * 100}deg)`, transformOrigin: 'top center', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: DISPLAY, fontSize: 40, color: '#0a0a0a'}}>
            −1w
          </div>
          );
        })}
        <div style={{height: 260, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f4f6fb'}}>
          <div style={{fontFamily: MONO, fontSize: 22, color: '#ff4d6d', letterSpacing: '0.2em', fontWeight: 700}}>3 WEEKS</div>
          <div style={{fontFamily: DISPLAY, fontSize: 80, color: '#0a0a0a', lineHeight: 1}}>AGO</div>
        </div>
      </div>
    </div>
  );
};

/* ================================================================ *
 * RABBIT HOLE — expanding concentric rings, falling in             *
 * ================================================================ */
export const RabbitHole: React.FC<{frame: number; start: number; dur?: number}> = ({frame, start, dur = 90}) => {
  const t = clamp01((frame - start) / dur);
  const rings = 9;
  return (
    <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', perspective: 800, opacity: 0.9 * Math.sin(Math.min(1, t) * Math.PI) ** 0.5}}>
      {Array.from({length: rings}).map((_, i) => {
        const phase = ((i / rings) + (frame - start) * 0.012) % 1;
        const sc = 0.1 + phase * 3.2;
        const op = (1 - phase) * 0.6;
        return (
          <div key={i} style={{position: 'absolute', width: 260, height: 260, borderRadius: '50%', border: `${Math.max(1, 6 * (1 - phase))}px solid rgba(120,180,255,${op})`, transform: `scale(${sc}) translateZ(${-phase * 400}px)`, boxShadow: `0 0 30px rgba(90,180,255,${op * 0.5})`}} />
        );
      })}
    </div>
  );
};

/* ================================================================ *
 * SPREADSHEET — fills cell-by-cell in a diagonal cascade           *
 * ================================================================ */
export const Spreadsheet: React.FC<{frame: number; start: number; cols?: number; rows?: number}> = ({frame, start, cols = 8, rows = 6}) => {
  const s = enter(frame, start, 16, 2, 7);
  const cellDelay = (r: number, c: number) => start + 8 + (r + c) * 1.7;
  return (
    <div style={{transform: `scale(${0.85 + s * 0.15}) rotateX(${(1 - s) * 20}deg)`, opacity: clamp01((frame - start) / 6), background: '#0f1219', border: '1px solid #2a2f3d', borderRadius: 12, padding: 14, boxShadow: '0 30px 70px rgba(0,0,0,0.6)'}}>
      <div style={{fontFamily: MONO, fontSize: 16, color: '#22e08a', letterSpacing: '0.18em', marginBottom: 10}}>cost_analysis.xlsx</div>
      <div style={{display: 'grid', gridTemplateColumns: `repeat(${cols}, 64px)`, gap: 3}}>
        {Array.from({length: rows * cols}).map((_, k) => {
          const r = Math.floor(k / cols), c = k % cols;
          const t = clamp01((frame - cellDelay(r, c)) / 6);
          const e = E.outBack(t);
          const filled = rand(k * 3.3) > 0.35;
          return (
            <div key={k} style={{width: 64, height: 30, borderRadius: 3, background: filled ? `rgba(89,194,255,${0.15 + rand(k) * 0.5})` : 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', transform: `scale(${e})`, opacity: clamp01(t * 2), display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 13, color: '#cfe6ff'}}>
            {filled && t > 0.6 ? (rand(k * 7) > 0.5 ? Math.floor(rand(k * 11) * 900 + 100) : '✓') : ''}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ================================================================ *
 * EBAY WINDOW — 12:00 AM, listings scroll + rack-focus, V100 $695  *
 * ================================================================ */
const LISTINGS = [
  {t: 'Tesla V100 SXM2 32GB', p: '$695', hot: true},
  {t: 'V100 SXM2 carrier board', p: '$189'},
  {t: 'NVIDIA Tesla P100 x2', p: '$240'},
  {t: 'DGX Spark replica case', p: '$60'},
  {t: 'V100 16GB PCIe', p: '$310'},
  {t: 'RTX 5090 (used)', p: '$2,140'},
];
export const EbayWindow: React.FC<{frame: number; start: number}> = ({frame, start}) => {
  const s = enter(frame, start, 16, 2.1, 7);
  const scroll = Math.max(0, frame - start - 10) * 2.4;
  const clock = Math.floor(frame / 15) % 2 === 0 ? '12:00 AM' : '12:00 AM';
  // rack focus: blur in then sharpen on the hot listing
  const focus = clamp01((frame - start - 22) / 14);
  const hotSnap = enter(frame, start + 26, 12, 2.4, 8);
  return (
    <div style={{transform: `scale(${0.8 + s * 0.2}) translateY(${(1 - s) * 30}px)`, opacity: clamp01((frame - start) / 6), width: 640, background: '#0f1219', border: '1px solid #2a2f3d', borderRadius: 14, overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,0.65)'}}>
      {/* title bar */}
      <div style={{height: 46, background: '#171b24', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8}}>
        <span style={{width: 12, height: 12, borderRadius: 6, background: '#ff5f57'}} /><span style={{width: 12, height: 12, borderRadius: 6, background: '#febc2e'}} /><span style={{width: 12, height: 12, borderRadius: 6, background: '#28c840'}} />
        <div style={{marginLeft: 14, flex: 1, background: '#0b0d13', borderRadius: 7, padding: '5px 12px', fontFamily: UI, fontSize: 15, color: '#8d95a8'}}>ebay.com/sch/i.html?_nkw=<span style={{color: '#f4f6fb'}}>v100 sxm2</span></div>
        <div style={{fontFamily: MONO, fontSize: 15, color: '#febc2e', marginLeft: 12, letterSpacing: '0.08em'}}>{clock}</div>
      </div>
      {/* scrolling listings (rack focus) */}
      <div style={{height: 300, overflow: 'hidden', position: 'relative', filter: `blur(${(1 - focus) * 3}px)`}}>
        <div style={{transform: `translateY(${-((scroll) % 400)}px)`}}>
          {[...LISTINGS, ...LISTINGS].map((l, i) => (
            <div key={i} style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)', background: l.hot && i % 6 === 0 ? 'rgba(34,224,138,0.08)' : 'transparent'}}>
              <span style={{fontFamily: UI, fontSize: 17, color: '#c9d1e0'}}>{l.t}</span>
              <span style={{fontFamily: DISPLAY, fontSize: 20, color: l.hot ? '#22e08a' : '#f4f6fb'}}>{l.p}</span>
            </div>
          ))}
        </div>
      </div>
      {/* the snapped deal */}
      <div style={{padding: '14px 18px', borderTop: '1px solid #2a2f3d', transform: `scale(${0.7 + hotSnap * 0.3}) rotate(${(1 - hotSnap) * -4}deg)`, opacity: clamp01(hotSnap * 2), background: 'linear-gradient(90deg,rgba(34,224,138,0.14),transparent)'}}>
        <span style={{fontFamily: MONO, fontSize: 15, color: '#22e08a', letterSpacing: '0.12em'}}>▸ DEAL FOUND · </span>
        <span style={{fontFamily: DISPLAY, fontSize: 26, color: '#22e08a'}}>Tesla V100 SXM2 32GB — $695</span>
      </div>
    </div>
  );
};

/* ================================================================ *
 * SPEC SHEET                                                       *
 * ================================================================ */
export const SpecSheet: React.FC<{frame: number; start: number}> = ({frame, start}) => {
  const s = enter(frame, start, 15, 2.2, 7);
  const rows = [['ARCH', 'Volta'], ['MEM', '32 GB HBM2'], ['BW', '900 GB/s'], ['YEAR', '2017'], ['PRICE', '$695']];
  return (
    <div style={{transform: `scale(${0.8 + s * 0.2}) rotate(${(1 - s) * 3}deg)`, opacity: clamp01((frame - start) / 6), width: 420, background: '#0f1219', border: '1px solid #2a2f3d', borderRadius: 14, padding: 26, boxShadow: '0 26px 60px rgba(0,0,0,0.6)'}}>
      <div style={{fontFamily: MONO, fontSize: 16, color: '#ffd166', letterSpacing: '0.2em', marginBottom: 16}}>SPEC_SHEET.PDF</div>
      {rows.map(([k, v], i) => {
        const rt = clamp01((frame - start - 6 - i * 3) / 8);
        return (
          <div key={k} style={{display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', opacity: clamp01(rt * 2), transform: `translateX(${(1 - E.outCubic(rt)) * 30}px)`}}>
            <span style={{fontFamily: MONO, fontSize: 17, color: '#8d95a8'}}>{k}</span>
            <span style={{fontFamily: DISPLAY, fontSize: 19, color: '#f4f6fb'}}>{v}</span>
          </div>
        );
      })}
    </div>
  );
};

/* ================================================================ *
 * YOUTUBE CARD — Jun Yamog's video                                 *
 * ================================================================ */
export const YouTubeCard: React.FC<{frame: number; start: number}> = ({frame, start}) => {
  const s = springAt(clamp01((frame - start) / 15), {freq: 2, damp: 7.5});
  const live = breathe(frame, 0.04, 60);
  return (
    <div style={{transform: `translateY(${(1 - s) * 260}px) scale(${0.9 + s * 0.1})`, opacity: clamp01((frame - start) / 6), width: 720, background: '#0f1219', border: '1px solid #2a2f3d', borderRadius: 16, overflow: 'hidden', boxShadow: '0 34px 90px rgba(0,0,0,0.7)'}}>
      {/* thumbnail */}
      <div style={{position: 'relative', height: 300, background: 'linear-gradient(120deg,#1a2233,#0d1017)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 30, filter: `brightness(${live})`}}>
        {/* 4 v100 vs dgx mini */}
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8}}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{width: 54, height: 40, borderRadius: 5, background: '#22e08a', boxShadow: `0 0 14px #22e08a${Math.floor(frame / 6 + i) % 2 ? '' : '66'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 11, color: '#04240f', fontWeight: 700}}>V100</div>
          ))}
        </div>
        <div style={{fontFamily: DISPLAY, fontSize: 40, color: '#ffd166'}}>VS</div>
        <div style={{width: 90, height: 70, borderRadius: 8, background: '#59c2ff', boxShadow: '0 0 20px #59c2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 12, color: '#04242f', fontWeight: 700}}>SPARK</div>
        <div style={{position: 'absolute', bottom: 12, right: 14, background: '#000', color: '#fff', fontFamily: MONO, fontSize: 14, padding: '3px 8px', borderRadius: 4}}>12:04</div>
      </div>
      {/* meta */}
      <div style={{padding: '18px 22px', display: 'flex', gap: 14}}>
        <div style={{width: 44, height: 44, borderRadius: 22, background: 'linear-gradient(135deg,#ff4d6d,#ffd166)', flexShrink: 0}} />
        <div>
          <div style={{fontFamily: UI, fontSize: 22, color: '#f4f6fb', fontWeight: 700, lineHeight: 1.2}}>9 year old GPU beats today's latest?</div>
          <div style={{fontFamily: UI, fontSize: 15, color: '#8d95a8', marginTop: 4}}>June Yamog · 4× V100 vs DGX Spark</div>
        </div>
      </div>
    </div>
  );
};

/* ================================================================ *
 * CLICKBAIT STAMP → morphs                                        *
 * ================================================================ */
export const ClickbaitStamp: React.FC<{frame: number; start: number}> = ({frame, start}) => {
  const t = clamp01((frame - start) / 10);
  const slamS = springAt(t, {freq: 1.7, damp: 9});
  const out = clamp01((frame - start - 20) / 10); // fades/morphs away
  const scale = 2.6 - slamS * 1.6;
  return (
    <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none'}}>
      <div style={{transform: `rotate(-14deg) scale(${scale * (1 - out * 0.3)})`, opacity: clamp01(t * 3) * (1 - out), border: '7px solid #ff4d6d', borderRadius: 12, padding: '10px 30px', fontFamily: DISPLAY, fontSize: 76, color: '#ff4d6d', letterSpacing: '0.04em', textShadow: '0 0 20px #ff4d6d88', boxShadow: '0 0 30px #ff4d6d55'}}>
        CLICKBAIT
      </div>
    </div>
  );
};

/** "?" then "×2" playback morph. */
export const MorphMark: React.FC<{frame: number; qAt: number; xAt: number}> = ({frame, qAt, xAt}) => {
  const q = clamp01((frame - qAt) / 8);
  const x = clamp01((frame - xAt) / 8);
  const qOut = clamp01((frame - xAt) / 6);
  return (
    <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none'}}>
      {q > 0 && qOut < 1 ? (
        <div style={{position: 'absolute', transform: `scale(${0.4 + springAt(q, {freq: 2, damp: 6}) * 0.6}) rotate(${wobble(frame, 6, 30)}deg)`, opacity: 1 - qOut, fontFamily: DISPLAY, fontSize: 150, color: '#ffd166', textShadow: '0 0 30px #ffd166'}}>?</div>
      ) : null}
      {x > 0 ? (
        <div style={{transform: `scale(${0.3 + springAt(x, {freq: 1.8, damp: 8}) * 0.7})`, fontFamily: DISPLAY, fontSize: 120, color: '#22e08a', textShadow: '0 0 30px #22e08a', display: 'flex', alignItems: 'center', gap: 10}}>
          <svg width="90" height="90" viewBox="0 0 90 90"><path d="M20 12 L45 45 L20 78 M48 12 L73 45 L48 78" stroke="#22e08a" strokeWidth="10" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span>2</span>
        </div>
      ) : null}
    </div>
  );
};

/* ================================================================ *
 * GPU CHIPS — V100 (2017) & DGX Spark                              *
 * ================================================================ */
export const V100Chip: React.FC<{frame: number; start: number; idx?: number; size?: number}> = ({frame, start, idx = 0, size = 150}) => {
  const s = springAt(clamp01((frame - start) / 12), {freq: 1.9, damp: 8.5});
  const idle = Math.sin(frame * 0.07 + idx) * 4;
  return (
    <div style={{transform: `translateY(${(1 - s) * -120 + idle}px) scale(${0.4 + s * 0.6}) rotate(${(1 - s) * 15 + wobble(frame, 1.5, 80, idx)}deg)`, opacity: clamp01((frame - start) / 5)}}>
      <svg width={size} height={size} viewBox="0 0 150 150" style={{filter: 'drop-shadow(0 0 16px #22e08a77)'}}>
        <rect x="24" y="24" width="102" height="102" rx="10" fill="#0b1a14" stroke="#22e08a" strokeWidth="3" />
        <rect x="40" y="40" width="70" height="70" rx="6" fill="#12281f" />
        <text x="75" y="80" textAnchor="middle" fontFamily={MONO} fontSize="26" fontWeight="700" fill="#22e08a">V100</text>
        <text x="75" y="102" textAnchor="middle" fontFamily={MONO} fontSize="16" fill="#8d95a8">2017</text>
        {[45, 75, 105].map((p) => (
          <g key={p} stroke="#22e08a" strokeWidth="3"><line x1={p} y1="10" x2={p} y2="24" /><line x1={p} y1="126" x2={p} y2="140" /><line x1="10" y1={p} x2="24" y2={p} /><line x1="126" y1={p} x2="140" y2={p} /></g>
        ))}
      </svg>
    </div>
  );
};

export const DGXBox: React.FC<{frame: number; start: number; size?: number}> = ({frame, start, size = 160}) => {
  const s = springAt(clamp01((frame - start) / 12), {freq: 1.9, damp: 8.5});
  const idle = Math.sin(frame * 0.06) * 4;
  return (
    <div style={{transform: `translateY(${(1 - s) * -120 + idle}px) scale(${0.4 + s * 0.6}) rotate(${(1 - s) * -12 + wobble(frame, 1.5, 80, 3)}deg)`, opacity: clamp01((frame - start) / 5)}}>
      <svg width={size} height={size} viewBox="0 0 160 160" style={{filter: 'drop-shadow(0 0 18px #59c2ff77)'}}>
        <rect x="30" y="24" width="100" height="112" rx="10" fill="#08131d" stroke="#59c2ff" strokeWidth="3" />
        <rect x="44" y="40" width="72" height="50" rx="5" fill="#0d2233" />
        <text x="80" y="72" textAnchor="middle" fontFamily={MONO} fontSize="17" fontWeight="700" fill="#59c2ff">DGX</text>
        <text x="80" y="112" textAnchor="middle" fontFamily={MONO} fontSize="15" fill="#8d95a8">SPARK '25</text>
        {[0, 1, 2].map((i) => <circle key={i} cx={52 + i * 20} cy="102" r="4" fill="#59c2ff" opacity={Math.floor(frame / 5 + i) % 2 ? 1 : 0.3} />)}
      </svg>
    </div>
  );
};

/* ================================================================ *
 * COMMENT BOXES                                                    *
 * ================================================================ */
export const CommentBox: React.FC<{frame: number; start: number; user: string; text: string; color?: string}> = ({frame, start, user, text, color = '#59c2ff'}) => {
  const s = enter(frame, start, 13, 2.5, 6.5);
  return (
    <div style={{transform: `translateX(${(1 - s) * -60}px) scale(${0.9 + s * 0.1})`, opacity: clamp01((frame - start) / 5), background: '#0f1219', border: '1px solid #2a2f3d', borderLeft: `4px solid ${color}`, borderRadius: 10, padding: '12px 16px', width: 360}}>
      <div style={{fontFamily: MONO, fontSize: 14, color, fontWeight: 700}}>@{user}</div>
      <div style={{fontFamily: UI, fontSize: 17, color: '#c9d1e0', marginTop: 3}}>{text}</div>
    </div>
  );
};
