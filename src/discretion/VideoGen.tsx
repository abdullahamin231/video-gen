import React, {useMemo} from 'react';
import {useCurrentFrame} from 'remotion';
import {C} from '../design';
import type {Scene} from '../timeline';
import {SCENES, sceneIndexAt} from '../timeline';

/* ------------------------------------------------------------------ *
 * Deterministic pseudo-random (seeded) — canvas particles              *
 * ------------------------------------------------------------------ */
const rnd = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Particle field: streams of "tokens" flowing GPU→memory, speed = bandwidth. */
const TokenField: React.FC<{
  y: number;
  speed: number;
  color: string;
  count: number;
  seed: number;
  label: string;
  t: number;
}> = ({y, speed, color, count, seed, label, t}) => {
  const dots = useMemo(
    () =>
      new Array(count).fill(0).map((_, i) => ({
        off: rnd(seed + i),
        lane: rnd(seed + i * 7) * 60 - 30,
        r: 3 + rnd(seed + i * 3) * 3,
      })),
    [count, seed],
  );
  return (
    <div style={{position: 'absolute', left: 0, right: 0, top: y, height: 64}}>
      {dots.map((d, i) => {
        const p = (d.off + (t * speed) / 4) % 1;
        const x = p * 1920;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: 32 + d.lane,
              width: d.r * 2,
              height: d.r * 2,
              borderRadius: d.r,
              background: color,
              boxShadow: `0 0 ${d.r * 3}px ${color}`,
              opacity: 0.5 + 0.5 * Math.sin(p * Math.PI),
            }}
          />
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: 60,
          top: -34,
          fontFamily: 'monospace',
          fontSize: 22,
          color,
          letterSpacing: '0.2em',
          fontWeight: 700,
        }}
      >
        {label}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Scene-specific procedural canvas art                                 *
 * ------------------------------------------------------------------ */

/** A GPU card rendered procedurally (board + fans + die glow). */
const GpuCard: React.FC<{
  x: number;
  y: number;
  label: string;
  sub: string;
  glow: number;
  color: string;
}> = ({x, y, label, sub, glow, color}) => (
  <div
    style={{
      position: 'absolute',
      left: x,
      top: y,
      width: 300,
      height: 190,
      borderRadius: 16,
      background: `linear-gradient(145deg, #1b1f2b, #0d1017)`,
      border: `2px solid ${color}66`,
      boxShadow: `0 0 ${18 + glow * 40}px ${color}${glow > 0.5 ? '88' : '33'}`,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: 16,
    }}
  >
    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
      <span style={{fontFamily: 'monospace', fontSize: 22, fontWeight: 800, color}}>
        {label}
      </span>
      <div style={{display: 'flex', gap: 8}}>
        {[0, 1].map((i) => (
          <div
            key={i}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              border: `2px solid ${color}`,
              background: `conic-gradient(${color}55, transparent 60%)`,
              transform: `rotate(${(glow * 720 + i * 45) % 360}deg)`,
            }}
          />
        ))}
      </div>
    </div>
    <div style={{height: 10, borderRadius: 5, background: `${color}33`, overflow: 'hidden'}}>
      <div style={{width: `${40 + glow * 60}%`, height: '100%', background: color}} />
    </div>
    <div style={{fontFamily: 'monospace', fontSize: 18, color: C.dim}}>{sub}</div>
  </div>
);

/* ------------------------------------------------------------------ *
 * Renderer per scene kind (procedural, math-driven)                    *
 * ------------------------------------------------------------------ */

