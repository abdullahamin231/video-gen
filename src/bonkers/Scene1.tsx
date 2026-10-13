import React from 'react';
import {AbsoluteFill} from 'remotion';
import {CamState, CamKey, livingCam} from './camera';
import {Par, At} from './Layer';
import {B, F, S1_SHAKE} from './beats';
import {clamp01, E, springAt, drift, breathe, wobble, rand, srand, impact} from './ease';
import {Kinetic, SlamWord, Kicker, CountUp, Scramble} from './Kinetic';
import {PCTower, ChipIcon, SubCard, OwnChip, SearchBar, ServerShelf, GpuCard, BrainIcon, PromptBox, DISPLAY, MONO, UI, enter} from './Bits1';
import {Rocket, Moon} from './Bits2';
import {AmbientField, Bursts, BurstSpec} from './Particles';

/* Camera path — pans/pushes across a wide world. Stations:
 * A(tower+motives)~620, B(search+prices)~1500, C(brain+rocket)~2450. */
export const S1_CAM: CamKey[] = [
  {f: F(0), x: -340, y: 0, zoom: 1.18, rot: -1.4},
  {f: F(3.4), x: -300, y: -10, zoom: 1.06, rot: 0.6, ease: E.inOutCubic},
  {f: F(4.2), x: -250, y: 6, zoom: 1.1, rot: -0.7, spring: {freq: 2, damp: 7}},
  {f: F(9.7), x: -150, y: -24, zoom: 1.0, rot: 1.1, ease: E.inOutCubic},
  {f: F(12.4), x: 300, y: -6, zoom: 1.16, rot: -3.2, ease: E.inOutQuart}, // whip → B
  {f: F(15.9), x: 520, y: 24, zoom: 1.34, rot: 2.2, spring: {freq: 1.8, damp: 9}}, // punch "prices"
  {f: F(17.0), x: 540, y: 60, zoom: 1.04, rot: 0, ease: E.outCubic}, // pull out → shelf rises
  {f: F(18.4), x: 520, y: 70, zoom: 1.12, rot: -1.2, spring: {freq: 1.8, damp: 9}},
  {f: F(21.5), x: 560, y: 56, zoom: 1.1, rot: 1.3, spring: {freq: 1.8, damp: 9}},
  {f: F(27.3), x: 540, y: 92, zoom: 1.0, rot: -0.4, ease: E.outCubic}, // widest: big rack
  {f: F(30.4), x: 1470, y: -66, zoom: 1.22, rot: -3.4, ease: E.inOutQuart}, // → C
  {f: F(32.3), x: 1490, y: 4, zoom: 1.12, rot: 1.4, spring: {freq: 2, damp: 7}},
  {f: F(33.8), x: 1490, y: -300, zoom: 1.28, rot: 4.5, ease: E.inQuad}, // follow rocket up
  {f: F(35.3), x: 1490, y: -620, zoom: 3.0, rot: 0, ease: E.inQuad}, // zoom-through out
];

const BURSTS: BurstSpec[] = [
  {at: F(B.dgx) + 6, x: 1180, y: 560, count: 40, color: '#59c2ff', power: 9},
  {at: F(B.rtx) + 6, x: 1500, y: 560, count: 40, color: '#ffd166', power: 9},
  {at: F(B.rack) + 8, x: 1830, y: 540, count: 70, color: '#ff4d6d', power: 15, hue2: '#ff9d4d'},
  {at: F(B.pricesBeat), x: 1500, y: 540, count: 30, color: '#ff4d6d', power: 11},
];

