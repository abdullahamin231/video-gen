import React from 'react';
import {AbsoluteFill} from 'remotion';
import {CamState, CamKey} from './camera';
import {Par, At} from './Layer';
import {B, F, S2_SHAKE} from './beats';
import {clamp01, E, springAt, drift, breathe, wobble, rand, srand} from './ease';
import {Kinetic, SlamWord, Kicker, CountUp} from './Kinetic';
import {Calendar, RabbitHole, Spreadsheet, EbayWindow, SpecSheet, YouTubeCard, ClickbaitStamp, MorphMark, V100Chip, DGXBox, CommentBox} from './Bits2';
import {DISPLAY, MONO, UI, enter} from './Bits1';
import {AmbientField, Bursts, BurstSpec} from './Particles';

/* Camera path for scene 2. Stations: D(calendar/rabbit)~700,
 * E(spreadsheet→ebay→specsheet) 1150→2000, F(youtube+hero)~2560. */
export const S2_CAM: CamKey[] = [
  {f: F(35.3), x: -280, y: -30, zoom: 2.1, rot: 3.2},
  {f: F(36.9), x: -260, y: 0, zoom: 1.05, rot: -1.2, ease: E.outCubic}, // settle, calendar
  {f: F(37.3), x: -250, y: 0, zoom: 1.2, rot: 2.4, spring: {freq: 1.7, damp: 9}}, // dive
  {f: F(41.0), x: 60, y: -20, zoom: 1.1, rot: -2.4, ease: E.inOutQuart}, // → E
  {f: F(45.2), x: 190, y: 10, zoom: 1.14, rot: 1, spring: {freq: 2, damp: 7}}, // spreadsheet
  {f: F(47.0), x: 640, y: -6, zoom: 1.18, rot: -1.4, ease: E.inOutCubic}, // ebay
  {f: F(49.6), x: 664, y: -12, zoom: 1.1, rot: 2.2, ease: E.inOutCubic}, // doomscroll
  {f: F(51.4), x: 1040, y: 10, zoom: 1.12, rot: -1, ease: E.inOutCubic}, // specsheet
  {f: F(54.4), x: 1580, y: -30, zoom: 1.2, rot: 2.8, ease: E.inOutQuart}, // → F youtube
  {f: F(55.7), x: 1600, y: 0, zoom: 1.34, rot: -2.4, spring: {freq: 1.7, damp: 9}}, // clickbait punch
  {f: F(56.9), x: 1600, y: 0, zoom: 1.2, rot: 2, ease: E.inOutCubic},
  {f: F(57.5), x: 1600, y: 40, zoom: 1.02, rot: -1, ease: E.outCubic}, // chips slam, pull wide
  {f: F(58.7), x: 1600, y: 20, zoom: 1.16, rot: 1.5, spring: {freq: 1.7, damp: 9}}, // 2.5× punch
  {f: F(60.0), x: 1590, y: 10, zoom: 1.08, rot: -0.8, ease: E.inOutCubic},
];

const S2_BURSTS: BurstSpec[] = [
  {at: F(B.clickbait) + 4, x: 960, y: 470, count: 46, color: '#ff4d6d', power: 12, hue2: '#ffd166'},
  {at: F(B.chips) + 6, x: 960, y: 620, count: 40, color: '#22e08a', power: 10},
];

