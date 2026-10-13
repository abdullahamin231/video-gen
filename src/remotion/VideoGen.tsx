import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {C, FONT, toneColor} from '../design';
import type {Bar, Scene, Spec} from '../timeline';
import {SCENES, sceneIndexAt, toFrames} from '../timeline';

/* ------------------------------------------------------------------ *
 * Primitives                                                          *
 * ------------------------------------------------------------------ */

const useEnter = (delay: number, damping = 26) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: frame - delay, fps, config: {damping, stiffness: 120}});
};

/** Fade + rise helper for text lines. */
const rise = (frame: number, delay: number, fps = 30) => {
  const t = spring({frame: frame - delay, fps, config: {damping: 30}});
  return {
    opacity: interpolate(t, [0, 0.6], [0, 1], {extrapolateRight: 'clamp'}),
    transform: `translateY(${interpolate(t, [0, 1], [26, 0], {
      extrapolateRight: 'clamp',
    })}px)`,
  };
};

/* ------------------------------------------------------------------ *
 * Spec renderers                                                      *
 * ------------------------------------------------------------------ */

const BarRow: React.FC<{bar: Bar; max: number; delay: number}> = ({
  bar,
  max,
  delay,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const grow = spring({
    frame: frame - delay,
    fps,
    config: {damping: 30, stiffness: 90},
  });
  const color = toneColor(bar.tone);
  const pct = Math.max(2, (bar.value / max) * 100);

  return (
    <div style={{marginBottom: 34}}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 10,
        }}
      >
        <span
          style={{
            ...FONT,
            fontSize: 26,
            letterSpacing: '0.04em',
            color: C.dim,
            textTransform: 'uppercase',
          }}
        >
          {bar.label}
        </span>
        <span
          style={{
            ...FONT,
            fontSize: 42,
            fontWeight: 800,
            color,
          }}
        >
          {bar.display}
        </span>
      </div>
      <div
        style={{
          height: 22,
          borderRadius: 11,
          background: C.bgSoft,
          border: `1px solid ${C.line}`,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct * grow}%`,
            height: '100%',
            background: `linear-gradient(90deg, ${color}bb, ${color})`,
            boxShadow: `0 0 28px ${color}77`,
            borderRadius: 11,
          }}
        />
      </div>
      {bar.sub ? (
        <div style={{...FONT, fontSize: 22, color: C.faint, marginTop: 8}}>
          {bar.sub}
        </div>
      ) : null}
    </div>
  );
};

const Bars: React.FC<{scene: Scene & {spec: Extract<Spec, {kind: 'bars'}>}}> = ({
  scene,
}) => {
  const max = scene.spec.max ?? Math.max(...scene.spec.bars.map((b) => b.value));
  return (
    <>
      {scene.spec.title ? (
        <div
          style={{
            ...FONT,
            fontSize: 28,
            color: C.faint,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            marginBottom: 34,
          }}
        >
          {scene.spec.title}
        </div>
      ) : null}
      {scene.spec.bars.map((b, i) => (
        <BarRow key={b.label} bar={b} max={max} delay={18 + i * 9} />
      ))}
    </>
  );
};

const Cards: React.FC<{scene: Scene & {spec: Extract<Spec, {kind: 'cards'}>}}> = ({
  scene,
}) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: scene.spec.items.length > 2 ? '1fr 1fr' : '1fr 1fr',
        gap: 28,
      }}
    >
      {scene.spec.items.map((it, i) => {
        const r = rise(frame, 18 + i * 10);
        const color = toneColor(it.tone);
        return (
          <div
            key={it.title}
            style={{
              ...r,
              background: C.panel,
              border: `1px solid ${color}55`,
              borderLeft: `5px solid ${color}`,
              borderRadius: 16,
              padding: '30px 32px',
            }}
          >
            <div
              style={{
                ...FONT,
                fontSize: 24,
                fontWeight: 700,
                color,
                letterSpacing: '0.08em',
              }}
            >
              {it.title}
            </div>
            <div
              style={{
                ...FONT,
                fontSize: 32,
                fontWeight: 600,
                color: C.text,
                marginTop: 14,
                whiteSpace: 'pre-line',
                lineHeight: 1.35,
              }}
            >
              {it.body}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const TimelineView: React.FC<{
  scene: Scene & {spec: Extract<Spec, {kind: 'timeline'}>};
}> = ({scene}) => {
  const frame = useCurrentFrame();
  return (
    <div>
      {scene.spec.items.map((it, i) => {
        const r = rise(frame, 20 + i * 12);
        const color = toneColor(it.tone);
        return (
          <div
            key={it.when}
            style={{
              ...r,
              display: 'flex',
              alignItems: 'center',
              gap: 28,
              marginBottom: 30,
            }}
          >
            <div
              style={{
                ...FONT,
                fontSize: 26,
                fontWeight: 800,
                color: C.bg,
                background: color,
                borderRadius: 10,
                padding: '10px 18px',
                minWidth: 190,
                textAlign: 'center',
                letterSpacing: '0.06em',
              }}
            >
              {it.when}
            </div>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                background: color,
                boxShadow: `0 0 20px ${color}`,
                flexShrink: 0,
              }}
            />
            <div style={{...FONT, fontSize: 32, color: C.text, fontWeight: 600}}>
              {it.what}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Scene shell                                                         *
 * ------------------------------------------------------------------ */

export const SceneView: React.FC<{scene: Scene}> = ({scene}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const dur = toFrames(scene.end) - toFrames(scene.start);
  const local = frame - toFrames(scene.start);

  // Scene shell fade in/out
  const shell = interpolate(
    local,
    [0, 10, dur - 12, dur - 2],
    [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  const kick = useEnter(4);
  const title = rise(frame, 10, fps);
  const punch = interpolate(local, [dur - 90, dur - 70], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        opacity: shell,
        position: 'absolute',
        inset: 0,
        padding: '90px 130px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Kicker */}
      <div
        style={{
          ...FONT,
          opacity: kick,
          transform: `translateX(${interpolate(kick, [0, 1], [-30, 0])}px)`,
          fontSize: 26,
          fontWeight: 800,
          letterSpacing: '0.42em',
          color: C.accent,
          marginBottom: 22,
          display: 'flex',
          alignItems: 'center',
          gap: 22,
        }}
      >
        <span style={{width: 60, height: 3, background: C.accent}} />
        {scene.kicker}
      </div>

      {/* Title */}
      <h1
        style={{
          ...title,
          ...FONT,
          fontSize: 76,
          fontWeight: 900,
          lineHeight: 1.06,
          color: C.text,
          margin: 0,
          maxWidth: '80%',
        }}
      >
        {scene.title}
      </h1>

      {/* Spec body */}
      <div style={{flex: 1, display: 'flex', alignItems: 'center', marginTop: 40}}>
        <div style={{width: '100%'}}>
          {scene.spec.kind === 'bars' ? (
            <Bars scene={scene as never} />
          ) : scene.spec.kind === 'cards' ? (
            <Cards scene={scene as never} />
          ) : scene.spec.kind === 'timeline' ? (
            <TimelineView scene={scene as never} />
          ) : null}
        </div>
      </div>

      {/* Punchline */}
      {scene.punch ? (
        <div
          style={{
            opacity: punch,
            transform: `translateY(${interpolate(punch, [0, 1], [16, 0])}px)`,
            ...FONT,
            fontSize: 34,
            fontStyle: 'italic',
            color: C.gold,
            maxWidth: '78%',
            lineHeight: 1.4,
          }}
        >
          “{scene.punch}”
        </div>
      ) : null}
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Progress bar + scene ticker (persistent chrome)                     *
 * ------------------------------------------------------------------ */

const Chrome: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const idx = sceneIndexAt(frame / 30);

  return (
    <>
      {/* scene ticker top-right */}
      <div
        style={{
          ...FONT,
          position: 'absolute',
          top: 46,
          right: 130,
          fontSize: 20,
          letterSpacing: '0.2em',
          color: C.faint,
        }}
      >
        {SCENES.map((s, i) => (
          <span
            key={s.id}
            style={{
              color: i === idx ? C.accent : C.faint,
              marginRight: 16,
              fontWeight: i === idx ? 800 : 500,
              transition: 'color 0.2s',
            }}
          >
            {String(i + 1).padStart(2, '0')}
          </span>
        ))}
      </div>

      {/* progress bar bottom */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 8,
          background: C.bgSoft,
        }}
      >
        <div
          style={{
            width: `${(frame / durationInFrames) * 100}%`,
            height: '100%',
            background: `linear-gradient(90deg, ${C.accent}, ${C.good})`,
            boxShadow: `0 0 18px ${C.accent}`,
          }}
        />
      </div>
    </>
  );
};

/* ------------------------------------------------------------------ *
 * Main composition                                                    *
 * ------------------------------------------------------------------ */

export const RemotionVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const idx = sceneIndexAt(t);

  return (
    <div
      style={{
        flex: 1,
        width: 1920,
        height: 1080,
        background: `
          radial-gradient(1100px 700px at 12% -10%, #14243b 0%, transparent 60%),
          radial-gradient(900px 600px at 100% 110%, #16243022 0%, transparent 60%),
          ${C.bg}`,
        color: C.text,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* subtle grid */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `linear-gradient(${C.line}22 1px, transparent 1px),
                           linear-gradient(90deg, ${C.line}22 1px, transparent 1px)`,
          backgroundSize: '80px 80px',
          maskImage: 'radial-gradient(900px 700px at 50% 45%, #000 30%, transparent 100%)',
        }}
      />
      <SceneView scene={SCENES[idx]} key={SCENES[idx].id} />
      <Chrome />
    </div>
  );
};
