// Film plan (film.json) and shot spec (shots/<scene>.json) validation and compilation.
// Errors name the file, the JSON path and the fix, because weak models repair from error text.
// Errors are reserved for a film that is broken, untrue, not reproducible, or without a declared design theme.
// Everything else is guidance (warnings): agents may break it deliberately, and reviewers judge whether that served the film.
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {tokens, normalized} from './timing.mjs';
import {texToSvg} from './tex.mjs';
import {FONT_FAMILIES} from './world.mjs';

export const OBJECT_TYPES = {
  circle: ['at'], dot: ['at'], ellipse: ['at'], rect: ['at', 'size'], square: ['at'], arc: ['at'],
  line: ['from', 'to'], arrow: ['from', 'to'], path: ['d'], polyline: ['points'], polygon: ['points'], brace: ['from', 'to'],
  text: ['at', 'text'], tex: ['at', 'tex'], counter: ['at'],
  axes: ['at', 'size', 'x', 'y'], numberline: ['at', 'range'], plane: ['at', 'size', 'x', 'y'],
  graph: ['of', 'fn'], area: ['of', 'fn'], vector: ['to'], bars: ['of', 'values'],
  network: ['nodes'], particles: ['at'], group: ['at', 'children'], image: ['at', 'src', 'size'], svg: ['markup'],
  video: ['at', 'src', 'size'], manim: ['at', 'size', 'file', 'class'],
};
export const VERBS = ['create', 'draw', 'write', 'fadeIn', 'fadeOut', 'uncreate', 'show', 'hide', 'move', 'scale', 'grow', 'rotate',
  'color', 'set', 'count', 'camera', 'indicate', 'circumscribe', 'flash', 'pulse', 'transform', 'morph', 'replace', 'trace', 'retarget',
  'applyMatrix', 'flow', 'arrange', 'simulate', 'focus', 'unfocus', 'play', 'drop', 'pop', 'stamp', 'swing', 'strike', 'type', 'shake'];
const NO_TARGET = new Set(['camera', 'unfocus']);
const APPEAR = new Set(['create', 'draw', 'write', 'fadeIn', 'show', 'grow', 'play', 'trace', 'count', 'drop', 'pop', 'stamp', 'type']);
const EXIT = new Set(['fadeOut', 'hide', 'uncreate']);
const DEFAULT_DUR = {create: 1, draw: 1, write: 1, fadeIn: 0.6, fadeOut: 0.5, uncreate: 0.8, show: 0.001, hide: 0.001, move: 0.9, scale: 0.8, grow: 0.8,
  rotate: 0.8, color: 0.5, set: 0.6, count: 1.2, camera: 1.4, indicate: 0.8, circumscribe: 1.2, flash: 0.6, pulse: 0.6, transform: 0.9, morph: 0.9,
  replace: 0.9, trace: 1.5, retarget: 1, applyMatrix: 1.6, flow: 1.6, arrange: 1, simulate: 2, focus: 0.5, unfocus: 0.5, play: 0.001,
  drop: 0.7, pop: 0.5, stamp: 0.35, swing: 1.6, strike: 0.4, type: 1, shake: 0.5};
const ID = /^[a-z][a-z0-9-]*$/;
const AT = /^\s*(@prev|@after|start|end|[a-z][a-z0-9-]*|w\d+)\s*(?:([+-])\s*((?:\d+(?:\.\d+)?|\.\d+)))?\s*$/;

export class SpecError extends Error {
  constructor(errors, warnings = []) { super(errors.join('\n')); this.errors = errors; this.warnings = warnings; }
}
const present = v => typeof v === 'string' && v.trim().length > 0;
const isPoint = v => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);

