// Native scene manifest and measured cue resolution. No drawing vocabulary or world compiler.
import {readFile, mkdir, writeFile, copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {tokens, normalized} from './timing.mjs';
import {SOUND_ALIGN, DEFAULT_VOLUME, readSound, soundInfo, placeSound, maskingAgainst} from './audio.mjs';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const present = value => typeof value === 'string' && value.trim().length > 0;
const ID = /^[a-z][a-z0-9-]*$/;
const AT = /^\s*(@prev|@after|start|end|[a-z][a-z0-9-]*|w\d+)\s*(?:([+-])\s*((?:\d+(?:\.\d+)?|\.\d+)))?\s*$/;
export class SpecError extends Error {
  constructor(errors, warnings = []) { super(errors.join('\n')); this.errors = errors; this.warnings = warnings; }
}
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


export function sceneOwner(film, id) { return film.scenes.find(scene => scene.id === id)?.owner || 'director'; }
export function validateFilm(film, alignment, duration) {
  const errors = [], warnings = [], scenes = [], ids = new Set();
  if (!film || film.version !== 2) throw new SpecError(['film.json needs version: 2']);
  for (const key of ['title', 'concept']) if (!present(film[key])) errors.push(`film.json ${key} is required`);
  if (!Array.isArray(film.scenes) || !film.scenes.length) throw new SpecError(['film.json scenes must be a nonempty array']);
  for (const [index, scene] of film.scenes.entries()) {
    const where = `film.json scenes[${index}]`;
    if (!ID.test(scene?.id || '') || ids.has(scene.id)) errors.push(`${where}: unique kebab-case id required`);
    ids.add(scene?.id);
    if (!present(scene?.idea)) errors.push(`${where}: idea is required`);
    if (scene?.kind !== 'html' || !/^compositions\/[a-z0-9-]+\.html$/.test(scene?.file || '')) errors.push(`${where}: native scene needs kind: html and file: compositions/<id>.html`);
    if (scene?.owner && !['director', 'builder'].includes(scene.owner)) errors.push(`${where}: owner is director or builder`);
    let start = 0;
    try { if (index) start = resolveSceneCue(scene.start, alignment, duration, 0, duration, `${where} start`, warnings); }
    catch (error) { errors.push(error.message); }
    scenes.push({id: scene?.id, start});
  }
  for (const [index, scene] of scenes.entries()) {
    scene.end = scenes[index + 1]?.start ?? duration;
    scene.duration = scene.end - scene.start;
    if (!(scene.duration > 0)) errors.push(`film.json ${scene.id}: scene boundaries must increase within the recording`);
  }
  if (errors.length) throw new SpecError(errors, warnings);
  return {scenes, warnings};
}
function parseAt(value, where) {
  const match = AT.exec(String(value));
  if (!match) throw new Error(`${where}: invalid sound cue`);
  return {ref: match[1], offset: match[2] ? (match[2] === '-' ? -1 : 1) * Number(match[3]) : 0};
}
async function compileSounds(shot, file, scene, b, cues, {job, duration, world, errors, warnings, voice}) {
  if (shot.sounds == null) return;
  if (!Array.isArray(shot.sounds)) { errors.push(`${file}: "sounds" must be a list of {"src", "at", "align", "volume", "why"}`); return; }
  const placed = [];
  for (const [i, s] of shot.sounds.entries()) {
    const where = `${file} sounds[${i}]`;
    if (!s || typeof s !== 'object') { errors.push(`${where}: each sound is an object {"src": "assets/....wav", "at": "<cue>"}`); continue; }
    if (!present(s.src) || !/^assets\/[\w./-]+\.wav$/.test(s.src) || s.src.includes('..')) {
      errors.push(`${where}: "src" must be a .wav file under assets/, e.g. "assets/library/sfx-whoosh-fast/1.0.0/crisp.wav" (find sounds with: npm run video -- library-search --query "whoosh"; then library-use)`); continue;
    }
    let decoded;
    try { decoded = await readSound(path.join(job, s.src)); }
    catch (error) { errors.push(error.code === 'ENOENT' ? `${where}: ${s.src} does not exist. Install it with library-use, or bring it in with: npm run video -- asset --job <job> --src <file> --name sfx/${path.basename(s.src)} --note "<what it sounds like>"` : `${where}: ${error.message}`); continue; }
    const align = s.align ?? 'start';
    if (!SOUND_ALIGN.includes(align)) { errors.push(`${where}: "align" must be ${SOUND_ALIGN.join(', ')} (start = begins on the cue, peak = its loudest moment hits the cue, end = it finishes on the cue)`); continue; }
    const volume = s.volume ?? DEFAULT_VOLUME;
    if (!Number.isFinite(volume) || volume <= 0 || volume > 1) { errors.push(`${where}: "volume" must be a number above 0 and at most 1 (the narration plays at 1)`); continue; }
    let t;
    try {
      const at = parseAt(s.at, where);
      if (at.ref.startsWith('@')) throw new Error(`${where}: "at" must name a cue ("cueName", "cueName+0.2"), not ${at.ref}`);
      if (cues[at.ref] == null) throw new Error(`${where}: "at" uses unknown cue "${at.ref}". Cues in this shot: ${Object.keys(cues).join(', ')}. Define it in "cues".`);
      t = Number((cues[at.ref] + at.offset).toFixed(3));
    } catch (error) { errors.push(error.message); continue; }
    if (t < b.start - 0.6 || t > b.end + 0.01) { errors.push(`${where}: lands at ${t.toFixed(2)}s, outside scene ${scene.id} (${b.start.toFixed(2)}–${b.end.toFixed(2)}s)`); continue; }
    const info = soundInfo(decoded), start = placeSound(t, align, info);
    if (start < 0) { errors.push(`${where}: would start at ${start.toFixed(2)}s, before the film begins. Use a later cue or align "start".`); continue; }
    if (start >= duration) { errors.push(`${where}: would start at ${start.toFixed(2)}s, after the film ends (${duration.toFixed(2)}s)`); continue; }
    const playDuration = Number(Math.min(info.duration, duration - start).toFixed(3));
    if (playDuration < info.duration - 0.05) warnings.push(`${where}: ${s.src} is cut off by the end of the film after ${playDuration.toFixed(2)}s of ${info.duration.toFixed(2)}s.`);
    if (!present(s.why)) warnings.push(`${where}: add "why": what on screen makes this sound at that moment. A sound with no visible cause reads as noise.`);
    const mask = maskingAgainst(await voice(), decoded, info, start, volume);
    if (mask) {
      const gap = 6 - mask.overDb, level = gap > 0 ? `only ${gap.toFixed(1)} dB under` : `${(-gap).toFixed(1)} dB louder than`;
      warnings.push(`${where}: at ${mask.at.toFixed(2)}s it is ${level} the narration while it speaks (keep at least 6 dB under the voice). Lower "volume" to ${mask.maxVolume} or less, or move it into a pause.`);
    }
    const sound = {id: `sfx-${scene.id}-${i}`, scene: scene.id, src: s.src, at: t, align, start, duration: info.duration, playDuration, peakTime: info.peakTime, volume, why: s.why || '', masking: mask, source: where};
    placed.push(sound); world.sounds.push(sound);
  }
}

export async function compileFilm(job, film, alignment, manifest, {allowMissing = false} = {}) {
  const {scenes, warnings} = validateFilm(film, alignment, manifest.duration);
  const errors = [], missing = [];
  const world = {width:manifest.width, height:manifest.height, duration:manifest.duration, objects:[], actions:[], scenes,
    sounds:[], moves:[], theme:film.theme || {}};
  for (const scene of film.scenes) {
    if (!await readFile(path.join(job,scene.file),'utf8').catch(()=>null)) {
      missing.push(scene.id); if (!allowMissing) errors.push(`${scene.file}: missing or empty`);
    }
    // Capture evidence is metadata only, never an executable drawing world.
    const capture = await readFile(path.join(job,scene.file.replace(/\.html$/,'.capture.json')),'utf8').then(JSON.parse,()=>null);
    if (capture) world.objects.push(...capture.objects);
  }
  let narration;
  const voice = async () => narration ??= await readSound(path.join(job,'assets/narration.wav'));
  if (film.sounds != null) {
    if (!Array.isArray(film.sounds)) errors.push('film.json sounds must be an array');
    else {
      const cues = {}, sounds = [];
      for (const [index,sound] of film.sounds.entries()) {
        try {
          const id = `sound${index}`;
          cues[id] = resolveSceneCue(sound?.at,alignment,manifest.duration,0,manifest.duration,`sounds[${index}]`,warnings);
          sounds.push({...sound,at:id});
        } catch(error) { errors.push(error.message); }
      }
      await compileSounds({sounds},'film.json',{id:'film'},{start:0,end:manifest.duration,duration:manifest.duration},cues,
        {job,duration:manifest.duration,world,errors,warnings,voice});
    }
  }
  if (film.music) {
    const music = film.music;
    if (!/^assets\/(?:music|library)\/[\w./-]+\.(?:mp3|wav|ogg|flac|m4a)$/.test(music.src || '') || music.src.includes('..')) errors.push('music.src must be a local asset');
    else if (!await readFile(path.join(job,music.src)).catch(()=>null)) errors.push('music file is missing');
    if (!present(music.source) || !present(music.license)) errors.push('music needs source and licence');
    for (const [key,low,high] of [['trackStart',0,36000],['filmStart',0,manifest.duration],['level',-40,0],['duck',-40,0],['fadeIn',0,30],['fadeOut',0,30]])
      if (music[key] != null && (!Number.isFinite(music[key]) || music[key] < low || music[key] > high)) errors.push(`music.${key} must be between ${low} and ${high}`);
    world.music = {...music,trackStart:music.trackStart || 0,filmStart:music.filmStart || 0,moves:[]};
  }
  if (errors.length) throw new SpecError(errors,warnings);
  return {world,timing:{version:2,duration:manifest.duration,missing,warnings,scenes:scenes.map((s,i)=>({...s,kind:'html',file:film.scenes[i].file,beats:[],holds:[]}))},warnings,missing};
}
export function storyboardMarkdown(film,timing) {
  return `# ${film.title}\n\n${film.concept}\n\n` + timing.scenes.map(scene=>`## ${scene.id}: ${scene.start.toFixed(2)}–${scene.end.toFixed(2)}s\n${film.scenes.find(s=>s.id===scene.id).idea}\n`).join('\n');
}
export async function installRuntime(job) {
  const target=path.join(job,'assets/kit'); await mkdir(path.join(target,'fonts'),{recursive:true});
  await copyFile(path.join(ROOT,'node_modules/gsap/dist/gsap.min.js'),path.join(target,'gsap.min.js'));
  await copyFile(path.join(ROOT,'node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2'),path.join(target,'fonts/inter-600.woff2'));
}
export async function writeRoot(job,manifest,timing,film,{file='index.html',end=manifest.duration}={}) {
  const duration=Math.min(end,manifest.duration);
  const hosts=timing.scenes.filter(scene=>scene.start<duration).map((scene,index)=>
    `<div id="host-${scene.id}" class="clip" data-composition-id="${scene.id}" data-composition-src="${scene.file}" data-start="${scene.start}" data-duration="${Math.min(scene.duration,duration-scene.start)}" data-track-index="${index+1}" data-width="${manifest.width}" data-height="${manifest.height}"></div>`);
  await writeFile(path.join(job,file),`<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><script src="assets/kit/gsap.min.js"></script><script src="assets/cues.js"></script><style>html,body{margin:0;width:100%;height:100%;background:${film.theme?.bg || '#10141a'}}#root{position:relative;width:100%;height:100%;overflow:hidden}.clip{position:absolute;inset:0}</style></head><body><div id="root" data-composition-id="main" data-duration="${duration}" data-width="${manifest.width}" data-height="${manifest.height}">${hosts.join('\n')}<audio id="narration" src="assets/narration.wav" data-start="0" data-duration="${duration}" data-track-index="0" data-volume="1"></audio></div><script>window.__timelines['main']=gsap.timeline({paused:true});</script></body></html>`);
}
