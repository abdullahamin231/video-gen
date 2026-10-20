// Video format settings: the frame a job is made for and the defaults in video.config.json.
// Landscape is long-form 16:9; vertical is 9:16 for reels and shorts, with a length cap that warns, never fails.
import {readFile} from 'node:fs/promises';
import path from 'node:path';

export const FORMATS = {landscape: [1920, 1080], vertical: [1080, 1920], square: [1080, 1080]};
// `prepare --resolution` predates --format; keep its names working.
const ALIASES = {'1080p': 'landscape', portrait: 'vertical'};
export const DEFAULT_CONFIG = {format: 'landscape', length: null, verticalMaxSeconds: 90, fps: 30, channelTheme: null};

export function formatName(value) {
  const name = ALIASES[value] || value;
  if (!FORMATS[name]) throw new Error(`Unknown format "${value}". Use landscape or vertical.`);
  return name;
}

export async function loadConfig(root) {
  const file = process.env.VG_CONFIG ? path.resolve(root, process.env.VG_CONFIG) : path.join(root, 'video.config.json');
  let text;
  try { text = await readFile(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return {...DEFAULT_CONFIG}; throw e; }
  let config;
  try { config = JSON.parse(text); } catch (e) { throw new Error(`${path.basename(file)} is not valid JSON: ${e.message}`); }
  const unknown = Object.keys(config).filter(k => !(k in DEFAULT_CONFIG) && !k.startsWith('_'));
  if (unknown.length) throw new Error(`${path.basename(file)}: unknown setting ${unknown.join(', ')}. Known: ${Object.keys(DEFAULT_CONFIG).join(', ')}.`);
  const merged = {...DEFAULT_CONFIG, ...Object.fromEntries(Object.entries(config).filter(([k]) => !k.startsWith('_')))};
  merged.format = formatName(merged.format);
  if (merged.length !== null && !(Number(merged.length) > 0)) throw new Error(`${path.basename(file)}: "length" must be a number of seconds or null.`);
  if (merged.channelTheme !== null && (typeof merged.channelTheme !== 'string' || !merged.channelTheme.trim())) throw new Error(`${path.basename(file)}: "channelTheme" must be a path to a theme JSON file (e.g. "channel/theme.json") or null.`);
  if (!(Number(merged.verticalMaxSeconds) > 0)) throw new Error(`${path.basename(file)}: "verticalMaxSeconds" must be a positive number.`);
  return merged;
}

/** Turn start/prepare flags and config into the job's range, frame and fps. Throws on contradictions. */
export function resolveSettings(opts, config, sourceDuration) {
  const num = (v, label) => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`${label} must be a number.`); return n; };
  if (opts.length !== undefined && opts.duration !== undefined && Number(opts.length) !== Number(opts.duration))
    throw new Error('--length and --duration are the same setting; pass one.');
  if (opts.format && opts.resolution) throw new Error('--resolution is the old name of --format; pass one.');
  const start = opts.start === undefined ? 0 : num(opts.start, '--start'), asked = opts.length ?? opts.duration;
  // A length from video.config.json trims only recordings longer than it; a flag must fit the recording.
  const duration = asked !== undefined ? num(asked, '--length')
    : config.length ? Math.min(Number(config.length), sourceDuration - start) : sourceDuration - start;
  if (start < 0 || duration <= 0 || start + duration > sourceDuration + 0.01)
    throw new Error('Requested audio range lies outside the source recording.');
  const format = formatName(opts.format || opts.resolution || config.format);
  const fps = opts.fps === undefined ? Number(config.fps) : num(opts.fps, '--fps');
  if (![24, 30, 60].includes(fps)) throw new Error('--fps must be 24, 30, or 60.');
  const warnings = format === 'vertical' && duration > config.verticalMaxSeconds
    ? [`${duration.toFixed(1)} s is longer than the ${config.verticalMaxSeconds} s vertical cap (verticalMaxSeconds in video.config.json). Continuing; pass --length to cut an excerpt.`] : [];
  return {start, duration, format, width: FORMATS[format][0], height: FORMATS[format][1], fps, warnings};
}

export const isVertical = m => m.height > m.width;

/** Area of a vertical frame left clear by phone app chrome (title bar, caption and buttons, action rail). */
export function safeArea(m) {
  if (!isVertical(m)) return null;
  const W = m.width, H = m.height;
  return {x0: Math.round(W * 0.06), y0: Math.round(H * 0.11), x1: Math.round(W * 0.87), y1: Math.round(H * 0.80)};
}

/** Frame section for director and builder briefs. */
export function frameGuide(m) {
  const c = [m.width / 2, m.height / 2], lines = [`## The frame
- ${m.width}×${m.height}${isVertical(m) ? ' (vertical 9:16, watched full-screen on a phone)' : m.width === m.height ? ' (square)' : ' (landscape 16:9)'}. World units are pixels of this frame; the default view centre is [${c}].`];
  if (isVertical(m)) {
    const s = safeArea(m);
    lines.push(`- Phone apps draw a title bar at the top, a caption and buttons at the bottom and an action rail on the right.
  Keep text and the key subject inside x ${s.x0}–${s.x1}, y ${s.y0}–${s.y1}; backgrounds and motion may fill the whole frame.
- Stack, do not spread: comparisons go top and bottom, sequences flow downwards, one subject fills the width.
  Text lines are short because the frame is narrow; the size minimums are the same as in landscape.
- The first second decides whether anyone keeps watching: something visible happens at once, no slow build or title card.`);
  }
  return lines.join('\n');
}