// ---------------------------------------------------------------- cue resolution
function windowWords(alignment, start, end) { return alignment.words.filter(w => w.start >= start - 0.6 && w.start <= end); }
function matchAt(words, i, phrase) {
  return phrase.every((tok, k) => words[i + k] && (tok === normalized(words[i + k].text) || (words[i + k].scriptText && tok === normalized(words[i + k].scriptText))));
}
function suggest(alignment, phrase, start, end) {
  const target = phrase.join(' '), ws = windowWords(alignment, start, end), n = Math.max(1, phrase.length);
  let best = [];
  for (let i = 0; i + n <= ws.length; i++) {
    const cand = ws.slice(i, i + n).map(w => normalized(w.text)).join(' ');
    best.push({d: lev(target, cand), text: ws.slice(i, i + n).map(w => w.text).join(' '), at: ws[i].start});
  }
  best.sort((a, b) => a.d - b.d);
  return best.slice(0, 3).map(b => `"${b.text}" (${b.at.toFixed(2)}s)`).join(', ');
}
function lev(a, b) { const m = a.length, n = b.length, d = Array.from({length: m + 1}, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 1; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; }

/** Resolve a cue object inside [start, end] of the recording. Ambiguity inside the window picks the first match. */
export function resolveSceneCue(cue, alignment, duration, start, end, where, warnings) {
  if (typeof cue === 'string') cue = {phrase: cue};
  if (!cue || typeof cue !== 'object') throw new Error(`${where}: cue must be {"phrase": "..."} or a phrase string`);
  if (cue.boundary === 'start') return 0;
  if (cue.boundary === 'end') return duration;
  let first, last;
  if (cue.wordId) {
    first = last = alignment.words.find(w => w.id === cue.wordId);
    if (!first) throw new Error(`${where}: unknown wordId ${cue.wordId}`);
  } else {
    const phrase = tokens(cue.phrase || '').map(normalized);
    if (!phrase.length) throw new Error(`${where}: cue needs "phrase" (words spoken in the recording) or "wordId"`);
    const words = alignment.words, inWindow = [], anywhere = [];
    for (let i = 0; i < words.length; i++) if (matchAt(words, i, phrase)) {
      anywhere.push(i);
      if (words[i].start >= start - 0.6 && words[i].start <= end) inWindow.push(i);
    }
    let pick = inWindow;
    if (!pick.length) {
      if (anywhere.length) throw new Error(`${where}: "${cue.phrase}" is spoken at ${anywhere.map(i => words[i].start.toFixed(2) + 's').join(', ')}, outside this scene (${start.toFixed(2)}–${end.toFixed(2)}s). Use a phrase spoken inside the scene.`);
      throw new Error(`${where}: "${cue.phrase}" is not in the recording. Closest spoken words in this scene: ${suggest(alignment, phrase, start, end) || '(none)'}. Copy words exactly from the word table.`);
    }
    if (cue.occurrence != null) {
      if (!Number.isInteger(cue.occurrence) || cue.occurrence < 1 || cue.occurrence > pick.length) throw new Error(`${where}: occurrence ${cue.occurrence} invalid; "${cue.phrase}" occurs ${pick.length}× in this scene`);
      pick = [pick[cue.occurrence - 1]];
    } else if (pick.length > 1 && warnings) warnings.push(`${where}: "${cue.phrase}" occurs ${pick.length}× in this scene; using the first (${words[pick[0]].start.toFixed(2)}s). Add "occurrence" to choose another.`);
    first = words[pick[0]]; last = words[pick[0] + phrase.length - 1];
  }
  const offset = cue.offset ?? 0;
  if (!Number.isFinite(offset)) throw new Error(`${where}: offset must be a number of seconds`);
  const value = (cue.edge === 'end' ? last.end : first.start) + offset;
  return Math.max(0, Math.min(duration, Number(value.toFixed(3))));
}

// ---------------------------------------------------------------- film plan
const OWNERS = ['director', 'builder'];
/** Who builds a scene: its "owner", else the director up to and including the prototype and builders after it. */
export function sceneOwner(film, id) {
  const i = film.scenes.findIndex(s => s.id === id);
  if (film.scenes[i]?.owner) return film.scenes[i].owner;
  const p = film.scenes.findIndex(s => s.id === film.prototype);
  return p < 0 || i <= p ? 'director' : 'builder';
}

export function validateFilm(film, alignment, duration) {
  const errors = [], warnings = [], F = 'film.json';
  if (!film || typeof film !== 'object') throw new SpecError([`${F}: not a JSON object`]);
  if (film.version !== 2) errors.push(`${F}: set "version": 2`);
  for (const k of ['title', 'concept']) if (!present(film[k])) errors.push(`${F}: "${k}" is required (a non-empty string)`);
  if (!Array.isArray(film.alternatives) || film.alternatives.length < 2 || film.alternatives.some(a => !present(a?.concept) || !present(a?.rejected)))
    warnings.push(`${F}: "alternatives" should record ≥2 other whole-film concepts {"concept", "rejected"}; choosing among real alternatives is how the concept gets better`);
  if (film.subjects != null && !Array.isArray(film.subjects)) errors.push(`${F}: "subjects" must be a list of recurring subjects [{"id","what"}]`);
  const subjects = new Set((film.subjects || []).map(s => s.id));
  for (const [i, s] of (film.subjects || []).entries()) if (!ID.test(s?.id || '') || !present(s?.what)) errors.push(`${F}: subjects[${i}] needs kebab-case "id" and "what"`);
  if (!Array.isArray(film.scenes) || !film.scenes.length) { errors.push(`${F}: "scenes" must be a non-empty array`); throw new SpecError(errors, warnings); }
  const ids = new Set(), resolved = [];
  film.scenes.forEach((s, i) => {
    const W = `${F} scenes[${i}]${s?.id ? ` (${s.id})` : ''}`;
    if (!ID.test(s?.id || '') || ids.has(s.id)) errors.push(`${W}: "id" must be unique kebab-case`); ids.add(s?.id);
    if (!present(s?.idea)) errors.push(`${W}: "idea" is required (what the narration says here)`);
    if (s?.owner != null && !OWNERS.includes(s.owner)) errors.push(`${W}: "owner" is "director" or "builder"`);
    const delegated = sceneOwner(film, s?.id) === 'builder';
    for (const k of ['mechanism', 'payoff', 'handoff']) if (!present(s?.[k]) && delegated) warnings.push(`${W}: no "${k}". A builder makes this scene; write down the intent you want them to start from.`);
    if (s?.states != null && !Array.isArray(s.states)) errors.push(`${W}: "states" is a list of visible states`);
    if (s?.alternatives != null && !Array.isArray(s.alternatives)) errors.push(`${W}: "alternatives" is a list`);
    if (s?.assets != null && (!Array.isArray(s.assets) || s.assets.some(a => typeof a !== 'string'))) errors.push(`${W}: "assets" is a list of files, e.g. ["assets/dgx-spark.png"]`);
    for (const c of s?.carry || []) if (!subjects.has(c)) errors.push(`${W}: carry "${c}" is not listed in film.json "subjects"`);
    if (s?.kind && !['shots', 'html'].includes(s.kind)) errors.push(`${W}: "kind" is "shots" (default) or "html"`);
    if (s?.kind === 'html' && !/^compositions\/[a-z0-9-]+\.html$/.test(s.file || '')) errors.push(`${W}: html scenes need "file": "compositions/<name>.html"`);
    if (s?.region && (!isPoint(s.region.center) || (s.region.zoom != null && !(s.region.zoom > 0)))) errors.push(`${W}: "region" is {"center": [x, y], "zoom": 1}`);
    let start = 0;
    if (i === 0) { if (s?.start && !(s.start.boundary === 'start')) warnings.push(`${W}: the first scene always starts at 0`); }
    else {
      try { start = resolveSceneCue(s?.start, alignment, duration, 0, duration, `${W} start`, null); }
      catch (error) { errors.push(error.message); start = NaN; }
    }
    resolved.push({id: s?.id, start});
  });
  for (let i = 0; i < resolved.length; i++) {
    resolved[i].end = i + 1 < resolved.length ? resolved[i + 1].start : duration;
    const d = resolved[i].end - resolved[i].start;
    if (Number.isFinite(d) && d <= 0.5) errors.push(`${F} scenes[${i}] (${resolved[i].id}): starts after the next scene; order scenes by time (${resolved[i].start.toFixed(2)}s → ${resolved[i].end.toFixed(2)}s)`);
    else if (d > 45) warnings.push(`${F} scenes[${i}] (${resolved[i].id}): ${d.toFixed(1)}s long; split long passages into several scenes`);
    else if (d < 3) warnings.push(`${F} scenes[${i}] (${resolved[i].id}): only ${d.toFixed(1)}s; consider merging with a neighbour`);
  }
  if (!ids.has(film.prototype)) errors.push(`${F}: "prototype" must name the scene to build and review first (the most demanding 10–15 s passage)`);
  validateTheme(film, errors, warnings);
  if (errors.length) throw new SpecError(errors, warnings);
  return {scenes: resolved.map(r => ({...r, duration: Number((r.end - r.start).toFixed(3))})), warnings};
}

// ---------------------------------------------------------------- design theme
// The one hard design requirement: the film declares ONE design theme and every scene is made in it.
// Which theme is the director's choice; nothing about its look is prescribed here.
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const ROLE_COLOURS = ['white', 'grey', 'dim', 'faint', 'blue', 'yellow', 'red', 'green'];
const isColour = v => typeof v === 'string' && (HEX.test(v) || /^(rgb|hsl)a?\(/i.test(v));
function validateTheme(film, errors, warnings) {
  const F = 'film.json', T = film.theme;
  if (!T || typeof T !== 'object' || Array.isArray(T)) {
    errors.push(`${F}: "theme" is required: the film's one design theme (see the director brief). Give at least "name", "description", "bg" and "colors".`);
    return;
  }
  if (!present(T.name)) errors.push(`${F} theme: "name" is required (a short name for the look, e.g. "chunky shop-shelf stickers")`);
  if (!present(T.description) || T.description.trim().split(/\s+/).length < 12) errors.push(`${F} theme: "description" is required: at least a few sentences on the look and feel (subjects and imagery, surfaces, line weight, shapes, typography, colour use, motion personality, composition)`);
  if (!isColour(T.bg)) errors.push(`${F} theme: "bg" must be a colour like "#101214"`);
  const colours = T.colors && typeof T.colors === 'object' ? T.colors : null;
  if (!colours || Object.keys(colours).length < 2) errors.push(`${F} theme: "colors" must name at least 2 colours, e.g. {"white": "#f2f2f2", "yellow": "#ffd23f"}`);
  else {
    for (const [k, v] of Object.entries(colours)) if (!isColour(v)) errors.push(`${F} theme.colors.${k}: must be a colour value like "#ffd23f", got ${JSON.stringify(v)}`);
    const missing = ROLE_COLOURS.filter(k => !(k in colours));
    if (missing.length) warnings.push(`${F} theme.colors: no ${missing.join(', ')}. Built-in objects and verbs fall back to these names (e.g. "white" is the default ink, "red" the strike line, "yellow" highlights); map each to a colour of your palette so nothing falls back to the kit's defaults.`);
  }
  if (T.meanings != null && typeof T.meanings !== 'object') errors.push(`${F} theme: "meanings" maps colour names to what they mean`);
  else if (!T.meanings || !Object.keys(T.meanings).length) warnings.push(`${F} theme: add "meanings" ({"yellow": "money", ...}): a colour that means one thing throughout lets the viewer read it without a label`);
  if (!present(T.rejected)) warnings.push(`${F} theme: add "rejected": another theme you considered for this film and why it lost`);
  if (film.palette) warnings.push(`${F}: "palette" is replaced by theme.meanings; move it there`);
  const fileFamilies = new Set((T.fontFiles || []).map(f => f?.family));
  for (const [i, f] of (T.fontFiles || []).entries()) if (!present(f?.family) || !/^assets\/fonts\/[\w.-]+\.(woff2?|ttf|otf)$/.test(f?.src || '')) errors.push(`${F} theme.fontFiles[${i}]: needs "family" and "src": "assets/fonts/<file>.woff2" (put the file there)`);
  for (const [role, fam] of Object.entries(T.fonts || {})) if (typeof fam !== 'string' || (!FONT_FAMILIES[fam] && !fileFamilies.has(fam) && !/[,'"]/.test(fam)))
    errors.push(`${F} theme.fonts.${role}: "${fam}" is not bundled. Bundled: ${Object.keys(FONT_FAMILIES).join(', ')}; or ship the font in "fontFiles".`);
  for (const k of ['stroke', 'corner', 'fillOpacity']) if (T[k] != null && !(Number.isFinite(T[k]) && T[k] >= 0)) errors.push(`${F} theme.${k}: must be a number ≥ 0`);
  if (T.shadow != null && (typeof T.shadow !== 'object' || Array.isArray(T.shadow))) errors.push(`${F} theme.shadow: {"dx", "dy", "blur", "color", "opacity"}`);
  if (T.defaults != null && (typeof T.defaults !== 'object' || Array.isArray(T.defaults))) errors.push(`${F} theme.defaults: maps an object type to default fields, e.g. {"rect": {"corner": 14, "shadow": true}}`);
  if (T.eases != null && (typeof T.eases !== 'object' || Array.isArray(T.eases))) errors.push(`${F} theme.eases: maps ease names to GSAP eases, e.g. {"out": "back.out(1.4)"}`);
}
function themeVocabulary(theme) {
  const colours = new Set(['bg', 'none', 'transparent', 'currentColor']), fonts = new Set(['sans', 'serif', 'mono']);
  for (const [k, v] of Object.entries(theme?.colors || {})) { colours.add(k); colours.add(String(v).toLowerCase()); }
  for (const v of [theme?.bg, theme?.fg]) if (v) colours.add(String(v).toLowerCase());
  for (const [k, v] of Object.entries(theme?.fonts || {})) { fonts.add(k); fonts.add(v); }
  for (const f of theme?.fontFiles || []) fonts.add(f.family);
  return {colours, fonts};
}
function offTheme(o, vocab) {
  const out = [], seen = v => typeof v === 'string' && !vocab.colours.has(v) && !vocab.colours.has(v.toLowerCase());
  for (const v of [o.color, typeof o.fill === 'string' ? o.fill : null, o.label?.color, o.axisColor, o.edgeColor, o.cursorColor, o.frame?.fill, o.frame?.color,
    ...(Array.isArray(o.colors) ? o.colors : []), ...(o.nodes || []).map(n => n?.color)]) if (v != null && seen(v)) out.push(`colour "${v}"`);
  if (o.do === 'color' && seen(o.to)) out.push(`colour "${o.to}"`);
  for (const v of Object.values(o.props || {})) if (typeof v === 'string' && isColour(v) && seen(v)) out.push(`colour "${v}"`);
  for (const f of [o.font, o.label?.font]) if (f && !vocab.fonts.has(f)) out.push(`font "${f}"`);
  return out;
}

// ---------------------------------------------------------------- shots
function numbersIn(text) { return (String(text).match(/\d[\d,]*(?:\.\d+)?/g) || []).map(n => Number(n.replace(/,/g, ''))).filter(Number.isFinite); }
const SMALL = {zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90};
const SCALE = {hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12, k: 1e3, m: 1e6, b: 1e9};
export function sourceNumbers(text) {
  const out = new Set();
  const lower = String(text).toLowerCase();
  for (const m of lower.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k|m|b|thousand|million|billion|trillion|hundred)?\b/g)) {
    const n = Number(m[1].replace(/,/g, '')); out.add(n); if (m[2]) out.add(n * SCALE[m[2]]);
  }
  let cur = null, total = 0;
  for (const w of lower.split(/[^a-z]+/)) {
    if (w in SMALL) cur = (cur ?? 0) + SMALL[w];
    else if (w in SCALE && w.length > 1 && cur != null) { if (SCALE[w] === 100) cur *= 100; else { total += cur * SCALE[w]; cur = 0; } }
    else if (w === 'and' && cur != null) continue;
    else { if (cur != null || total) { out.add(total + (cur ?? 0)); } cur = null; total = 0; }
  }
  for (const n of [...out]) { out.add(Math.round(n * 100) / 100); }
  return out;
}
const numberKnown = (n, known) => known.has(n) || [...known].some(k => Math.abs(k - n) < 1e-9 || (k !== 0 && Math.abs(k - n) / Math.abs(k) < 0.005));

function checkObject(o, where, errors, warnings) {
  if (!o || typeof o !== 'object') { errors.push(`${where}: object must be a JSON object`); return; }
  if (!ID.test(o.id || '')) errors.push(`${where}: "id" must be kebab-case (letters, digits, dashes), got ${JSON.stringify(o.id)}`);
  const req = OBJECT_TYPES[o.type];
  if (!req && !o.__component) { errors.push(`${where}: unknown type "${o.type}". Built-in types: ${Object.keys(OBJECT_TYPES).join(', ')}. For a custom component put it in components/${o.type}.js`); return; }
  for (const k of req || []) if (o[k] == null) errors.push(`${where} (${o.type} ${o.id}): missing "${k}"`);
  for (const k of ['at', 'from', 'to']) if (o[k] != null && !isPoint(o[k]) && !(k === 'to' && o.type === 'vector' && isPoint(o[k]))) errors.push(`${where} (${o.id}): "${k}" must be [x, y] numbers`);
  const fontSized = ['text', 'tex', 'counter'].includes(o.type);
  if (o.size != null && fontSized && !(Number.isFinite(o.size) && o.size > 0)) errors.push(`${where} (${o.id}): "size" of ${o.type} is a font size in px (a number)`);
  if (o.size != null && !fontSized && !(isPoint(o.size) && o.size.every(v => v > 0))) errors.push(`${where} (${o.id}): "size" must be [width, height]`);
  for (const k of ['x', 'y', 'range']) if (o[k] != null && (!Array.isArray(o[k]) || o[k].length < 2 || !o[k].every(Number.isFinite) || o[k][1] <= o[k][0])) errors.push(`${where} (${o.id}): "${k}" must be [min, max, step] with max > min`);
  if ((o.type === 'polyline' || o.type === 'polygon') && (!Array.isArray(o.points) || o.points.length < 2 || !o.points.every(isPoint))) errors.push(`${where} (${o.id}): "points" must be [[x,y], ...]`);
  if ((o.type === 'graph' || o.type === 'area') && present(o.fn)) { try { const f = new Function('Math', `"use strict"; return (${o.fn});`)(Math); if (typeof f !== 'function' || !Number.isFinite(Number(f(0.5)))) throw new Error('not a numeric function'); } catch (e) { errors.push(`${where} (${o.id}): "fn" must be a JS arrow function string like "x => Math.sin(x)": ${e.message}`); } }
  if (o.type === 'text') {
    const size = o.size ?? 32;
    if (size < 28 && o.layer !== 'decor') warnings.push(`${where} (${o.id}): text size ${size} < 28 px is hard to read on phones; fine for non-essential texture`);
    const words = String(o.text ?? '').split(/\s+/).filter(Boolean).length;
    if (words > 9) warnings.push(`${where} (${o.id}): ${words}-word text. The narration already says the sentence; keep on-screen text to labels and key terms.`);
  }
  if (o.type === 'counter' && (o.size ?? 48) < 40) warnings.push(`${where} (${o.id}): counter/value size below 40 px is hard to read on phones`);
  if (o.type === 'counter' && o.value === 0 && !o.numbers) warnings.push(`${where} (${o.id}): counter starts at 0. Unknown values start from the placeholder (omit "value").`);
  if (o.label != null && typeof o.label !== 'string' && !present(o.label?.text)) errors.push(`${where} (${o.id}): "label" is a string or {"text", "side", "size"}`);
  if (o.label?.size != null && o.label.size < 28) warnings.push(`${where} (${o.id}): label size ${o.label.size} < 28 px is hard to read on phones`);
  if (o.type === 'group') (o.children || []).forEach((c, i) => checkObject(c, `${where}.children[${i}]`, errors, warnings));
  if (o.type === 'network') for (const [i, n] of (o.nodes || []).entries()) if (!ID.test(n?.id || '') || !isPoint(n?.at)) errors.push(`${where} (${o.id}): nodes[${i}] needs kebab "id" and "at"`);
}
function flatten(objects) { const out = []; const walk = list => { for (const o of list || []) { out.push(o); if (o.type === 'group') walk(o.children); } }; walk(objects); return out; }

function parseAt(at, where) {
  if (typeof at === 'number') throw new Error(`${where}: "at" must reference a cue ("cueName", "cueName+0.4", "@after", "@prev+0.2"), not a literal time ${at}`);
  const m = AT.exec(String(at ?? ''));
  if (!m) throw new Error(`${where}: cannot read "at": ${JSON.stringify(at)}. Use "cueName", "cueName+0.4", "cueName-0.3", "@prev", "@after+0.2"`);
  return {ref: m[1], offset: m[2] ? (m[2] === '-' ? -1 : 1) * Number(m[3]) : 0};
}

/** Validate and compile all scenes into one world spec. Returns {world, timing, warnings}. */
export async function compileFilm(job, film, alignment, manifest, {allowMissing = false, onlyScene = null} = {}) {
  const duration = manifest.duration, {scenes: bounds, warnings} = validateFilm(film, alignment, duration);
  const errors = [], world = {width: manifest.width, height: manifest.height, duration, theme: film.theme || {}, camera: film.camera || null, objects: [], actions: [], scenes: [], hooks: [], components: [], media: []};
  const known = new Set([...sourceNumbers(alignment.words.map(w => w.text).join(' ')), ...sourceNumbers(await readFile(path.join(job, 'inputs/narration.txt'), 'utf8').catch(() => ''))]);
  const allIds = new Map(), componentTypes = new Set(), missing = [], vocab = themeVocabulary(film.theme);
  const componentFiles = await readdir(path.join(job, 'components')).catch(() => []);
  for (const f of componentFiles) if (f.endsWith('.js')) componentTypes.add(f.slice(0, -3));
  const timingScenes = [];
  let order = 0;
  const shotsByScene = new Map();
  for (const [si, scene] of film.scenes.entries()) {
    const b = bounds[si], file = `shots/${scene.id}.json`, cues = {start: b.start, end: b.end};
    const timingScene = {id: scene.id, start: b.start, end: b.end, duration: b.duration, file: 'compositions/world.html', purpose: scene.idea, kind: scene.kind || 'shots', beats: [], holds: []};
    timingScenes.push(timingScene);
    if (scene.kind === 'html') { world.scenes.push({id: scene.id, start: b.start, end: b.end, cues}); continue; }
    let shot;
    try { shot = JSON.parse(await readFile(path.join(job, file), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') { missing.push(scene.id); if (!allowMissing) errors.push(`${file}: missing. Build scene "${scene.id}".`); world.scenes.push({id: scene.id, start: b.start, end: b.end, cues, missing: true}); continue; }
      errors.push(`${file}: invalid JSON: ${error.message}`); continue;
    }
    shotsByScene.set(scene.id, shot);
    if (shot.scene !== scene.id) errors.push(`${file}: "scene" must be "${scene.id}"`);
    if (present(shot.notes)) timingScene.notes = shot.notes;
    for (const [name, cue] of Object.entries(shot.cues || {})) {
      if (!ID.test(name) || ['start', 'end'].includes(name)) { errors.push(`${file} cues.${name}: cue names are kebab-case and not "start"/"end" (those are built in)`); continue; }
      try { cues[name] = resolveSceneCue(cue, alignment, duration, b.start, b.end, `${file} cues.${name}`, warnings); }
      catch (error) { errors.push(error.message); }
    }
    for (const [name, at] of Object.entries(cues)) timingScene.beats.push({id: name, at, localAt: Number((at - b.start).toFixed(3)), duration: 0, targets: []});
    const objects = flatten(shot.objects);
    for (const o of objects) if (o && componentTypes.has(o.type)) o.__component = true;
    (shot.objects || []).forEach((o, i) => checkObject(o, `${file} objects[${i}]`, errors, warnings));
    for (const o of objects) {
      if (o.type && componentTypes.has(o.type)) { o.__component = true; world.components.push(o.type); }
      if (!o.id) continue;
      if (allIds.has(o.id)) errors.push(`${file}: object id "${o.id}" is already defined in ${allIds.get(o.id)}. Ids are global across the film; reuse the existing object instead of redefining it.`);
      allIds.set(o.id, file);
      if ((o.type === 'image' || o.type === 'video') && present(o.src)) {
        if (!/^assets\/[\w./-]+$/.test(o.src) || o.src.includes('..')) errors.push(`${file} (${o.id}): "src" must be a file under assets/, e.g. "assets/dgx-spark.png" (bring files in with: npm run video -- asset --src <url|file> --name <name>)`);
        else if (await readFile(path.join(job, o.src)).then(() => false, () => true)) errors.push(`${file} (${o.id}): ${o.src} does not exist. Bring it in with: npm run video -- asset --job <job> --src <url|file> --name ${path.basename(o.src)}`);
      }
      if (o.visible && !o.persist && !(shot.objects || []).some(p => p.type === 'group' && p.visible && (p.children || []).includes(o)))
        warnings.push(`${file} (${o.id}): "visible": true puts it on screen fully built. Let it arrive with motion on its cue (create, drop, pop, type, grow...), or keep it and say why in "notes".`);
      const off = offTheme(o, vocab);
      if (off.length) warnings.push(`${file} (${o.id}): ${off.join(', ')} is outside the film's theme. Use a name from film.json theme.colors/fonts, or add it to the theme so every scene can share it.`);
      if (o.type === 'tex' && present(o.tex)) { try { o.svg = texToSvg(o.tex); } catch (error) { errors.push(`${file} (${o.id}): ${error.message}`); } }
      for (const s of [o.text, o.tex, o.value, ...(o.values || []), ...(o.nodes || []).map(n => n.label)]) if (s != null && !o.numbers) for (const n of numbersIn(s)) if (!numberKnown(n, known))
        errors.push(`${file} (${o.id}): displays ${n}, which is not in the narration or script. Use only sourced numbers, or add "numbers": "<why this explanatory value is needed>" to the object.`);
      if (o.type === 'manim') {
        o.src = `assets/manim/${o.id}.webm`;
        world.media.push({id: o.id, file: o.file, scene: scene.id, className: o.class, kind: 'manim'});
      }
    }
    // actions
    let prevStart = b.start, prevEnd = b.start;
    (shot.actions || []).forEach((a, i) => {
      const where = `${file} actions[${i}]${a?.do ? ` (${a.do})` : ''}`;
      if (!a || typeof a !== 'object') { errors.push(`${where}: action must be an object`); return; }
      if (!VERBS.includes(a.do) && !(a.do && componentTypes.size)) { errors.push(`${where}: unknown verb "${a.do}". Verbs: ${VERBS.join(', ')}`); return; }
      let t;
      try {
        const at = parseAt(a.at, where);
        const base = at.ref === '@prev' ? prevStart : at.ref === '@after' ? prevEnd : cues[at.ref];
        if (base == null) throw new Error(`${where}: "at" uses unknown cue "${at.ref}". Cues in this shot: ${Object.keys(cues).join(', ')}. Define it in "cues".`);
        t = Number((base + at.offset).toFixed(3));
      } catch (error) { errors.push(error.message); return; }
      const dur = a.dur ?? a.duration ?? DEFAULT_DUR[a.do] ?? 0.8;
      if (!(dur > 0) || dur > 30) errors.push(`${where}: "dur" must be seconds > 0`);
      if (t < b.start - 0.6 || t > b.end + 0.01) errors.push(`${where}: starts at ${t.toFixed(2)}s, outside scene ${scene.id} (${b.start.toFixed(2)}–${b.end.toFixed(2)}s)`);
      else if (t + dur > b.end + 1.5 && !EXIT.has(a.do)) warnings.push(`${where}: runs ${(t + dur - b.end).toFixed(2)}s past the scene end`);
      const offA = offTheme(a, vocab);
      if (offA.length) warnings.push(`${where}: ${offA.join(', ')} is outside the film's theme. Use a name from film.json theme.colors, or add it to the theme.`);
      const targets = Array.isArray(a.target) ? a.target : a.target != null ? [a.target] : [];
      if (!NO_TARGET.has(a.do) && !targets.length) errors.push(`${where}: "target" is required (an object id, "id.part", or a list)`);
      for (const ref of targets) { const id = String(ref).split('.')[0]; if (!allIds.has(id) && !world.objects.some(o => o.id === id) && !objects.some(o => o.id === id) && !/-label$/.test(id)) errors.push(`${where}: target "${ref}" is not defined. Defined objects: ${[...allIds.keys()].slice(-25).join(', ')}`); }
      if (a.into && !allIds.has(String(a.into).split('.')[0])) errors.push(`${where}: "into" object "${a.into}" is not defined`);
      if (a.do === 'count') { if (!Number.isFinite(a.to)) errors.push(`${where}: count needs numeric "to"`); else if (!numberKnown(a.to, known) && !a.numbers) errors.push(`${where}: counts to ${a.to}, which is not in the narration or script`); }
      if (['transform', 'morph', 'replace'].includes(a.do) && !a.into) errors.push(`${where}: transform needs "into": the object it becomes`);
      if (a.do === 'move' && !a.to && !a.by && !a.along) errors.push(`${where}: move needs "to", "by" or "along"`);
      if (a.do === 'camera' && !a.center && !a.focus && a.zoom == null) errors.push(`${where}: camera needs "center", "focus" or "zoom"`);
      const {at: _at, dur: _dur, duration: _d2, ...rest} = a; void _at; void _dur; void _d2;
      world.actions.push({...rest, t, dur, order: order++, scene: scene.id, source: where});
      prevStart = t; prevEnd = t + dur;
    });
    for (const [i, h] of (shot.holds || []).entries()) {
      try { const a = parseAt(h.from, `${file} holds[${i}]`), z = parseAt(h.to, `${file} holds[${i}]`); const s = cues[a.ref] + a.offset, e = cues[z.ref] + z.offset; if (!present(h.reason) || !(e > s)) throw new Error(`${file} holds[${i}]: needs "from", "to" cue refs and a "reason"`); timingScene.holds.push({start: s, end: e, reason: h.reason}); }
      catch (error) { errors.push(error.message); }
    }
    for (const o of shot.objects || []) world.objects.push({...o, scene: scene.id});
    // "visible" means visible at THIS scene's start, never an early leak from
    // a later scene into the unbuilt opening of a prototype render.
    if (b.start > 0) for (const o of world.objects.filter(o => o.scene === scene.id && o.visible)) {
      o.visible = false;
      world.actions.push({do: 'show', target: o.id, t: b.start, dur: 0.001, order: -1, scene: scene.id, auto: true, source: `initial visibility for ${scene.id}`});
    }
    if (shot.hook) {
      if (!/^shots\/[a-z0-9-]+\.hook\.js$/.test(shot.hook)) errors.push(`${file}: "hook" must be "shots/${scene.id}.hook.js"`);
      else {
        const src = await readFile(path.join(job, shot.hook), 'utf8').catch(() => null);
        if (src == null) errors.push(`${file}: hook file ${shot.hook} is missing`);
        else {
          lintCode(src, shot.hook, errors);
          if (!src.includes(`VG.hook('${scene.id}'`) && !src.includes(`VG.hook("${scene.id}"`)) errors.push(`${shot.hook}: must call VG.hook('${scene.id}', k => { ... })`);
          world.hooks.push({file: shot.hook, src});
        }
      }
    }
    if (scene.region) { // move the camera to the scene's region unless the shot already frames it
      const framed = world.actions.some(a => a.scene === scene.id && a.do === 'camera' && a.t < b.start + 1.0);
      if (si === 0 && !film.camera) world.camera = {center: scene.region.center, zoom: scene.region.zoom ?? 1};
      else if (!framed) world.actions.push({do: 'camera', center: scene.region.center, zoom: scene.region.zoom ?? 1, t: Number(Math.max(0, b.start - 0.3, ...world.actions.filter(a => a.do === 'camera').map(a => a.t + a.dur + 0.01)).toFixed(3)), dur: 1.3, order: order++, scene: scene.id, auto: true, source: `region camera for ${scene.id}`});
    }
    world.scenes.push({id: scene.id, start: b.start, end: b.end, cues});
  }
  // media timing: a manim/video object plays from its first appearance action
  for (const o of world.objects) if (o.type === 'manim' || o.type === 'video') {
    const first = world.actions.filter(a => (Array.isArray(a.target) ? a.target : [a.target]).includes(o.id) && APPEAR.has(a.do)).sort((p, q) => p.t - q.t)[0];
    if (!first) { errors.push(`${allIds.get(o.id)} (${o.id}): ${o.type} needs a "play" (or fadeIn) action to set when it starts`); continue; }
    o.mediaStart = first.t; o.mediaDuration = Number((o.clipDuration ?? (film.scenes.find(s => s.id === o.scene) ? bounds[film.scenes.findIndex(s => s.id === o.scene)].end - first.t : 5)).toFixed(3));
    const m = world.media.find(x => x.id === o.id); if (m) Object.assign(m, {start: first.t, cues: Object.fromEntries(Object.entries(world.scenes.find(s => s.id === o.scene)?.cues || {}).map(([k, v]) => [k, Number((v - first.t).toFixed(3))]))});
  }
  // components
  world.components = [...new Set(world.components)];
  const componentSrc = [];
  for (const type of world.components) {
    const src = await readFile(path.join(job, 'components', `${type}.js`), 'utf8');
    lintCode(src, `components/${type}.js`, errors);
    if (!src.includes(`VG.component('${type}'`) && !src.includes(`VG.component("${type}"`)) errors.push(`components/${type}.js: must call VG.component('${type}', {build(o, k) {...}, verbs: {...}})`);
    componentSrc.push({file: `components/${type}.js`, src});
  }
  world.componentSrc = componentSrc;
  // auto exits: subjects not carried into the next scene leave at the handoff
  autoExits(world, film, bounds, shotsByScene, warnings);
  // dynamic check: objects that are simply there, or switched on, instead of arriving with motion
  for (const a of world.actions) if (a.do === 'show' && !a.auto) warnings.push(`${a.source}: "show" makes ${JSON.stringify(a.target)} appear instantly. Use an arrival with motion (create, drop, pop, type, grow...) unless the instant cut is deliberate.`);
  // choreography check
  const verbsUsed = new Set(world.actions.filter(a => !a.auto).map(a => a.do));
  if (world.actions.length >= 10 && [...verbsUsed].every(v => ['create', 'draw', 'write', 'fadeIn', 'fadeOut', 'drop', 'pop', 'flow', 'camera', 'show', 'hide'].includes(v)))
    warnings.push('Every action is an entrance, exit, flow or camera move. Nothing changes state once it is on screen (strike, stamp, count, transform, move, swing, retarget...): show what happens to the subjects, not only their arrival.');
  if (errors.length) throw new SpecError(errors, warnings);
  return {world, timing: {version: 2, duration, scenes: timingScenes, warnings, missing}, warnings, missing};
}

function lintCode(src, file, errors) {
  if (/Math\.random\s*\(|Date\.now\s*\(|performance\.now|requestAnimationFrame|setTimeout|setInterval|new Date\(/.test(src)) errors.push(`${file}: no clocks or randomness (Math.random, Date.now, timers). Use k.rng(seed) and the timeline.`);
  const literal = /\b(?:tl|k\.tl)\.(?:to|from|fromTo|set|call|add)\((?:[^()]|\([^()]*\))*?,\s*-?\d+(?:\.\d+)?\s*\)/g;
  for (const m of src.matchAll(literal)) errors.push(`${file}: literal timeline time in \`${m[0].slice(0, 70)}\`. Use k.cue('name', offset) or the time passed to the verb.`);
  if (/\.(?:play|pause|resume|restart)\s*\(/.test(src)) errors.push(`${file}: do not play/pause timelines; the renderer seeks the paused timeline.`);
}

function autoExits(world, film, bounds, shotsByScene, warnings) {
  const byId = new Map(world.objects.map(o => [o.id, o]));
  for (let i = 0; i < film.scenes.length - 1; i++) {
    const scene = film.scenes[i], next = film.scenes[i + 1], nextShot = shotsByScene.get(next.id);
    if (scene.kind === 'html') continue;
    const carry = new Set(next.carry || []);
    const refsNext = new Set((nextShot?.actions || []).flatMap(a => [...(Array.isArray(a.target) ? a.target : [a.target]), a.into, a.focus].flat().filter(Boolean).map(r => String(r).split('.')[0])));
    for (const o of nextShot?.objects || []) if (o.of) refsNext.add(o.of);
    const start = bounds[i + 1].start;
    const visibleAt = id => { // compile-time estimate of visibility at the handoff
      let vis = !!byId.get(id)?.visible;
      for (const a of world.actions.filter(a => a.t < start).sort((p, q) => p.t - q.t)) {
        const ts = (Array.isArray(a.target) ? a.target : [a.target]).filter(Boolean).map(String);
        if (ts.includes(id) && APPEAR.has(a.do)) vis = true;
        if (ts.includes(id) && EXIT.has(a.do)) vis = false;
        if (['transform', 'morph', 'replace'].includes(a.do) && ts.includes(id)) vis = false;
        if (['transform', 'morph', 'replace'].includes(a.do) && String(a.into).split('.')[0] === id) vis = true;
      }
      return vis;
    };
    const exits = [];
    for (const o of world.objects) {
      if (o.of || o.persist || carry.has(o.id) || refsNext.has(o.id)) continue;
      if (!visibleAt(o.id)) continue;
      exits.push(o.id);
    }
    // Each subject leaves after its own last action (never in the middle of a transform), close to the handoff.
    const groups = new Map();
    for (const id of exits) {
      const lastEnd = Math.max(0, ...world.actions.filter(a => a.t < start + 0.6 && !a.auto && ((Array.isArray(a.target) ? a.target : [a.target]).map(r => String(r).split('.')[0]).includes(id) || String(a.into || '').split('.')[0] === id)).map(a => a.t + a.dur));
      const t = Number(Math.min(start + 0.8, Math.max(bounds[i].start, start - 0.35, lastEnd + 0.05)).toFixed(3));
      if (!groups.has(t)) groups.set(t, []); groups.get(t).push(id);
    }
    for (const [t, ids] of groups) world.actions.push({do: 'fadeOut', target: ids, t, dur: 0.5, order: 1e6 + i, scene: scene.id, auto: true, source: `auto-exit at ${scene.id}→${next.id}`});
    for (const id of refsNext) if (byId.has(id) && !carry.has(id) && byId.get(id).scene !== next.id && !visibleAt(id))
      warnings.push(`shots/${next.id}.json uses "${id}" which is not visible at the scene start. Bring it back with fadeIn/create, or add it to "carry" in film.json.`);
  }
}

export function storyboardMarkdown(film, timing) {
  const list = (label, v) => v == null || (Array.isArray(v) && !v.length) ? [] : [`- **${label}:** ${Array.isArray(v) ? v.join(label === 'Visible states' ? ' → ' : '; ') : v}`];
  const lines = [`# ${film.title}`, '', `**Concept (continuous visual world):** ${film.concept}`, '',
    'This is the director\'s intent. Builders have creative authority; their notes record deliberate departures.', ''];
  const T = film.theme || {};
  lines.push(`## Design theme: ${T.name || '(none declared)'}`, '', T.description || '', '',
    `- Background ${T.bg || '?'}; colours ${Object.entries(T.colors || {}).map(([k, v]) => `${k} ${v}${T.meanings?.[k] ? ` (${T.meanings[k]})` : ''}`).join(', ')}`,
    `- Fonts ${JSON.stringify(T.fonts || {})}; stroke ${T.stroke ?? 'default'}; corner ${T.corner ?? 'default'}; shadow ${T.shadow ? JSON.stringify(T.shadow) : 'none'}; eases ${JSON.stringify(T.eases || {})}`, '');
  if (film.alternatives?.length) lines.push('## Alternatives considered', ...film.alternatives.map(a => `- ${a.concept} — rejected: ${a.rejected}`), '');
  lines.push('## Recurring subjects', ...(film.subjects || []).map(s => `- \`${s.id}\`: ${s.what}`), '', `Prototype scene: \`${film.prototype}\``, '');
  for (const s of film.scenes) {
    const t = timing.scenes.find(x => x.id === s.id);
    lines.push(`## ${s.id} (${t?.start?.toFixed(2)}–${t?.end?.toFixed(2)} s) — built by the ${sceneOwner(film, s.id)}`, '', `- **Narrated idea:** ${s.idea}`,
      ...list('Mechanism', s.mechanism), ...list('Visible states', s.states), ...list('Payoff', s.payoff), ...list('Camera purpose', s.camera),
      ...list('Handoff', s.handoff), ...list('Assets', s.assets), `- **Carried subjects:** ${(s.carry || []).join(', ') || 'none'}`, ...list('Why a basic drawing/flow is not enough', s.why_not_basic),
      ...list('Alternatives considered', s.alternatives), ...list('Builder\'s notes', t?.notes), '');
  }
  return lines.join('\n') + '\n';
}
