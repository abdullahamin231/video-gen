/**
 * Virtual camera — a moving window over a bigger world.
 * Produces {x,y,zoom,rot} per frame from keyframes + idle drift + impacts.
 */
import {clamp01, E, fbm1, impact, lerp, springAt} from './ease';

export type CamState = {x: number; y: number; zoom: number; rot: number};

export type CamKey = {
  f: number;
  x?: number;
  y?: number;
  zoom?: number;
  rot?: number;
  /** Easing to reach THIS key from the previous one. */
  ease?: (t: number) => number;
  /** Use a spring (with overshoot) to arrive at this key. */
  spring?: {freq?: number; damp?: number};
};

export const camState = (k: CamKey): CamState => ({
  x: k.x ?? 0,
  y: k.y ?? 0,
  zoom: k.zoom ?? 1,
  rot: k.rot ?? 0,
});

/**
 * Evaluate camera at `frame` given an ordered keyframe list.
 * Continuous interpolation — never snaps between keys.
 */
export const evalCam = (keys: CamKey[], frame: number): CamState => {
  if (keys.length === 0) return {x: 0, y: 0, zoom: 1, rot: 0};
  if (frame <= keys[0].f) return camState(keys[0]);
  const last = keys[keys.length - 1];
  if (frame >= last.f) return camState(last);

  let i = 0;
  while (i < keys.length - 1 && frame > keys[i + 1].f) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const span = Math.max(1, b.f - a.f);
  const raw = clamp01((frame - a.f) / span);
  const t = b.spring
    ? springAt(raw, b.spring)
    : (b.ease ?? E.inOutCubic)(raw);
  const sa = camState(a);
  const sb = camState(b);
  return {
    x: lerp(sa.x, sb.x, t),
    y: lerp(sa.y, sb.y, t),
    zoom: lerp(sa.zoom, sb.zoom, t),
    rot: lerp(sa.rot, sb.rot, t),
  };
};

/** Add perpetual idle drift + shake so the camera is never dead still. */
export const livingCam = (
  base: CamState,
  frame: number,
  {driftAmp = 10, shake = []}: {driftAmp?: number; shake?: {at: number; strength: number}[]},
): CamState => {
  let dx = fbm1(11, frame / 70) * driftAmp;
  let dy = fbm1(12, frame / 58) * driftAmp * 0.8;
  let dr = fbm1(13, frame / 130) * 0.5;
  for (const s of shake) {
    const im = impact(frame, s.at, s.strength, 20, s.at | 0);
    dx += im.x;
    dy += im.y;
    dr += im.rot;
  }
  return {x: base.x + dx, y: base.y + dy, zoom: base.zoom, rot: base.rot + dr};
};

/** CSS transform for a parallax layer at given depth under this camera.
 *  cam.x/y are PAN offsets (content shifts by -cam.x*depth). To center content
 *  drawn at abs (Sx,Sy): cam.x = Sx - 960, cam.y = Sy - 540.
 *  depth 0 = infinitely far (barely moves), 1 = camera-locked (moves fully). */
export const layerTransform = (cam: CamState, depth: number, ox = 960, oy = 540) => {
  const s = 1 + (cam.zoom - 1) * depth;
  return (
    `translate(${-cam.x * depth}px, ${-cam.y * depth}px) ` +
    `translate(${ox}px, ${oy}px) rotate(${cam.rot * depth}deg) scale(${s}) translate(${-ox}px, ${-oy}px)`
  );
};