export const Scene2: React.FC<{frame: number; cam: CamState}> = ({frame, cam}) => {
  const t = frame;
  return (
    <AbsoluteFill>
      {/* ambient field — screen space (self-animating) */}
      <AmbientField frame={t} count={64} color="#9b7fff" speed={0.6} depth={0.7} opacity={0.35} />

      {/* rabbit-hole tunnel — full-frame dive (37–41) */}
      {t > F(B.rabbit) - 6 && t < F(B.cheapest) + 6 ? (
        <AbsoluteFill><RabbitHole frame={t} start={F(B.rabbit)} dur={F(B.cheapest) - F(B.rabbit) + 8} /></AbsoluteFill>
      ) : null}

      {/* decorative drifting data glyphs (depth 0.72) */}
      <Par cam={cam} depth={0.72}>
        {['tok/s', '¥', 'GB', 'vllm', 'CUDA', '$695', '2017'].map((g, i) => (
          <div key={i} style={{position: 'absolute', left: 180 + i * 300 + drift(t, 24, 130 + i * 15, i), top: 140 + (i % 3) * 300 + drift(t, 20, 95 + i * 13, i + 1), fontFamily: MONO, fontSize: 26, color: '#c9b8ff', opacity: 0.06 + 0.04 * Math.sin(t * 0.06 + i), transform: `rotate(${drift(t, 6, 150, i)}deg)`}}>{g}</div>
        ))}
      </Par>

      {/* ================= MAIN CONTENT (depth 1.0) ================= */}
      <Par cam={cam} depth={1.0}>
        {/* ---------- STATION D: calendar ---------- */}
        <At x={700} y={470}><Calendar frame={t} start={F(B.calendar)} /></At>
        <div style={{position: 'absolute', left: 700, top: 720, transform: 'translateX(-50%)', textAlign: 'center', width: 700}}>
          <Kinetic text="THAT WAS ME" frame={t} start={F(B.calendar) + 6} perChar={2.2} size={40} color="#8d95a8" font={UI} weight={700} align="center" idle={2} />
        </div>

        {/* "deep in the rabbit hole" caption during dive */}
        {t > F(B.rabbit) && t < F(B.cheapest) ? (
          <div style={{position: 'absolute', left: 960, top: 200, transform: 'translateX(-50%)', textAlign: 'center', opacity: Math.sin(clamp01((t - F(B.rabbit)) / (F(B.cheapest) - F(B.rabbit))) * Math.PI)}}>
            <div style={{fontFamily: DISPLAY, fontSize: 66, color: '#f4f6fb', textShadow: '0 0 30px #7f5bff88'}}>DOWN THE RABBIT HOLE</div>
          </div>
        ) : null}

        {/* ---------- STATION E: spreadsheet → ebay → specsheet ---------- */}
        <At x={1150} y={520}><Spreadsheet frame={t} start={F(B.sheet)} cols={8} rows={6} /></At>
        <div style={{position: 'absolute', left: 1150, top: 760, transform: 'translateX(-50%)', opacity: clamp01((t - F(B.sheet)) / 8)}}>
          <div style={{fontFamily: MONO, fontSize: 20, color: '#59c2ff', letterSpacing: '0.16em'}}>I BUILT A SPREADSHEET</div>
        </div>

        <At x={1620} y={520}><EbayWindow frame={t} start={F(B.ebay)} /></At>
        {/* doom-scroll speed lines while listings rack */}
        {t > F(B.doomScroll) && t < F(B.specSheet) ? (
          <div style={{position: 'absolute', left: 1620, top: 300, transform: 'translateX(-50%)', opacity: clamp01((t - F(B.doomScroll)) / 6) * (1 - clamp01((t - F(B.specSheet)) / 6))}}>
            <div style={{fontFamily: DISPLAY, fontSize: 40, color: '#febc2e', transform: `rotate(${wobble(t, 3, 20)}deg)`}}>DOOM-SCROLLING ↻</div>
          </div>
        ) : null}

        <At x={2060} y={540}><SpecSheet frame={t} start={F(B.specSheet)} /></At>
        <div style={{position: 'absolute', left: 2060, top: 800, transform: 'translateX(-50%)', opacity: clamp01((t - F(B.specSheet)) / 8), width: 520, textAlign: 'center'}}>
          <div style={{fontFamily: UI, fontSize: 24, color: '#ffd166', fontWeight: 600}}>reading spec sheets like <span style={{fontStyle: 'italic'}}>entertainment</span></div>
        </div>

        {/* ---------- STATION F: youtube + clickbait + hero ---------- */}
        <At x={2560} y={178}><YouTubeCard frame={t} start={F(B.youtube)} /></At>
        {/* CLICKBAIT stamp + morphs — over the youtube thumbnail */}
        <div style={{position: 'absolute', left: 2560, top: 132, transform: 'translate(-50%,-50%)', width: 780, height: 360}}>
          <ClickbaitStamp frame={t} start={F(B.clickbait)} />
          <MorphMark frame={t} qAt={F(B.question)} xAt={F(B.speed2x)} />
        </div>
        {/* comments to the right of the card */}
        <At x={3150} y={110}><CommentBox frame={t} start={F(B.speed2x) + 4} user="gpu_hoarder" text="wait… FOUR of them??" color="#ffd166" /></At>
        <At x={3150} y={240}><CommentBox frame={t} start={F(B.speed2x) + 10} user="vllm_dev" text="2.5× on 2017 silicon is wild" color="#22e08a" /></At>

        {/* HERO race panel backdrop */}
        <RacePanel frame={t} start={F(B.river)} />
        {/* four V100 chips (2017) feed the FAST lane; DGX feeds the SLOW lane */}
        <div style={{position: 'absolute', left: 2150, top: 458, transform: 'translate(-50%,-50%)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8}}>
          {[0, 1, 2, 3].map((i) => (<V100Chip key={i} frame={t} start={F(B.chips) + i * 2} idx={i} size={94} />))}
        </div>
        <div style={{position: 'absolute', left: 2150, top: 648, transform: 'translate(-50%,-50%)'}}>
          <DGXBox frame={t} start={F(B.chips) + 4} size={124} />
        </div>
        <HeroRivers frame={t} start={F(B.river)} />
        <Hero25 frame={t} />
      </Par>

      {/* screen-space impact bursts */}
      <Bursts frame={t} bursts={S2_BURSTS} />
    </AbsoluteFill>
  );
};

/** Dark backing panel that rises behind the hero race so it pops. */
const RacePanel: React.FC<{frame: number; start: number}> = ({frame, start}) => {
  const s = springAt(clamp01((frame - start) / 16), {freq: 2, damp: 7});
  if (frame < start - 8) return null;
  const scan = ((frame * 4) % 400);
  return (
    <div style={{position: 'absolute', left: 2630, top: 560, transform: `translate(-50%,-50%) scale(${0.86 + s * 0.14})`, width: 1280, height: 400, opacity: clamp01((frame - start) / 8), background: 'linear-gradient(160deg, rgba(8,10,16,0.92), rgba(14,10,20,0.86))', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 22, boxShadow: '0 40px 100px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.02)', overflow: 'hidden'}}>
      <div style={{position: 'absolute', top: 16, left: 28, fontFamily: MONO, fontSize: 18, color: '#8d95a8', letterSpacing: '0.24em'}}>TOKEN SPEED RACE · SAME MODEL</div>
      {/* scan sweep */}
      <div style={{position: 'absolute', top: 0, bottom: 0, left: scan - 120, width: 240, background: 'linear-gradient(90deg, transparent, rgba(120,180,255,0.08), transparent)'}} />
    </div>
  );
};

/** Two DOM token rivers — the fast V100 lane runs 2.5× the DGX lane.
 *  Lives in world space (station F) so it parallaxes with the camera. */
const HeroRivers: React.FC<{frame: number; start: number}> = ({frame, start}) => {
  const t = frame - start;
  if (t < -10) return null;
  const spawn = clamp01(t / 10);
  const x0 = 2300, x1 = 3140, span = x1 - x0;
  const lanes = [
    {y: 500, speed: 7.0 * 2.5, color: '#ffd166', label: '4× V100 · 2017', sub: '155 tok/s', glow: '#ffd166'},
    {y: 620, speed: 7.0, color: '#59c2ff', label: 'DGX SPARK · 2025', sub: '60 tok/s', glow: '#59c2ff'},
  ];
  return (
    <>
      {lanes.map((L, li) => {
        const n = 24;
        const spacing = span / n;
        return (
          <React.Fragment key={li}>
            {/* lane label (right end) */}
            <div style={{position: 'absolute', left: x1 + 18, top: L.y - 30, fontFamily: MONO, fontSize: 19, color: L.color, letterSpacing: '0.08em', opacity: spawn, width: 240}}>
              <div style={{fontWeight: 700}}>{L.label}</div>
              <div style={{color: '#f4f6fb', fontSize: 24, fontFamily: DISPLAY}}>{L.sub}</div>
            </div>
            {/* start line */}
            <div style={{position: 'absolute', left: x0 - 6, top: L.y - 34, width: 3, height: 68, background: L.color, opacity: spawn * 0.5, boxShadow: `0 0 12px ${L.color}`}} />
            {/* tokens */}
            {Array.from({length: n}).map((_, i) => {
              const x = x0 + (((i * spacing + t * L.speed) % span) + span) % span;
              const arrived = clamp01((x - x0) / (span * 0.35));
              const streak = Math.min(60, L.speed * 0.6);
              return (
                <React.Fragment key={i}>
                  <div style={{position: 'absolute', left: x - streak, top: L.y - 3, width: streak, height: 6, borderRadius: 3, background: `linear-gradient(90deg, transparent, ${L.color})`, opacity: arrived * spawn * 0.8}} />
                  <div style={{position: 'absolute', left: x - 7, top: L.y - 7, width: 14, height: 14, borderRadius: 7, background: L.color, boxShadow: `0 0 14px ${L.glow}, 0 0 4px #fff`, opacity: arrived * spawn}} />
                </React.Fragment>
              );
            })}
          </React.Fragment>
        );
      })}
    </>
  );
};

/** Big "2.5×" punch + subtitle that slams in with overshoot. */
const Hero25: React.FC<{frame: number}> = ({frame}) => {
  const t = frame - F(B.hero25);
  const s = springAt(clamp01(t / 12), {freq: 1.7, damp: 9});
  const out = clamp01((frame - F(60) + 6) / 8);
  const jitter = t > 0 && t < 12 ? srand(Math.floor(frame)) * 8 * (1 - t / 12) : 0;
  if (t < -4) return null;
  return (
    <div style={{position: 'absolute', left: 2730, top: 560, transform: `translate(-50%,-50%) translateX(${jitter}px) scale(${0.3 + s * 0.7}) rotate(${(1 - s) * 8 + wobble(frame, 1.5, 40)}deg)`, opacity: clamp01(t / 4) * (1 - out)}}>
      <div style={{background: 'radial-gradient(circle, rgba(20,12,0,0.82), rgba(10,6,0,0.7))', borderRadius: 28, padding: '18px 40px', boxShadow: '0 0 60px rgba(255,209,102,0.35)'}}>
        <div style={{fontFamily: DISPLAY, fontSize: 138, color: '#ffd166', textShadow: '0 0 40px #ffd166aa', lineHeight: 1, textAlign: 'center'}}>
          2.5×
        </div>
        <div style={{fontFamily: MONO, fontSize: 25, color: '#22e08a', letterSpacing: '0.14em', textAlign: 'center', marginTop: 4, opacity: clamp01((t - 6) / 8)}}>FASTER AT WRITING</div>
      </div>
    </div>
  );
};