export const Scene1: React.FC<{frame: number; cam: CamState}> = ({frame, cam}) => {
  const t = frame;
  // station coords
  const A = {x: 620, y: 540};
  const Bc = {x: 1500, y: 560};

  return (
    <AbsoluteFill>
      {/* ---- ambient particle field (screen space, self-animating) ---- */}
      <AmbientField frame={t} count={70} color="#6fb6ff" speed={0.7} depth={0.7} opacity={0.4} />

      {/* ---- drifting decorative price glyphs (depth 0.72) ---- */}
      <Par cam={cam} depth={0.72}>
        {['$', '¢', '$', 'GPU', '$$', '»'].map((g, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 200 + i * 340 + drift(t, 26, 120 + i * 20, i),
              top: 120 + (i % 3) * 300 + drift(t, 20, 90 + i * 17, i + 2),
              fontFamily: DISPLAY,
              fontSize: 40 + i * 8,
              color: '#ffffff',
              opacity: 0.05 + 0.03 * Math.sin(t * 0.05 + i),
              transform: `rotate(${drift(t, 8, 160, i)}deg)`,
            }}
          >
            {g}
          </div>
        ))}
      </Par>

      {/* ================= MAIN CONTENT (depth 1.0) ================= */}
      <Par cam={cam} depth={1.0}>
        {/* ---------- STATION A: PC tower + motivations ---------- */}
        <At x={A.x - 170} y={A.y + 20}>
          <PCTower frame={t} start={F(B.towerDraw)} />
        </At>
        {/* LOCAL AI label (kinetic) */}
        <div style={{position: 'absolute', left: A.x - 170, top: A.y - 260, transform: 'translateX(-50%)'}}>
          <Kicker text="LOCAL AI" frame={t} start={F(B.towerLabel)} color="#59c2ff" size={26} />
        </div>
        {/* headline kinetic */}
        <div style={{position: 'absolute', left: A.x - 320, top: A.y + 250, width: 760}}>
          <Kinetic text="RUN AI LOCALLY" frame={t} start={F(0.3)} perChar={2.4} size={62} color="#f4f6fb" effect="rise" idle={3} />
          <div style={{height: 14}} />
          <Kinetic text="you finally did it." frame={t} start={F(1.4)} perChar={2} size={30} color="#8d95a8" weight={600} font={UI} idle={1.5} />
        </div>

        {/* motivations — staggered around the tower */}
        <At x={A.x + 210} y={A.y - 150}>
          <ChipIcon frame={t} start={F(B.chipDev)} label="DEVELOPER" />
        </At>
        <At x={A.x + 300} y={A.y + 40}>
          <SubCard frame={t} start={F(B.subCard)} />
        </At>
        <At x={A.x + 190} y={A.y + 250}>
          <OwnChip frame={t} start={F(B.ownChip)} />
        </At>

        {/* ---------- STATION B: search + price shelf ---------- */}
        <At x={Bc.x} y={Bc.y - 330}>
          <SearchBar frame={t} start={F(B.searchIn)} width={760} />
        </At>

        {/* "AND THEN YOU SEE THE PRICES" kinetic flash */}
        <div style={{position: 'absolute', left: Bc.x, top: Bc.y - 150, transform: 'translateX(-50%)', textAlign: 'center', opacity: (() => {
          const o = clamp01((t - F(B.pricesBeat)) / 6);
          const fade = 1 - clamp01((t - F(B.shelf)) / 10);
          return o * fade;
        })()}}>
          <div style={{fontFamily: DISPLAY, fontSize: 74, color: '#ff4d6d', textShadow: '0 0 30px #ff4d6d88', transform: `scale(${0.5 + springAt(clamp01((t - F(B.pricesBeat)) / 10), {freq: 1.8, damp: 9}) * 0.5}) rotate(${wobble(t, 2, 30)}deg)`}}>
            THEN YOU SEE THE PRICES
          </div>
        </div>

        {/* server shelf + price cards */}
        <At x={Bc.x} y={Bc.y + 120}>
          <ServerShelf frame={t} start={F(B.shelf)}>
            <div style={{display: 'flex', gap: 40, alignItems: 'flex-end', width: '100%', justifyContent: 'space-around', padding: '0 30px'}}>
              <GpuCard frame={t} start={F(B.dgx)} name="NVIDIA DGX SPARK" sub="GB10 Blackwell" price={6950} color="#59c2ff" countDur={22} />
              <GpuCard frame={t} start={F(B.rtx)} name="RTX 5090" sub="if you can find one" price={2000} suffix="+" color="#ffd166" countDur={20} />
              <GpuCard frame={t} start={F(B.rack)} name="8-CARD RACK" sub="Blackwell server" price={120000} color="#ff4d6d" countDur={30} big />
            </div>
          </ServerShelf>
        </At>

        {/* ---------- STATION C: brain + prompt + rocket ---------- */}
        <At x={2300} y={360}>
          <BrainIcon frame={t} start={F(B.brain)} glitch={t > F(B.brain) + 4 && t < F(B.brain) + 18} />
        </At>
        {/* "your brain just stops" + glitch lines */}
        <BrainStop frame={t} />

        <At x={2600} y={560}>
          <PromptBox frame={t} start={F(B.prompt)} text="ONE MODEL" width={440} />
        </At>
        {/* pink brain ↔ prompt connector */}
        <svg style={{position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, overflow: 'visible', opacity: clamp01((t - F(B.prompt)) / 10) * 0.6}}>
          <path d={`M2360 380 C2460 420 2500 500 2560 540`} stroke="#ff4d9d" strokeWidth="3" fill="none" strokeDasharray="10 8" opacity={0.8} />
        </svg>

        <At x={2760} y={220}>
          <Moon frame={t} start={F(B.prompt)} size={130} />
        </At>
        <At x={2360} y={620}>
          <Rocket frame={t} start={F(B.rocket)} size={150} />
        </At>
        {/* "not trying to land on the moon" */}
        <div style={{position: 'absolute', left: 2340, top: 700, width: 720, opacity: clamp01((t - F(B.rocket)) / 8)}}>
          <Kinetic text="just want to run ONE MODEL" frame={t} start={F(B.prompt) + 4} perChar={2} size={40} color="#ff9dc7" font={UI} weight={700} idle={2} />
          <div style={{height: 8}} />
          <Kinetic text="not trying to land on the moon" frame={t} start={F(B.rocket) + 2} perChar={1.8} size={30} color="#8d95a8" font={UI} weight={600} idle={1.5} />
        </div>
      </Par>

      {/* ---- foreground accents (depth 1.25) ---- */}
      <Par cam={cam} depth={1.25}>
        {[[200, 200], [1720, 300], [900, 940], [1500, 860]].map(([x, y], i) => (
          <div key={i} style={{position: 'absolute', left: x + drift(t, 30, 200, i), top: y + drift(t, 24, 170, i + 1), width: 120, height: 120, borderRadius: 60, background: 'radial-gradient(circle, rgba(120,180,255,0.16), transparent 70%)', filter: 'blur(4px)'}} />
        ))}
      </Par>

      {/* ---- impact bursts (depth 1.0) ---- */}
      <Par cam={cam} depth={1.0}>
        <Bursts frame={t} bursts={BURSTS} />
      </Par>
    </AbsoluteFill>
  );
};

