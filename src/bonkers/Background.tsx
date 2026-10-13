import React from 'react';
import {fbm1, drift, rand, breathe} from './ease';
import {useCanvas} from './Particles';

/**
 * A living background — never a flat fill. Flowing gradient mesh, a drifting
 * perspective grid, a moving light sweep, and animated film grain. Everything
 * keeps moving on its own, independent of any camera.
 */
export const Background: React.FC<{
  frame: number;
  hue?: [number, number]; // hue drift range in degrees
  intensity?: number;
}> = ({frame, hue = [205, 265], intensity = 1}) => {
  const h = (hue[0] + (hue[1] - hue[0]) * (0.5 + 0.5 * Math.sin(frame * 0.006))) % 360;
  // three drifting mesh blobs
  const b1x = 20 + fbm1(1, frame / 90) * 22;
  const b1y = 15 + fbm1(2, frame / 110) * 20;
  const b2x = 78 + fbm1(3, frame / 80) * 20;
  const b2y = 82 + fbm1(4, frame / 95) * 18;
  const b3x = 50 + drift(frame, 24, 160);
  const b3y = 55 + fbm1(5, frame / 130) * 16;
  const sweep = ((frame * 0.6) % 2600) - 400; // light sweep x

  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', background: '#05060a'}}>
      {/* gradient mesh */}
      <div
        style={{
          position: 'absolute',
          inset: '-10%',
          background: `
            radial-gradient(46% 52% at ${b1x}% ${b1y}%, hsla(${h},90%,52%,${0.42 * intensity}) 0%, transparent 62%),
            radial-gradient(44% 50% at ${b2x}% ${b2y}%, hsla(${(h + 60) % 360},88%,50%,${0.34 * intensity}) 0%, transparent 60%),
            radial-gradient(52% 46% at ${b3x}% ${b3y}%, hsla(${(h + 130) % 360},85%,48%,${0.26 * intensity}) 0%, transparent 64%),
            radial-gradient(120% 120% at 50% 50%, transparent 55%, #03040a 100%)
          `,
          filter: 'saturate(1.15)',
        }}
      />
      {/* drifting perspective grid */}
      <div
        style={{
          position: 'absolute',
          inset: '-30%',
          backgroundImage: `linear-gradient(hsla(${h},70%,60%,0.12) 1px, transparent 1px),
                            linear-gradient(90deg, hsla(${h},70%,60%,0.12) 1px, transparent 1px)`,
          backgroundSize: '96px 96px',
          transform: `translate(${drift(frame, 40, 220)}px, ${drift(frame, 30, 180, 1)}px) rotateX(0deg)`,
          maskImage: 'radial-gradient(120% 90% at 50% 40%, #000 20%, transparent 90%)',
          WebkitMaskImage: 'radial-gradient(120% 90% at 50% 40%, #000 20%, transparent 90%)',
        }}
      />
      {/* moving light sweep */}
      <div
        style={{
          position: 'absolute',
          top: '-20%',
          bottom: '-20%',
          left: sweep,
          width: 320,
          background: `linear-gradient(90deg, transparent, hsla(${(h + 40) % 360},95%,70%,0.14), transparent)`,
          filter: 'blur(24px)',
          transform: 'skewX(-14deg)',
        }}
      />
      <Grain frame={frame} />
      {/* vignette */}
      <div style={{position: 'absolute', inset: 0, background: 'radial-gradient(120% 120% at 50% 46%, transparent 52%, rgba(0,0,0,0.62) 100%)'}} />
    </div>
  );
};

/** Coarse animated film grain (cheap: small block grid scaled up). */
const Grain: React.FC<{frame: number; opacity?: number}> = ({frame, opacity = 0.06}) => {
  const GW = 240;
  const GH = 135;
  const draw = (ctx: CanvasRenderingContext2D) => {
    const img = ctx.createImageData(GW, GH);
    const d = img.data;
    for (let i = 0; i < GW * GH; i++) {
      const v = (rand(i * 1.7 + frame * 91.3) * 255) | 0;
      d[i * 4] = v;
      d[i * 4 + 1] = v;
      d[i * 4 + 2] = v;
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  };
  return (
    <div style={{position: 'absolute', inset: 0, opacity, mixBlendMode: 'overlay'}}>
      <canvas
        ref={(c) => {
          if (!c) return;
          const ctx = c.getContext('2d');
          if (!ctx) return;
          draw(ctx);
        }}
        width={GW}
        height={GH}
        style={{width: '100%', height: '100%', imageRendering: 'pixelated'}}
      />
    </div>
  );
};