const BarsProcedural: React.FC<{scene: Scene & {spec: {kind: 'bars'}}}> = ({scene}) => {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const local = t - scene.start;
  const max = scene.spec.max ?? Math.max(...scene.spec.bars.map((b) => b.value));
  const bars = scene.spec.bars;
  // horizontal row layout with live counters
  return (
    <div style={{display: 'flex', alignItems: 'flex-end', gap: 60, height: 460}}>
      {bars.map((b, i) => {
        const grow = Math.max(0, Math.min(1, (local - 0.4 - i * 0.15) / 1.1));
        const ease = 1 - Math.pow(1 - grow, 3);
        const h = (b.value / max) * 400 * ease;
        const col =
          b.tone === 'good'
            ? C.good
            : b.tone === 'bad'
              ? C.bad
              : b.tone === 'accent'
                ? C.accent
                : C.dim;
        const counter = b.value * ease;
        const decimals = b.value % 1 !== 0 ? 1 : 0;
        const disp = b.display.replace(/[\d,.]+/, counter.toFixed(decimals));
        return (
          <div key={b.label} style={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
            <span style={{fontFamily: 'monospace', fontSize: 34, fontWeight: 800, color: col, marginBottom: 14}}>
              {disp}
            </span>
            <div
              style={{
                width: 120,
                height: h,
                borderRadius: '10px 10px 0 0',
                background: `linear-gradient(180deg, ${col}, ${col}66)`,
                boxShadow: `0 0 30px ${col}66`,
              }}
            />
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: 20,
                color: C.dim,
                marginTop: 16,
                letterSpacing: '0.06em',
                textAlign: 'center',
                maxWidth: 200,
              }}
            >
              {b.label}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const CardsProcedural: React.FC<{scene: Scene & {spec: {kind: 'cards'}}}> = ({scene}) => {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const local = t - scene.start;
  return (
    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 30, width: '100%'}}>
      {scene.spec.items.map((it, i) => {
        const p = Math.max(0, Math.min(1, (local - 0.3 - i * 0.12) / 0.7));
        const e = 1 - Math.pow(1 - p, 3);
        const col =
          it.tone === 'good'
            ? C.good
            : it.tone === 'bad'
              ? C.bad
              : it.tone === 'accent'
                ? C.accent
                : C.gold;
        return (
          <div
            key={it.title}
            style={{
              opacity: e,
              transform: `translateY(${(1 - e) * 40}px)`,
              background: C.panel,
              border: `1px solid ${col}44`,
              borderLeft: `6px solid ${col}`,
              borderRadius: 16,
              padding: '28px 30px',
              boxShadow: `0 0 ${e * 26}px ${col}22`,
            }}
          >
            <div style={{fontFamily: 'monospace', fontSize: 24, fontWeight: 800, color: col, letterSpacing: '0.08em'}}>
              {it.title}
            </div>
            <div style={{fontSize: 32, fontWeight: 600, color: C.text, marginTop: 14, whiteSpace: 'pre-line', lineHeight: 1.35}}>
              {it.body}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const TimelineProcedural: React.FC<{scene: Scene & {spec: {kind: 'timeline'}}}> = ({scene}) => {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const local = t - scene.start;
  return (
    <div>
      {scene.spec.items.map((it, i) => {
        const p = Math.max(0, Math.min(1, (local - 0.3 - i * 0.25) / 0.8));
        const e = 1 - Math.pow(1 - p, 3);
        const col =
          it.tone === 'bad' ? C.bad : it.tone === 'good' ? C.good : C.accent;
        return (
          <div key={it.when} style={{display: 'flex', alignItems: 'center', gap: 26, marginBottom: 30, opacity: e, transform: `translateX(${(1 - e) * -50}px)`}}>
            <span style={{fontFamily: 'monospace', fontSize: 26, fontWeight: 900, color: C.bg, background: col, borderRadius: 10, padding: '10px 18px', minWidth: 190, textAlign: 'center'}}>
              {it.when}
            </span>
            <div style={{width: 24, height: 24, borderRadius: 12, background: col, boxShadow: `0 0 18px ${col}`, flexShrink: 0}} />
            <span style={{fontSize: 32, fontWeight: 600, color: C.text}}>{it.what}</span>
          </div>
        );
      })}
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * GPU showcase overlay for hardware-heavy scenes                       *
 * ------------------------------------------------------------------ */
const gpuArt: Record<string, {label: string; sub: string; color: string}> = {
  intro: {label: 'DGX SPARK', sub: '$6,950', color: C.bad},
  setup: {label: '4× V100', sub: '128GB · NVLink', color: C.good},
  bench: {label: 'V100 ×4', sub: '2017 · 155 tok/s', color: C.good},
  bw: {label: 'HBM2', sub: '900 GB/s', color: C.good},
  ic: {label: 'NVLINK', sub: '300 GB/s mesh', color: C.good},
  ti: {label: '1080 Ti', sub: '484 GB/s · unused', color: C.bad},
  sw: {label: 'SM70', sub: 'reclaimed silicon', color: C.good},
  parity: {label: 'V100 ×4', sub: '<$400 · 219 tok/s', color: C.good},
  math: {label: 'RIG', sub: '700W · 155 tok/s', color: C.gold},
};

/* ------------------------------------------------------------------ *
 * Main                                                                 *
 * ------------------------------------------------------------------ */
export const DiscretionVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const idx = sceneIndexAt(t);
  const scene = SCENES[idx];
  const local = t - scene.start;
  const dur = scene.end - scene.start;
  const fade = Math.min(1, Math.min(local / 0.3, (dur - local) / 0.3));

  const showGpu = scene.id in gpuArt;
  const gpu = showGpu ? gpuArt[scene.id] : null;
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);

  return (
    <div
      style={{
        width: 1920,
        height: 1080,
        position: 'relative',
        overflow: 'hidden',
        background: `radial-gradient(1200px 800px at 20% -10%, #101d2e 0%, transparent 60%),
                     radial-gradient(1000px 700px at 95% 110%, #13203022 0%, transparent 60%),
                     ${C.bg}`,
      }}
    >
      {/* animated starfield */}
      {new Array(60).fill(0).map((_, i) => {
        const sx = rnd(i) * 1920;
        const sy = rnd(i + 100) * 1080;
        const tw = 0.3 + 0.7 * Math.abs(Math.sin(t * 0.8 + i));
        return (
          <div key={i} style={{position: 'absolute', left: sx, top: sy, width: 2, height: 2, background: C.accent, opacity: tw * 0.5, borderRadius: 1}} />
        );
      })}

      <div style={{position: 'absolute', inset: 0, padding: '86px 120px', opacity: fade, display: 'flex', flexDirection: 'column'}}>
        <div style={{fontFamily: 'monospace', fontSize: 24, fontWeight: 800, letterSpacing: '0.4em', color: C.accent, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 20}}>
          <span style={{width: 54, height: 3, background: C.accent}} />
          {scene.kicker}
        </div>
        <h1 style={{fontSize: 72, fontWeight: 900, lineHeight: 1.08, color: C.text, margin: 0, maxWidth: '84%'}}>
          {scene.title}
        </h1>

        <div style={{flex: 1, display: 'flex', alignItems: 'center', position: 'relative', marginTop: 34}}>
          <div style={{width: showGpu ? '58%' : '100%'}}>
            {scene.spec.kind === 'bars' ? (
              <BarsProcedural scene={scene as never} />
            ) : scene.spec.kind === 'cards' ? (
              <CardsProcedural scene={scene as never} />
            ) : scene.spec.kind === 'timeline' ? (
              <TimelineProcedural scene={scene as never} />
            ) : null}
          </div>

          {/* GPU card + token streams (procedural canvas idiom) */}
          {showGpu && gpu ? (
            <div style={{position: 'absolute', right: 0, top: '10%', width: 640, height: '80%'}}>
              <GpuCard x={170} y={40} label={gpu.label} sub={gpu.sub} glow={pulse} color={gpu.color} />
              <TokenField y={280} speed={scene.id === 'bw' || scene.id === 'bench' || scene.id === 'sw' ? 2.4 : 1.4} color={gpu.color} count={40} seed={idx * 13} label={`${gpu.sub}`} t={t} />
              <TokenField y={400} speed={0.5} color={C.accent} count={26} seed={idx * 29} label="MEMORY ←→ CHIP" t={t} />
            </div>
          ) : null}
        </div>

        {scene.punch ? (
          <div style={{fontSize: 34, fontStyle: 'italic', fontWeight: 600, color: C.gold, maxWidth: '80%', lineHeight: 1.4}}>
            “{scene.punch}”
          </div>
        ) : null}
      </div>

      {/* HUD chrome */}
      <div style={{position: 'absolute', top: 40, right: 120, fontFamily: 'monospace', fontSize: 18, color: C.faint, letterSpacing: '0.16em'}}>
        SCENE {String(idx + 1).padStart(2, '0')}/{SCENES.length} · {t.toFixed(1)}s
      </div>
      <div style={{position: 'absolute', left: 0, bottom: 0, height: 8, width: `${(frame / (SCENES[SCENES.length - 1].end * 30)) * 100}%`, background: `linear-gradient(90deg, ${C.accent}, ${C.good})`}} />
    </div>
  );
};