/** "your brain just stops" — glitching caption + short-circuit sparks. */
const BrainStop: React.FC<{frame: number}> = ({frame}) => {
  const inT = clamp01((frame - F(B.brain)) / 8);
  const out = 1 - clamp01((frame - F(B.prompt)) / 8);
  const glitchX = srand(Math.floor(frame / 2)) * 10;
  const words = ['your brain', 'just STOPS'];
  return (
    <div style={{position: 'absolute', left: 2160, top: 560, width: 420, opacity: inT * out}}>
      {words.map((w, i) => {
        const wt = clamp01((frame - F(B.brain) - i * 5) / 8);
        return (
          <div key={i} style={{fontFamily: DISPLAY, fontSize: i === 0 ? 44 : 62, color: i === 0 ? '#f4f6fb' : '#ff4d9d', transform: `translateX(${glitchX * (i + 1)}px) scale(${0.6 + springAt(wt, {freq: 2, damp: 6}) * 0.4})`, textShadow: i === 1 ? '0 0 24px #ff4d9d' : 'none', opacity: clamp01(wt * 2), lineHeight: 1.05}}>
            {w}
          </div>
        );
      })}
      {/* short-circuit sparks */}
      <svg style={{position: 'absolute', left: 30, top: -20, width: 200, height: 120, overflow: 'visible', opacity: inT}}>
        {[0, 1, 2].map((i) => {
          const st = F(B.brain) + 4 + i * 3;
          const so = clamp01((frame - st) / 6) * (1 - clamp01((frame - st - 6) / 6));
          return <path key={i} d={`M${20 + i * 60} 10 l${srand(i) * 20} 24 l${-srand(i + 5) * 24} 14 l${srand(i + 9) * 22} 20`} stroke="#ffd166" strokeWidth="3" fill="none" opacity={so} />;
        })}
      </svg>
    </div>
  );
};
