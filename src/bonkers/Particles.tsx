import React, {useEffect, useRef} from 'react';
import {clamp01, E, rand, srand, prog} from './ease';

/** Full-frame canvas that redraws every frame (deterministic, pure function of frame). */
export const useCanvas = (
  frame: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w = 1920,
  h = 1080,
) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    draw(ctx, w, h);
  });
  return <canvas ref={ref} width={w} height={h} style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}} />;
};

/* ---------------------------------------------------------------- *
 * Ambient floating particle field (living background layer)        *
 * ---------------------------------------------------------------- */
export const AmbientField: React.FC<{
  frame: number;
  count?: number;
  color?: string;
  speed?: number;
  depth?: number;
  opacity?: number;
}> = ({frame, count = 90, color = '#7fd8ff', speed = 1, depth = 1, opacity = 0.5}) => {
  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < count; i++) {
      const sp = (0.25 + rand(i * 3.1) * 0.9) * speed * depth;
      const px = ((rand(i * 7.7) * w + frame * sp * 0.6) % (w + 120)) - 60;
      const py = ((rand(i * 5.3) * h - frame * sp * 0.35) % (h + 120) + h + 120) % (h + 120) - 60;
      const rad = (0.7 + rand(i * 2.2) * 2.4) * depth;
      const tw = 0.5 + 0.5 * Math.sin(frame * 0.06 * (0.5 + rand(i * 9)) + i);
      ctx.globalAlpha = opacity * (0.25 + 0.75 * tw);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  return useCanvas(frame, draw) as unknown as React.ReactElement;
};

/* ---------------------------------------------------------------- *
 * Radial particle burst on an impact                               *
 * ---------------------------------------------------------------- */
export type BurstSpec = {at: number; x: number; y: number; count?: number; color?: string; power?: number; life?: number; hue2?: string};

export const Bursts: React.FC<{frame: number; bursts: BurstSpec[]}> = ({frame, bursts}) => {
  const draw = (ctx: CanvasRenderingContext2D) => {
    ctx.globalCompositeOperation = 'lighter';
    for (const b of bursts) {
      const life = b.life ?? 34;
      const t = (frame - b.at) / life;
      if (t < 0 || t > 1) continue;
      const count = b.count ?? 46;
      const power = b.power ?? 13;
      const ease = 1 - Math.pow(1 - t, 3);
      for (let i = 0; i < count; i++) {
        const ang = rand(b.at * 3 + i * 1.7) * Math.PI * 2;
        const spd = (0.25 + rand(b.at * 5 + i * 2.9)) * power;
        const dist = ease * spd * 34;
        const px = b.x + Math.cos(ang) * dist;
        const py = b.y + Math.sin(ang) * dist + t * t * 26; // slight gravity
        const rad = (1 - t) * (1.6 + rand(i * 4.4) * 3.4);
        ctx.globalAlpha = (1 - t) * 0.95;
        ctx.fillStyle = i % 3 === 0 && b.hue2 ? b.hue2 : b.color ?? '#ffd166';
        ctx.beginPath();
        ctx.arc(px, py, Math.max(0.2, rad), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };
  return useCanvas(frame, draw) as unknown as React.ReactElement;
};

/* ---------------------------------------------------------------- *
 * Token rivers — the HERO speed-differential moment                *
 * • Two horizontal streams of glowing "tokens".                    *
 * • `ratio` = real speed multiplier (2.5×).                        *
 * • Dots wrap and streak; the fast lane visibly pulls ahead.       *
 * ---------------------------------------------------------------- */
export const TokenRiver: React.FC<{
  frame: number;
  start: number;
  yTop: number;
  yBottom: number;
  x0: number;
  x1: number;
  ratio: number; // fast/slow speed factor
  colorFast?: string;
  colorSlow?: string;
  label?: boolean;
}> = ({frame, start, yTop, yBottom, x0, x1, ratio, colorFast = '#ffd166', colorSlow = '#59c2ff'}) => {
  const draw = (ctx: CanvasRenderingContext2D) => {
    const t = frame - start;
    if (t < 0) return;
    const spawn = clamp01(t / 12); // streams spool up
    ctx.globalCompositeOperation = 'lighter';
    const lanes = [
      {y: yTop, speed: 6.2 * ratio, color: colorFast, n: 30},
      {y: yBottom, speed: 6.2, color: colorSlow, n: 30},
    ];
    for (let li = 0; li < lanes.length; li++) {
      const L = lanes[li];
      const span = x1 - x0;
      for (let i = 0; i < L.n; i++) {
        const off = i * (span / L.n);
        // position wraps within the lane; fast lane advances ratio× quicker
        const x = x0 + (((off + t * L.speed) % span) + span) % span;
        // only draw tokens that have "arrived" (spooled up from left)
        const arrived = clamp01((x - x0) / (span * 0.5));
        const yy = L.y + Math.sin((x * 0.02) + i) * 3;
        // motion streak
        ctx.globalAlpha = 0.85 * arrived * spawn;
        ctx.fillStyle = L.color;
        const r = 5.2;
        // streak line behind dot proportional to speed
        const streak = L.speed * 0.5;
        const grad = ctx.createLinearGradient(x - streak, yy, x, yy);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, L.color);
        ctx.fillStyle = grad;
        ctx.fillRect(x - streak, yy - r * 0.35, streak, r * 0.7);
        ctx.fillStyle = L.color;
        ctx.beginPath();
        ctx.arc(x, yy, r, 0, Math.PI * 2);
        ctx.fill();
        // glow core
        ctx.globalAlpha = arrived * spawn;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x, yy, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };
  return useCanvas(frame, draw) as unknown as React.ReactElement;
};
