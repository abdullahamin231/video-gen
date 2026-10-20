
// Film-mode production: film.json + shots/*.json → compiled world → checks → render → review → delivery.
// Every command ends by telling the agent the next step; `next` derives the whole state machine from files.
import {readFile, writeFile, mkdir, access, readdir, stat, rm, rename} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeWords, browserCues} from './timing.mjs';
import {compileFilm, validateFilm, SpecError, storyboardMarkdown, sceneOwner} from './spec.mjs';
import {writeWorld, writeRoot, installKit} from './world.mjs';
import {mixdown} from './mix.mjs';
import {soundCheck} from './sound-check.mjs';
import {inspectFilm, writeInspection, openInspector} from './inspect.mjs';
import {pixelChecks} from './pixels.mjs';
import {renderManimClips} from './manim.mjs';
import {directorBrief, directorSceneBrief, builderBrief, reviewerBrief, visualsBrief, writeBrief} from './briefs.mjs';
import {VISUALS_FILE, visualPlanErrors, visualScenes} from './visuals.mjs';
import {unsavedFiles} from './library.mjs';
import {sourceFingerprint, fileHash, reviewStatus, reviewProgress, acceptedPrototype, loadReviewPack, qualifyDelivery, REVIEW_ROLES} from './review.mjs';
import {verifyLibraryCopies} from './library.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIBRARY = process.env.VG_LIBRARY || path.join(ROOT, 'library');
const json = async f => JSON.parse(await readFile(f, 'utf8'));
const save = (f, v) => writeFile(f, JSON.stringify(v, null, 2) + '\n');
const exists = async f => { try { await access(f); return true; } catch { return false; } };
const jr = job => path.relative(ROOT, job);
export const isFilmJob = job => exists(path.join(job, 'film.json'));

export async function context(job) {
  const manifest = await json(path.join(job, 'job.json')), alignment = await json(path.join(job, 'alignment.json'));
  normalizeWords(alignment.words, manifest.duration);
  if (alignment.matchRatio < 0.85 && !(alignment.review?.approved && alignment.review.note?.trim()))
    throw new Error(`Script match is only ${(alignment.matchRatio * 100).toFixed(0)}%. Inspect alignment.json discrepancies, then record them: npm run video -- alignment-approve --job ${jr(job)} --note "<what differs and why the recording is followed>"`);
  return {manifest, alignment};
}
async function prototypeAccepted(job) { try { await acceptedPrototype(job); return true; } catch { return false; } }

export function printSpecError(error) {
  console.error(`\n${error.errors.length} error(s):`);
  for (const e of error.errors) console.error(`  ✗ ${e}`);
  if (error.warnings?.length) { console.error(`\n${error.warnings.length} warning(s):`); for (const w of error.warnings) console.error(`  ! ${w}`); }
}

export async function planCheck(job) {
  const {manifest, alignment} = await context(job);
  const film = await json(path.join(job, 'film.json')).catch(e => { throw new SpecError([`film.json: ${e.code === 'ENOENT' ? 'missing' : 'invalid JSON: ' + e.message}`]); });
  const {scenes, warnings} = validateFilm(film, alignment, manifest.duration);
  // Builders receive the plan's section by scene id, so an id that drifted from the plan loses its direction.
  const plan = await readFile(path.join(job, VISUALS_FILE), 'utf8').catch(() => null);
  if (plan) {
    const planned = visualScenes(plan);
    for (const s of film.scenes) if (!planned.has(s.id)) warnings.push(`film.json scene "${s.id}" has no "### ${s.id}" section in ${VISUALS_FILE}; use the plan's scene ids so its builder gets the plan's direction (planned: ${[...planned.keys()].join(', ')})`);
  }
  const timing = {scenes: scenes.map(s => ({...s, kind: film.scenes.find(x => x.id === s.id).kind || 'shots'}))};
  // Same storyboard as build writes (including builder notes): it is a source file, so the two must agree
  // or every plan-check would make the last build look stale.
  for (const s of timing.scenes) { const notes = (await json(path.join(job, `shots/${s.id}.json`)).catch(() => null))?.notes; if (typeof notes === 'string' && notes.trim()) s.notes = notes; }
  await writeFile(path.join(job, 'STORYBOARD.md'), storyboardMarkdown(film, timing));
  for (const s of timing.scenes) if (sceneOwner(film, s.id) === 'builder') await writeBrief(job, `build-${s.id}.md`, builderBrief(job, manifest, film, s, alignment, {prior: await priorObjects(job, film, s.id)}));
  console.log(`Plan valid: ${scenes.length} scenes.`);
  for (const s of scenes) console.log(`  ${s.id.padEnd(22)} ${s.start.toFixed(2).padStart(7)}–${s.end.toFixed(2).padEnd(7)} (${s.duration.toFixed(1)}s) ${sceneOwner(film, s.id).padEnd(8)}${s.id === film.prototype ? '  ← prototype' : ''}`);
  for (const w of warnings) console.log(`  ! ${w}`);
  return {film, scenes};
}

async function priorObjects(job, film, sceneId) {
  const out = [];
  for (const s of film.scenes) {
    if (s.id === sceneId) break;
    const shot = await json(path.join(job, `shots/${s.id}.json`)).catch(() => null);
    for (const o of shot?.objects || []) out.push({id: o.id, file: `shots/${s.id}.json`, spec: o});
  }
  return out;
}

/** Compile + assemble + inspect. Returns {ok, errors, warnings, timing}. */
export async function buildFilm(job, {scene = null, allowMissing = null, inspect = true, print = true} = {}) {
  const {manifest, alignment} = await context(job);
  const film = await json(path.join(job, 'film.json'));
  if (allowMissing == null) allowMissing = !(await prototypeAccepted(job));
  await installKit(job, {onlyMissing: true}); // a pinned kit.js stays; newly bundled fonts are added
  let compiled;
  try { compiled = await compileFilm(job, film, alignment, manifest, {allowMissing}); }
  catch (error) {
    if (!(error instanceof SpecError)) throw error;
    const errs = scene ? error.errors.filter(e => e.includes(`shots/${scene}.`) || e.includes(`components/`) || !/shots\//.test(e)) : error.errors;
    await save(path.join(job, 'review/build.json'), {ok: false, sourceHash: null, errors: error.errors, warnings: error.warnings});
    if (print) printSpecError({errors: errs.length ? errs : error.errors, warnings: error.warnings.filter(w => !scene || w.includes(scene))});
    return {ok: false, errors: error.errors, warnings: error.warnings};
  }
  const {world, timing, warnings} = compiled;
  const clips = await renderManimClips(job, world, manifest);
  for (const c of clips) { const o = world.objects.find(x => x.id === c.id); o.mediaDuration = Number(Math.min(c.duration, manifest.duration - o.mediaStart).toFixed(3)); }
  await save(path.join(job, 'timing.json'), timing);
  await writeFile(path.join(job, 'assets/cues.js'), `/* Generated from measured words and film.json/shots; do not hand-edit. */\nwindow.VideoCues = ${JSON.stringify(browserCues(timing), null, 2)};\n`);
  await writeWorld(job, world, manifest);
  await writeRoot(job, manifest, timing, film);
  await writeFile(path.join(job, 'STORYBOARD.md'), storyboardMarkdown(film, timing));
  await mkdir(path.join(job, 'review'), {recursive: true});
  await writeFile(path.join(job, 'review/sounds.md'), soundTranscript(world));
  let result = {errors: [], warnings: [], report: null, transcript: ''};
  if (inspect) {
    try { result = await inspectFilm(job, manifest, timing, {scope: scene ? [scene] : null}); }
    catch (error) { if (!error.browser) throw error; result.errors = [error.message]; }
    await writeInspection(job, result);
  }
  const allErrors = [...result.errors], allWarnings = [...warnings, ...result.warnings];
  const sourceHash = await sourceFingerprint(job);
  await save(path.join(job, 'review/build.json'), {ok: !allErrors.length, scope: scene || 'all', missing: timing.missing, sourceHash, errors: allErrors, warnings: allWarnings, report: result.report});
  if (print) {
    if (result.transcript) {
      const t = scene ? sliceTranscript(result.transcript, scene) : result.transcript;
      console.log(t.length > 12000 ? t.slice(0, 12000) + `\n… (full transcript: ${jr(job)}/review/motion.md)` : t);
    }
    const sounds = world.sounds.filter(x => !scene || x.scene === scene);
    if (sounds.length) console.log(`\nSound effects: ${sounds.length} placed${scene ? ` in ${scene}` : ''} (${jr(job)}/review/sounds.md).`);
    for (const w of allWarnings.filter(w => !scene || w.includes(scene) || !/\[|shots\//.test(w))) console.log(`  ! ${w}`);
    for (const e of allErrors) console.log(`  ✗ ${e}`);
    console.log(`\nBuild ${allErrors.length ? 'FAILED' : 'OK'}: ${allErrors.length} error(s), ${allWarnings.length} warning(s)${timing.missing.length ? `; scenes not built yet: ${timing.missing.join(', ')}` : ''}.`);
  }
  return {ok: !allErrors.length, errors: allErrors, warnings: allWarnings, timing, sourceHash};
}
/** Plain-text sound plan: every sound effect, the music and how the big moves sit on its beat (reviewers cannot hear). */
export function soundTranscript(world = {}) {
  const sounds = world.sounds || [], moves = world.moves || [], music = world.music;
  const out = ['# Sound', ''];
  if (!sounds.length && !music) return out.concat(['None. The soundtrack is the narration alone.', '']).join('\n');
  out.push(`Narration: unprocessed, always the loudest. ${sounds.length} sound effect(s). Music: ${music ? `${music.src} (${music.tempo} BPM, from ${music.trackStart}s of the track at film ${music.filmStart}s), ducked under the voice` : 'none'}.`, '');
  if (sounds.length) out.push('## Sound effects', '', '| lands at (s) | plays (s) | scene | sound | align | volume | vs voice | why |', '|---|---|---|---|---|---|---|---|',
    ...sounds.slice().sort((a, b) => a.at - b.at).map(s => `| ${s.at.toFixed(2)} | ${s.start.toFixed(2)}–${(s.start + (s.playDuration ?? s.duration)).toFixed(2)} | ${s.scene} | ${s.src.replace(/^assets\//, '')} | ${s.align} | ${s.volume} | ${s.masking ? `may mask voice at ${s.masking.at}s` : 'clear'} | ${(s.why || '—').replace(/\|/g, '/')} |`), '');
  const rows = music?.moves || moves;
  if (rows.length) out.push('## Cuts and big moves', '', `| at (s) | scene | move | sound wanted | has a sound | ${music ? 'nearest beat |' : ''}`, `|---|---|---|---|---|${music ? '---|' : ''}`,
    ...rows.map(m => `| ${m.t.toFixed(2)} | ${m.scene} | ${m.what} | ${m.sound} | ${moves.find(x => x.t === m.t && x.what === m.what)?.sounded ? 'yes' : 'no'} | ${music ? `${m.beatDelta >= 0 ? '+' : ''}${(m.beatDelta * 1000).toFixed(0)} ms${Math.abs(m.beatDelta) <= 0.05 ? ' ✓' : ''} |` : ''}`), '');
  return out.join('\n');
}
function sliceTranscript(t, scene) { const parts = t.split(/\n(?=## )/); return [parts[0], ...parts.filter(p => p.startsWith(`## ${scene} `))].join('\n'); }

export async function snapshot(job, {scene, at}) {
  const {manifest} = await context(job), timing = await json(path.join(job, 'timing.json'));
  const s = scene ? timing.scenes.find(x => x.id === scene) : null;
  if (scene && !s) throw new Error(`Unknown scene ${scene}`);
  let times = at ? String(at).split(',').map(Number) : [];
  if (!times.length) { const a = s ? s.start : 0, b = s ? s.end : manifest.duration, n = Math.max(4, Math.min(10, Math.round((b - a) / 1.5))); for (let i = 0; i < n; i++) times.push(Number((a + (b - a) * (i + 0.5) / n).toFixed(2))); }
  const ins = await openInspector(job, manifest), files = [];
  try { for (const t of times) { const f = path.join(job, 'review/snapshots', `${scene || 'film'}-${t.toFixed(2)}s.png`); await ins.screenshot(t, f); files.push(f); } }
  finally { await ins.close(); }
  console.log(files.join('\n'));
  return files;
}

export async function filmAudit(job, {allowBuildErrors = false} = {}) {
  const errors = [...await verifyLibraryCopies(job)], warnings = [];
  const root = await readFile(path.join(job, 'index.html'), 'utf8').catch(() => '');
  if (!root.includes('assets/narration.wav') || !root.includes('compositions/world.html')) errors.push('index.html is stale or missing; run build.');
  const world = await readFile(path.join(job, 'compositions/world.html'), 'utf8').catch(() => '');
  if (!world) errors.push('compositions/world.html missing; run build.');
  for (const f of ['compositions/world.html', 'index.html']) { const src = f === 'index.html' ? root : world; if (/Math\.random\s*\(|Date\.now\s*\(|setInterval\s*\(/.test(src)) errors.push(`${f}: nondeterministic clock/randomness.`); if (/(?:src|href)=["']https?:\/\//.test(src)) warnings.push(`${f}: external URL; freeze assets locally.`); }
  const build = await json(path.join(job, 'review/build.json')).catch(() => null);
  if (!build) errors.push('No build record; run build.');
  else { if (!build.ok && !allowBuildErrors) errors.push(`Last build has ${build.errors.length} error(s); fix them and rebuild.`); if (build.sourceHash !== await sourceFingerprint(job)) errors.push('Sources changed since the last build; run build again.'); }
  const report = {ok: !errors.length, errors, warnings};
  await save(path.join(job, 'review/audit.json'), report);
  if (errors.length) { for (const e of errors) console.error(`  ✗ ${e}`); throw new Error('Pipeline audit failed.'); }
  return report;
}

// Before the prototype is accepted only the scenes up to it exist and review covers at most 15 s of them, so frames
// are captured only to the end of the prototype (and its review interval); the rest of the picture holds that last
// frame. The output keeps the film's full length, so the mix, verification and review pack work as for any render.
export async function prototypeCut(job, manifest) {
  if (await prototypeAccepted(job)) return null;
  const timing = await json(path.join(job, 'timing.json')).catch(() => null), film = await json(path.join(job, 'film.json')).catch(() => null);
  if (!timing?.missing?.length || !film?.prototype) return null;
  const scene = timing.scenes.find(s => s.id === film.prototype);
  if (!scene) return null;
  const iv = prototypeInterval(timing, film, manifest.duration);
  const end = Math.ceil(Math.max(scene.end, iv.end) * manifest.fps + 1) / manifest.fps;
  return end < manifest.duration - 1 ? Number(end.toFixed(3)) : null;
}

function ffmpegRun(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...args], {stdio: ['ignore', 'ignore', 'pipe']});
    let log = ''; child.stderr.on('data', c => { log += c; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${log.slice(-800)}`)));
  });
}

// Hold the last captured frame until the film's full length.
export async function holdToLength(job, manifest, end) {
  const picture = path.join(job, 'renders/picture.mp4'), full = path.join(job, 'renders/picture-full.mp4');
  await ffmpegRun(['-i', picture, '-vf', `tpad=stop_mode=clone:stop_duration=${(manifest.duration - end + 1).toFixed(3)},fps=${manifest.fps}`,
    '-t', String(manifest.duration), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', full]);
  await rename(full, picture);
}

// Two capture workers, out of HyperFrames' low-memory mode (it pins machines with 8 GB or less to one). If that
// render fails, it is retried once with the renderer's own safe defaults.
const DEFAULT_WORKERS = '2';
async function captureFrames(job, hf, {quality, fps, workers, composition}) {
  const base = ['render', '--quality', quality, '--fps', String(fps), '--output', 'renders/picture.mp4', ...(composition ? ['--composition', composition] : []), '--quiet'];
  const chosen = workers ?? process.env.VIDEO_RENDER_WORKERS ?? DEFAULT_WORKERS;
  const many = chosen !== 'auto' && Number(chosen) > 1;
  try { await hf([...base, '--workers', String(chosen), ...(many ? ['--no-low-memory-mode'] : [])], {cwd: job}); }
  catch (error) {
    if (!many) throw error;
    console.log(`Render with ${chosen} workers failed (${error.message}); retrying with the renderer's low-memory defaults.`);
    await hf(base, {cwd: job});
  }
}

export async function renderFilm(job, {hf, verify, quality = 'delivery', force = false, reuseBuild = false, workers}) {
  if (workers != null && workers !== 'auto' && (!Number.isInteger(Number(workers)) || Number(workers) < 1))
    throw new Error('Render workers must be a positive integer or auto.');
  const manifest = await json(path.join(job, 'job.json'));
  let built;
  if (reuseBuild) {
    built = await json(path.join(job, 'review/build.json')).catch(() => null);
    const timing = await json(path.join(job, 'timing.json')).catch(() => null);
    if (!built?.ok || built.scope !== 'all' || !Array.isArray(built.missing) || built.missing.length ||
        !Array.isArray(built.errors) || built.errors.length || !timing?.scenes?.length ||
        timing.missing?.length || !timing.scenes.every(s => built.report?.scenes?.[s.id]) ||
        built.sourceHash !== await sourceFingerprint(job))
      throw new Error('--reuse-build requires a current successful browser build of every scene. Run build first.');
    console.log(`Reusing current successful build: ${timing.scenes.length} scenes, 0 errors.`);
  } else built = await buildFilm(job, {print: true});
  if (!built.ok && !force) throw new Error('Build has errors; fix them before rendering (see above).');
  await filmAudit(job, {allowBuildErrors: force});
  const sourceHash = await sourceFingerprint(job);
  manifest.status = 'rendering'; delete manifest.completedAt; delete manifest.delivery; await save(path.join(job, 'job.json'), manifest);
  await hf(['lint'], {cwd: job}).catch(() => { throw new Error('HyperFrames lint failed (see above).'); });
  let cut = await prototypeCut(job, manifest);
  if (cut) {
    const timing = await json(path.join(job, 'timing.json')), film = await json(path.join(job, 'film.json'));
    await writeRoot(job, manifest, timing, film, {file: 'index.cut.html', end: cut});
    console.log(`Prototype render: capturing 0–${cut} s (to the end of the prototype); the rest holds the last frame.`);
    try { await captureFrames(job, hf, {quality, fps: manifest.fps, workers, composition: 'index.cut.html'}); await holdToLength(job, manifest, cut); }
    catch (error) { console.log(`Short prototype render failed (${error.message}); rendering the whole film instead.`); cut = null; }
    finally { await rm(path.join(job, 'index.cut.html'), {force: true}); }
  }
  if (!cut) await captureFrames(job, hf, {quality, fps: manifest.fps, workers});
  // The soundtrack is mixed and mastered here (narration + sound effects + ducked music), then muxed and measured.
  const mixed = await mixdown(job, {world: await json(path.join(job, 'assets/world.json')), film: await json(path.join(job, 'film.json')), manifest});
  await finishSound(job, mixed, verify);
  if (sourceHash !== await sourceFingerprint(job)) throw new Error('Sources changed during rendering. Render again.');
  const timing = await json(path.join(job, 'timing.json'));
  const scoped = {...timing, scenes: timing.scenes.filter(s => !(timing.missing || []).includes(s.id))};
  const pixels = await pixelChecks(path.join(job, 'renders/video.mp4'), scoped);
  await save(path.join(job, 'review/pixels.json'), pixels);
  const videoSha256 = await fileHash(path.join(job, 'renders/video.mp4'));
  await save(path.join(job, 'review/render-source.json'), {version: 1, sourceHash, videoSha256});
  manifest.status = 'draft-rendered'; await save(path.join(job, 'job.json'), manifest);
  for (const e of pixels.errors) console.log(`  ✗ ${e}`);
  console.log(`Rendered ${jr(job)}/renders/video.mp4 (${pixels.errors.length} pixel-check error(s)).`);
  return {pixels};
}

const mixLine = m => `Mix: ${m.integratedLufs} LUFS, peaks ${Math.max(m.truePeakDb, m.samplePeakDb, m.mono.truePeak, m.mono.samplePeak).toFixed(1)} dB (target ${m.target.integratedLufs} LUFS, peaks ≤ ${m.target.peakDb}; limited by the ${m.limitedBy}); ${m.soundEffects} sound effect(s)${m.music ? ', music' : ''}.`;
async function finishSound(job, mixed, verify) {
  console.log(mixLine(mixed));
  await verify(job);
  const listening = await soundCheck(job);
  if (listening.cues) console.log(`Sound evidence: ${listening.sheets.length} sheet(s), headphone checks in ${jr(job)}/review/sound/listen.md.`);
}

/** Re-mix the soundtrack onto the existing picture (after a pipeline update), when the sources have not changed. */
export async function remixFilm(job, {verify}) {
  const receipt = await json(path.join(job, 'review/render-source.json')).catch(() => null), sourceHash = await sourceFingerprint(job);
  if (!receipt || receipt.sourceHash !== sourceHash || !await exists(path.join(job, 'renders/picture.mp4')))
    throw new Error('mix needs an up-to-date render (renders/picture.mp4 from the current sources). Run render.');
  const manifest = await json(path.join(job, 'job.json'));
  const mixed = await mixdown(job, {world: await json(path.join(job, 'assets/world.json')), film: await json(path.join(job, 'film.json')), manifest});
  await finishSound(job, mixed, verify);
  await save(path.join(job, 'review/render-source.json'), {version: 1, sourceHash, videoSha256: await fileHash(path.join(job, 'renders/video.mp4'))});
  return mixed;
}

export function prototypeInterval(timing, film, duration) {
  const s = timing.scenes.find(x => x.id === film.prototype);
  let a = s.start, b = Math.min(s.end, a + 15);
  if (b - a < 10) { b = Math.min(duration, a + 10); if (b - a < 10) a = Math.max(0, b - 10); }
  return {start: Number(a.toFixed(3)), end: Number(b.toFixed(3))};
}

export async function writeReviewerBriefs(job, pack, packPath, packSha256) {
  const directions = {
    'visual-mechanism': 'Blind first pass: BEFORE reading motion.md, automated checks, script, narration, film.json or STORYBOARD.md, VIEW the ordered frames/clips. Save plain-language observations of what visibly changes and what causes it, what each object is recognisable as, and how the film looks (its visual theme and whether every frame shares it) to `visual-first.md` in the incoming directory (do not overwrite an earlier pass; use a new file named with the pack hash). Only then read the motion transcript, narration (SCRIPT.md, timing.json) and STORYBOARD.md (which starts with the declared design theme) and compare. Labels, fades and camera moves alone do not explain. If you cannot view images/video, report incomplete with inspection.visual = "unavailable".',
    'narration-fidelity': 'Read inputs/source-script.md, SCRIPT.md, alignment.json and timing.json, then the motion transcript and frames. Check that what is shown at each moment matches what is said then; every displayed number and claim is supported by the narration or script; cues land on the right words. If you cannot listen, set inspection.audio to "signal-verified" (the pack includes a waveform verification receipt) and state that limitation. Then judge the sound from the pack\'s sound evidence: sounds.md (each effect\'s cue, volume and reason; each cut and big move with its beat offset), mix.json (loudness and peaks measured on the MP4, voiceMasked, voiceClose, soundsUnderMusic) and the cue sheets (frame before / after each cue with its waveform). Each effect must belong to something visible at that moment. Only voiceMasked (effects and music louder than the voice while it speaks) is blocking. voiceClose (within 3 dB but still under the voice) and the build\'s per-effect masking warnings in sounds.md are normal for a short whoosh or hit: advisory at most, never blocking on their own. Never claim the film sounds good.',
    'continuity-legibility': 'VIEW full and phone-scale (480 px wide) frames: essential labels and numbers readable, no text collisions, one clear focus, framed uncrowded stages, no passage where the picture stops matching the narration, meaningful intermediate states, every scene inside the declared design theme (palette, line weight, type, imagery, motion), and handoffs that keep recurring subjects (read STORYBOARD.md). Inspect the ending. The motion transcript and automated checks are supporting diagnostics, never a substitute for viewing images. If images/video are unavailable, report incomplete with inspection.visual = "unavailable".',
  };
  const out = [], manifest = JSON.parse(await readFile(path.join(job, 'job.json'), 'utf8'));
  for (const role of REVIEW_ROLES) out.push({role, path: await writeBrief(job, `review-${pack.stage}-${role}.md`, reviewerBrief(job, role, pack, packPath, packSha256, directions[role], manifest))});
  return out;
}

export async function reviewTemplate(job, {stage, role}) {
  if (!REVIEW_ROLES.includes(role)) throw new Error(`role must be one of ${REVIEW_ROLES.join(', ')}`);
  const {pack, packSha256} = await loadReviewPack(job, stage);
  const report = {version: 1, stage, role, sourceHash: pack.sourceHash, videoSha256: pack.videoSha256, packSha256,
    // The runner sets VIDEO_AGENT_ID for every agent it starts; elsewhere the reviewer fills in its own id.
    reviewer: {agentId: process.env.VIDEO_AGENT_ROLE === 'reviewer' && process.env.VIDEO_AGENT_ID ? process.env.VIDEO_AGENT_ID : 'FILL-IN: your agent/session id', independent: true},
    // Most reviewers inspect still frames; change mode and limitations if you played the clips.
    inspection: {mode: 'frame-sequence', visual: 'FILL-IN: viewed | unavailable', evidence: [], limitations: ['Inspected still frames and contact sheets; motion between frames was not seen in playback.'], ...(role === 'narration-fidelity' ? {audio: 'FILL-IN: listened | signal-verified | unavailable'} : {})},
    ...(role === 'visual-mechanism' ? {initialObservation: 'FILL-IN: what the pictures showed before you read the narrative'} : {}),
    coverage: [],
    findings: [],
    findingExample: {id: 'F1', severity: 'blocking', start: 0, end: 1, subject: 'which object', requirement: 'which rule', observed: 'what you saw', repair: 'what must change (not how)', evidence: [pack.evidence.find(e => e.kind === 'motion')?.path || pack.evidence[0].path]},
    verdict: 'FILL-IN: pass | revise'};
  const dir = path.join(job, `review/${stage}/incoming`); await mkdir(dir, {recursive: true});
  const file = path.join(dir, `${role}.json`);
  const prev = await json(file).catch(() => null);
  if (!prev || prev.packSha256 !== packSha256) await save(file, report);
  console.log(`Template: ${file}\nFill every FILL-IN field, then submit with review-submit. review-submit lists every remaining problem at once.`);
  return file;
}

// ------------------------------------------------------------------ next: the state machine
// Each brief is tagged with a role that names an agent type (.claude/agents/video-<role>.md), so a harness can
// route creative roles to a strong model and grunt roles to a cheaper one. groups: [{role, briefs}].
const spawnText = (groups, then) => {
  const n = groups.reduce((k, g) => k + g.briefs.length, 0);
  return [`DO: spawn ${n > 1 ? `${n} fresh sub-agents, one per brief below (they may run in parallel)` : 'one fresh sub-agent'} with no conversation history.`,
    `    Use the agent type named before each prompt if your harness has it (it sets the model); otherwise any fresh sub-agent.`,
    `    Give each sub-agent exactly its prompt, and nothing else:`,
    ...groups.flatMap(g => g.briefs.map(b => `      ${agentType(g.role)}: "Read ${b} and follow it exactly."`)),
    `    Wait until ${n > 1 ? 'all have' : 'it has'} finished. Do not do their work yourself and do not edit their files.`,
    `THEN: ${then}`].join('\n');
};
const spawnOne = (role, briefs, then) => spawnText([{role, briefs}], then);
const agentType = role => role.startsWith('script-') ? role : `video-${role}`;

// 0. The creative direction. Jobs whose script came without a visual plan get one from the script writer before
// planning; jobs that already have a film.json (planned before visual plans existed) keep it.
async function visualsState(job) {
  if (await exists(path.join(job, 'film.json'))) return null; // even unparseable: that is the director's repair
  const text = await readFile(path.join(job, VISUALS_FILE), 'utf8').catch(() => null);
  if (text == null) return {errors: []};
  const errors = visualPlanErrors(text);
  return errors.length ? {errors} : null;
}

export async function nextStep(job) {
  const J = jr(job), NEXT = `npm run video -- next --job ${J}`;
  const manifest = await json(path.join(job, 'job.json'));
  if (manifest.status === 'complete') {
    try {
      const current = await qualifyDelivery(job), delivered = await json(path.join(job, 'review/delivery.json'));
      if (!delivered.ok || delivered.videoSha256 !== current.videoSha256 || delivered.sourceHash !== current.sourceHash || delivered.packSha256 !== current.packSha256) throw new Error('Delivery changed.');
      return {state: 'done', text: `STATE: done\nThe film is delivered: ${J}/renders/video.mp4\nDO: report the MP4 path to the user with a short verification note from ${J}/review/delivery.json (its limitations and advisory findings). Do not open a preview or change any job file: the delivery is final.`};
    } catch { /* Re-enter production when persisted completion evidence is missing/stale. */ }
  }
  let ctx;
  try { ctx = await context(job); } catch (error) { return {state: 'alignment', text: `STATE: alignment-review\n${error.message}\nTHEN: ${NEXT}`}; }
  const {alignment} = ctx;
  // 1. plan
  let film = null, planErrors = null;
  try { film = await json(path.join(job, 'film.json')); validateFilm(film, alignment, manifest.duration); }
  catch (error) { planErrors = error.errors || [error.message]; }
  const visuals = await visualsState(job);
  if (visuals) {
    const brief = await writeBrief(job, 'visuals.md', visualsBrief(job, manifest, alignment, visuals));
    return {state: 'visuals', text: `STATE: the script writer plans the visuals${visuals.errors.length ? ` (${VISUALS_FILE} has ${visuals.errors.length} problem(s))` : ' (the script came without a visual plan)'}\n${spawnOne('script-writer', [brief], NEXT)}`};
  }
  if (!film || planErrors) {
    const brief = await writeBrief(job, 'director.md', directorBrief(job, manifest, alignment, {planErrors: film ? planErrors : null}));
    return {state: 'plan', text: `STATE: plan the film${film ? ` (film.json has ${planErrors.length} error(s))` : ''}\n${spawnOne('director', [brief], NEXT)}`};
  }
  if (manifest.reviewPlanRevision) {
    if (manifest.reviewPlanRevision.filmHash === await fileHash(path.join(job,'film.json')))
      return {state:'revise plan',text:`STATE: revise the concept/ownership with the director\n${spawnOne('director', [path.join(job,'briefs/director-revision.md')],NEXT)}`};
    delete manifest.reviewPlanRevision; await save(path.join(job,'job.json'),manifest);
  }
  await planCheck(job).catch(() => {});
  const accepted = await prototypeAccepted(job), stage = accepted ? 'final' : 'prototype';
  // Build the introduction/context in order before a dependent prototype. A builder
  // cannot reuse an earlier subject until its owner has supplied the actual spec.
  const prototypeIndex = film.scenes.findIndex(s => s.id === film.prototype);
  const wantedScenes = accepted ? film.scenes : film.scenes.slice(0, prototypeIndex + 1);
  const missing = [];
  for (const s of wantedScenes) if (!await exists(path.join(job, s.kind === 'html' ? s.file : `shots/${s.id}.json`))) missing.push(s);
  if (missing.length) {
    const first = missing[0], why = !accepted && first.id !== film.prototype ? ' (prerequisite context for the prototype)' : '';
    if (sceneOwner(film, first.id) === 'director') {
      // One director context builds its consecutive scenes together, so the picture stays in one head.
      const run = [];
      for (const s of missing) { if (sceneOwner(film, s.id) !== 'director') break; run.push(s); }
      const {scenes: bounds} = validateFilm(film, alignment, manifest.duration);
      const brief = await writeBrief(job, `direct-${first.id}.md`, directorSceneBrief(job, manifest, film, run.map(s => bounds.find(b => b.id === s.id)), alignment));
      return {state: `build ${stage}`, text: `STATE: the director builds ${run.map(s => `"${s.id}"`).join(', ')}${why}\n${spawnOne('director', [brief], NEXT)}`};
    }
    return {state: `build ${stage}`, text: `STATE: build scene "${first.id}"${why}\n${spawnOne('builder', [path.join(job, 'briefs', `build-${first.id}.md`)], NEXT)}`};
  }
  // 2. build
  const build = await json(path.join(job, 'review/build.json')).catch(() => null);
  const fresh = build && build.sourceHash && build.sourceHash === await sourceFingerprint(job) && build.scope === 'all';
  if (!fresh) return {state: 'build', text: `STATE: build and check\nDO: run \`npm run video -- build --job ${J}\`\nTHEN: ${NEXT}`};
  if (!build.ok) return repairText(job, film, build.errors.map(e => ({text: e})), NEXT, 'the automated checks');
  // 3. render
  const receipt = await json(path.join(job, 'review/render-source.json')).catch(() => null);
  const renderFresh = receipt && receipt.sourceHash === build.sourceHash && await exists(path.join(job, 'renders/video.mp4')) && receipt.videoSha256 === await fileHash(path.join(job, 'renders/video.mp4'));
  if (!renderFresh) return {state: 'render', text: `STATE: render\nDO: run \`npm run video -- render --job ${J}\` (takes a few minutes)\nTHEN: ${NEXT}`};
  const pixels = await json(path.join(job, 'review/pixels.json')).catch(() => ({errors: []}));
  if (pixels.errors?.length) return repairText(job, film, pixels.errors.map(e => ({text: e})), NEXT, 'pixel checks on the render');
  // 4. everything the film brought in or made is saved to the library before it is reviewed
  const unsaved = await unsavedFiles(LIBRARY, job);
  if (unsaved.length) return {state: 'save assets', text: `STATE: save ${unsaved.length} new asset(s) to the library (${unsaved.slice(0, 6).join(', ')}${unsaved.length > 6 ? ', …' : ''})\nDO: run \`npm run video -- save-all --job ${J}\`\nTHEN: ${NEXT}`};
  // 5. review
  let pack = null;
  try { pack = (await loadReviewPack(job, stage)).pack; } catch {}
  if (!pack) {
    const timing = await json(path.join(job, 'timing.json'));
    const iv = stage === 'prototype' ? prototypeInterval(timing, film, manifest.duration) : null;
    return {state: `review-pack ${stage}`, text: `STATE: freeze ${stage} review evidence\nDO: run \`npm run video -- review-pack --job ${J} --stage ${stage}${iv ? ` --start ${iv.start} --end ${iv.end}` : ''}\`\nTHEN: ${NEXT}`};
  }
  const status = await reviewStatus(job, stage);
  if (status.ok) {
    if (stage === 'prototype') return {state: 'prototype accepted', text: `STATE: prototype accepted by all reviewers\nTHEN: ${NEXT}`};
    return {state: 'deliver', text: `STATE: final reviews passed\nDO: run \`npm run video -- deliver --job ${J}\`\nTHEN: ${NEXT}`};
  }
  const pending = [], failed = [];
  for (const role of REVIEW_ROLES) {
    const r = status.reports.find(x => x.role === role);
    if (!r) pending.push(role); else if (r.verdict !== 'pass') failed.push(r);
  }
  if (failed.length) {
    const rounds = (manifest.reviewRounds?.[stage] || 0), packHash = await fileHash(path.join(job, `review/${stage}/pack.json`));
    if (manifest.reviewRoundPacks?.[stage] !== packHash) {
      if (rounds >= 4) return {state: 'blocked', text: `STATE: blocked — ${stage} review failed ${rounds} rounds.\nDO: stop and report to the user honestly: the film did not pass independent review. List the open blocking findings from ${J}/review/${stage}/reviews/. Do not call it complete.`};
      manifest.reviewRounds = {...(manifest.reviewRounds || {}), [stage]: rounds + 1};
      manifest.reviewRoundPacks = {...(manifest.reviewRoundPacks || {}), [stage]: packHash};
      await save(path.join(job, 'job.json'), manifest);
    }
    const findings = failed.flatMap(r => r.findings.filter(f => f.severity === 'blocking').map(f => ({text: `[${r.role} ${f.start.toFixed(1)}–${f.end.toFixed(1)}s] ${f.subject}: ${f.observed} → ${f.repair}`, start: f.start, end: f.end, scope: f.scope, sceneIds: f.sceneIds})));
    if (!findings.length) return {state:'blocked', text:`STATE: blocked — review is incomplete without actionable scene findings.\n${failed.flatMap(r=>r.inspection.limitations).join('\n')}\nDO: obtain the missing inspection capability/evidence and fresh independent reviews. Do not invent a creative repair or call this complete.`};
    if (findings.some(f=>f.scope==='plan') || ((manifest.reviewRounds?.[stage] || 0) >= 2 && failed.some(r=>r.role==='visual-mechanism'))) {
      const brief=await writeBrief(job,'director-revision.md',directorBrief(job,manifest,alignment,{repair:findings.map(f=>'- '+f.text).join('\n')}));
      manifest.reviewPlanRevision={filmHash:await fileHash(path.join(job,'film.json')),packHash};await save(path.join(job,'job.json'),manifest);
      // Preserve the old acceptance receipt as history, but a revised concept must
      // earn prototype acceptance again instead of borrowing the previous plan's.
      const receipt=path.join(job,'review/prototype/accepted.json');
      if (await exists(receipt)) {
        const {rename}=await import('node:fs/promises');
        await rename(receipt,path.join(job,`review/prototype/replanned-${packHash}.json`));
      }
      return {state:'revise plan',text:`STATE: revise the concept/ownership with the director\n${spawnOne('director', [brief],NEXT)}`};
    }
    return repairText(job, film, findings, NEXT, 'independent review');
  }
  const briefs = pending.map(role => path.join(job, 'briefs', `review-${stage}-${role}.md`));
  for (const b of briefs) if (!await exists(b)) return {state: 'review-pack', text: `STATE: reviewer briefs missing\nDO: run \`npm run video -- review-pack --job ${J} --stage ${stage}\`\nTHEN: ${NEXT}`};
  return {state: `review ${stage}`, text: `STATE: independent ${stage} review (${pending.join(', ')})\n${spawnOne('reviewer', briefs, NEXT)}\n    Reviewers must be new sub-agents that did not build any scene.`};
}

// The whole state machine as data, for `status` and the job UI. It follows nextStep's order
// but only reads: no briefs, receipts or review-round counters are written.
const PROGRESS_STEPS = [
  ['prepare', 'Narration timed to the script'], ['visuals', 'Visual plan'], ['plan', 'Film plan'],
  ['prototype-scenes', 'Context and prototype scenes'], ['prototype-build', 'Prototype build and checks'],
  ['prototype-render', 'Prototype render'], ['prototype-review', 'Independent prototype review'],
  ['scenes', 'Remaining scenes'], ['final-build', 'Full build and checks'],
  ['final-render', 'Final render and mix'], ['final-review', 'Independent final review'], ['deliver', 'Delivery qualified'],
];

export async function jobProgress(job) {
  const J = jr(job);
  const steps = PROGRESS_STEPS.map(([id, label]) => ({id, label, status: 'pending', detail: ''}));
  const step = id => steps.find(s => s.id === id);
  const out = {version: 1, job: J, state: '', current: '', steps, scenes: [], reviews: {}, checks: {}, next: null};
  // Steps before the current one are done; the machine is linear apart from repairs, which stay on their step.
  const at = (id, state, {status = 'current', detail = '', errors, next = null} = {}) => {
    const index = steps.findIndex(s => s.id === id);
    steps.forEach((s, i) => { s.status = i < index ? 'done' : i > index ? 'pending' : status; });
    if (detail) steps[index].detail = detail;
    if (errors?.length) steps[index].errors = errors.slice(0, 20).map(String);
    return Object.assign(out, {state, current: id, next});
  };

  let manifest;
  try { manifest = await json(path.join(job, 'job.json')); }
  catch { return at('prepare', 'not prepared', {detail: 'The job has not been prepared yet.'}); }
  out.film = {name: manifest.name, duration: manifest.duration, width: manifest.width, height: manifest.height, fps: manifest.fps};
  let ctx;
  try { ctx = await context(job); }
  catch (error) { return at('prepare', 'alignment review', {status: 'blocked', detail: error.message}); }
  step('prepare').detail = `${manifest.duration.toFixed(1)} s narration · ${(ctx.alignment.matchRatio * 100).toFixed(0)}% script match`;

  let film = null, planErrors = null, bounds = [];
  try { film = await json(path.join(job, 'film.json')); bounds = validateFilm(film, ctx.alignment, manifest.duration).scenes; }
  catch (error) { planErrors = error.errors || [error.message]; }
  const visuals = await visualsState(job);
  if (visuals) return at('visuals', 'visuals', {status: visuals.errors.length ? 'repair' : 'current',
    detail: visuals.errors.length ? `${VISUALS_FILE} has ${visuals.errors.length} problem(s)` : 'The script writer is planning the visuals', errors: visuals.errors,
    next: {role: 'script-writer', briefs: [`${J}/briefs/visuals.md`]}});
  step('visuals').detail = await exists(path.join(job, VISUALS_FILE)) ? VISUALS_FILE : 'No visual plan (planned before visual plans existed)';
  if (!film || planErrors) return at('plan', 'plan', {status: film ? 'repair' : 'current',
    detail: film ? `film.json has ${planErrors.length} error(s)` : 'The director is planning the film', errors: film ? planErrors : [],
    next: {role: 'director', briefs: [`${J}/briefs/director.md`]}});
  Object.assign(out.film, {title: film.title, concept: film.concept, prototype: film.prototype});
  step('plan').detail = `${film.scenes.length} scenes · prototype "${film.prototype}"`;

  // Facts first, then the decision.
  const read = file => json(path.join(job, file)).catch(() => null);
  const [timing, build, pixels, verification, receipt] = await Promise.all(
    ['timing.json', 'review/build.json', 'review/pixels.json', 'review/render-verification.json', 'review/render-source.json'].map(read));
  const source = await sourceFingerprint(job).catch(() => null);
  let accepted = await prototypeAccepted(job);
  const prototypeReview = accepted ? null : await reviewProgress(job, 'prototype');
  // nextStep records acceptance the next time it runs; a passing current review already counts.
  accepted ||= Boolean(prototypeReview?.ok);
  const stage = accepted ? 'final' : 'prototype';
  if (accepted) Object.assign(step('prototype-build'), {detail: 'Passed'}), Object.assign(step('prototype-render'), {detail: 'Rendered'}),
    Object.assign(step('prototype-review'), {detail: 'Accepted by all three reviewers'});
  out.reviews.prototype = await reviewSummary(job, 'prototype', manifest, prototypeReview);
  out.reviews.final = await reviewSummary(job, 'final', manifest, accepted ? await reviewProgress(job, 'final') : null);

  const briefNames = await readdir(path.join(job, 'briefs')).catch(() => []);
  const prototypeIndex = film.scenes.findIndex(s => s.id === film.prototype);
  const findings = out.reviews[stage].roles.flatMap(r => r.findings);
  out.scenes = await Promise.all(film.scenes.map(async (s, i) => {
    const spec = s.kind === 'html' ? s.file : `shots/${s.id}.json`;
    const info = await stat(path.join(job, spec)).catch(() => null);
    const t = timing?.scenes?.find(x => x.id === s.id) || bounds.find(b => b.id === s.id) || {};
    const mentions = text => { text = String(text); return text.includes(`shots/${s.id}.`) || text.includes(`[${s.id}]`) || text.includes(`[${s.id} `); };
    return {id: s.id, start: t.start ?? null, end: t.end ?? null, owner: sceneOwner(film, s.id), prototype: s.id === film.prototype,
      prototypeCut: i <= prototypeIndex, spec: `${J}/${spec}`, built: Boolean(info), updatedAt: info ? info.mtime.toISOString() : null,
      briefs: briefNames.filter(n => [`build-${s.id}.md`, `direct-${s.id}.md`, `repair-${s.id}.md`].includes(n)).map(n => `${J}/briefs/${n}`),
      buildErrors: (build?.errors || []).filter(mentions).length, buildWarnings: (build?.warnings || []).filter(mentions).length,
      pixelErrors: (pixels?.errors || []).filter(mentions).length,
      findings: findings.filter(f => f.sceneIds.includes(s.id) || (f.start != null && t.start != null && f.start < t.end && f.end > t.start)).length};
  }));
  const count = list => `${list.filter(s => s.built).length}/${list.length} built`;
  step('prototype-scenes').detail = count(out.scenes.filter(s => s.prototypeCut));
  step('scenes').detail = count(out.scenes.filter(s => !s.prototypeCut));

  const buildFresh = Boolean(build?.sourceHash && build.sourceHash === source && build.scope === 'all');
  const video = path.join(job, 'renders/video.mp4'), rendered = await exists(video);
  const renderFresh = Boolean(buildFresh && receipt && receipt.sourceHash === build.sourceHash && rendered && receipt.videoSha256 === await fileHash(video));
  out.checks = {
    build: build ? {ok: Boolean(build.ok), fresh: buildFresh, errors: build.errors?.length || 0, warnings: build.warnings?.length || 0} : null,
    render: {exists: rendered, fresh: renderFresh, verified: verification?.ok === true, pixelErrors: pixels?.errors?.length || 0},
  };

  if (manifest.status === 'complete') {
    try {
      const current = await qualifyDelivery(job), delivered = await json(path.join(job, 'review/delivery.json'));
      if (delivered.ok && delivered.videoSha256 === current.videoSha256 && delivered.sourceHash === current.sourceHash && delivered.packSha256 === current.packSha256) {
        steps.forEach(s => { s.status = 'done'; });
        step('deliver').detail = 'Delivered and qualified';
        return Object.assign(out, {state: 'done', current: 'deliver', next: null});
      }
    } catch { /* Stale completion re-enters production, as nextStep does. */ }
  }
  if (manifest.reviewPlanRevision && manifest.reviewPlanRevision.filmHash === await fileHash(path.join(job, 'film.json')))
    return at('plan', 'revise plan', {status: 'repair', detail: 'Independent review sent the concept back to the director',
      next: {role: 'director', briefs: [`${J}/briefs/director-revision.md`]}});

  const ids = accepted ? {scenes: 'scenes', build: 'final-build', render: 'final-render', review: 'final-review'}
    : {scenes: 'prototype-scenes', build: 'prototype-build', render: 'prototype-render', review: 'prototype-review'};
  const wanted = accepted ? out.scenes : out.scenes.filter(s => s.prototypeCut), missing = wanted.filter(s => !s.built);
  if (missing.length) {
    const first = missing[0], run = [];
    if (first.owner === 'director') for (const s of missing) { if (s.owner !== 'director') break; run.push(s.id); }
    return at(ids.scenes, `build ${stage}`, {detail: `${wanted.length - missing.length}/${wanted.length} built · next "${first.id}"`,
      next: first.owner === 'director' ? {role: 'director', briefs: [`${J}/briefs/direct-${first.id}.md`], scenes: run}
        : {role: 'builder', briefs: [`${J}/briefs/build-${first.id}.md`], scenes: [first.id]}});
  }
  if (!buildFresh) return at(ids.build, 'build', {detail: build ? 'Sources changed since the last build' : 'Not built yet', next: {command: 'build'}});
  if (!build.ok) return at(ids.build, 'repair', {status: 'repair', detail: `${build.errors.length} automated check error(s) to repair`, errors: build.errors});
  step(ids.build).detail = `Passed · ${build.warnings?.length || 0} style warning(s)`;
  if (!renderFresh) return at(ids.render, 'render', {detail: rendered ? 'Sources changed since the last render' : 'Not rendered yet', next: {command: 'render'}});
  if (pixels?.errors?.length) return at(ids.render, 'repair', {status: 'repair', detail: `${pixels.errors.length} pixel check problem(s) to repair`, errors: pixels.errors});
  step(ids.render).detail = verification?.ok ? 'Rendered, mixed and verified' : 'Rendered';
  const unsaved = await unsavedFiles(LIBRARY, job);
  if (unsaved.length) return at(ids.review, 'save assets', {detail: `Saving ${unsaved.length} new asset(s) to the library before review`, next: {command: 'save-all'}});
  const review = out.reviews[stage];
  if (!review.pack) return at(ids.review, `review-pack ${stage}`, {detail: 'Freezing rendered evidence for reviewers', next: {command: 'review-pack'}});
  if (review.ok) {
    step(ids.review).detail = 'All three reviewers passed';
    return at('deliver', 'deliver', {detail: 'Final reviews passed', next: {command: 'deliver'}});
  }
  const failed = review.roles.filter(r => r.valid && r.verdict !== 'pass'), pending = review.roles.filter(r => !r.valid);
  if (failed.length) return at(ids.review, review.rounds >= 4 ? 'blocked' : 'repair', {status: review.rounds >= 4 ? 'blocked' : 'repair',
    detail: `${failed.map(r => r.role).join(', ')} found blocking problems · round ${review.rounds || 1}`});
  return at(ids.review, `review ${stage}`, {detail: `${3 - pending.length}/3 reviews in · waiting for ${pending.map(r => r.role).join(', ')}`,
    next: {role: 'reviewer', briefs: pending.map(r => `${J}/briefs/review-${stage}-${r.role}.md`)}});
}

async function reviewSummary(job, stage, manifest, status) {
  let directory = `review/${stage}/reviews`, accepted = false;
  if (stage === 'prototype' && !status) {
    const receipt = await json(path.join(job, 'review/prototype/accepted.json')).catch(() => null);
    if (receipt?.path) { directory = receipt.path; accepted = true; }
  }
  const errors = status?.errors || [];
  const roles = await Promise.all(REVIEW_ROLES.map(async role => {
    const report = await json(path.join(job, directory, `${role}.json`)).catch(() => null);
    const error = errors.find(e => e.startsWith(`${role}:`))?.slice(role.length + 2) || '';
    // A report counts when it validates against the current pack; a valid non-pass verdict is still a valid report.
    let valid = false;
    if (report && accepted) valid = true;
    else if (report && status) valid = !error || error === report.verdict;
    const list = Array.isArray(report?.findings) ? report.findings : [];
    return {role, verdict: report?.verdict || null, valid, error: report && !valid ? error : '', reviewer: report?.reviewer?.agentId || '',
      blocking: list.filter(f => f.severity === 'blocking').length, advisory: list.filter(f => f.severity !== 'blocking').length,
      findings: list.filter(f => f.severity === 'blocking').slice(0, 12).map(f => ({sceneIds: Array.isArray(f.sceneIds) ? f.sceneIds : [],
        start: f.start ?? null, end: f.end ?? null, subject: f.subject || '', observed: f.observed || '', repair: f.repair || ''}))};
  }));
  return {stage, accepted, pack: accepted || Boolean(status?.pack), packError: status && !status.pack && !status.missing ? errors[0] : '',
    ok: accepted || Boolean(status?.ok), interval: status?.interval || null, roles, rounds: manifest.reviewRounds?.[stage] || 0};
}

async function repairText(job, film, findings, NEXT, source) {
  const {manifest, alignment} = await context(job), timing = await json(path.join(job, 'timing.json')), byScene = new Map();
  for (const f of findings) {
    let ids = (f.sceneIds || []).filter(id=>film.scenes.some(s=>s.id===id));
    if (!ids.length) ids = film.scenes.map(s => s.id).filter(id => f.text.includes(`[${id}]`) || f.text.includes(`shots/${id}.`) || f.text.includes(`[${id} `));
    if (!ids.length && f.start != null) ids = timing.scenes.filter(s => s.start < f.end + 0.01 && s.end > f.start).map(s => s.id);
    if (!ids.length) { const m = /t=([\d.]+)s/.exec(f.text); if (m) ids = timing.scenes.filter(s => s.start <= +m[1] && s.end > +m[1]).map(s => s.id); }
    if (!ids.length) ids = [film.prototype];
    for (const id of ids) { if (!byScene.has(id)) byScene.set(id, []); byScene.get(id).push(f.text); }
  }
  // Scenes the director owns go back to one director; delegated scenes go to their own builders, in parallel.
  const groups = [{role: 'director', briefs: []}, {role: 'builder', briefs: []}], mine = [];
  for (const [id, list] of byScene) {
    const s = timing.scenes.find(x => x.id === id); if (!s) continue;
    if (sceneOwner(film, id) === 'director') { mine.push({s, list}); continue; }
    groups[1].briefs.push(await writeBrief(job, `repair-${id}.md`, builderBrief(job, manifest, film, s, alignment, {repair: list.map(x => `- ${x}`).join('\n'), prior: await priorObjects(job, film, id)})));
  }
  if (mine.length) groups[0].briefs.push(await writeBrief(job, 'repair-director.md', directorSceneBrief(job, manifest, film, mine.map(m => m.s), alignment,
    {repair: mine.map(m => `### ${m.s.id}\n${m.list.map(x => `- ${x}`).join('\n')}`).join('\n')})));
  return {state: 'repair', text: `STATE: repair (${findings.length} problem(s) from ${source} in ${[...byScene.keys()].join(', ')})\n${spawnText(groups.filter(g => g.briefs.length), NEXT)}`};
}

export async function writeProductionReport(job) {
  const manifest = await json(path.join(job, 'job.json')), film = await json(path.join(job, 'film.json'));
  const build = await json(path.join(job, 'review/build.json')).catch(() => ({})), pixels = await json(path.join(job, 'review/pixels.json')).catch(() => ({}));
  const verification = await json(path.join(job, 'review/render-verification.json')).catch(() => ({}));
  const alignment = await json(path.join(job, 'alignment.json'));
  const lines = [`# Production report — ${film.title}`, '', `- Recording: ${manifest.audio.source} from ${manifest.audio.sourceStart}s, ${manifest.duration.toFixed(2)}s; ${manifest.width}×${manifest.height} @ ${manifest.fps} fps`,
    `- Alignment: ASR word timestamps reconciled with the script (${(alignment.matchRatio * 100).toFixed(1)}% exact matches); not forced alignment. ${alignment.review?.note ? 'Review: ' + alignment.review.note : ''}`,
    `- Concept: ${film.concept}`, `- Scenes: ${film.scenes.map(s => s.id).join(', ')}`, '', '## Automated checks',
    `- Build/DOM inspection: ${build.ok ? 'pass' : 'FAIL'} (${(build.errors || []).length} errors, ${(build.warnings || []).length} warnings)`,
    ...Object.entries(build.report?.scenes || {}).map(([id, r]) => `  - ${id}: frame use ${Math.round(r.frameUse * 100)}%, longest still ${r.longestStill}s, developing elements per 3 s: ${r.windows.join(' ')}`),
    `- Pixel checks on the render: ${pixels.ok ? 'pass' : 'FAIL'}`, ...Object.entries(pixels.scenes || {}).map(([id, r]) => `  - ${id}: content box ${Math.round(r.contentBox * 100)}%, longest frozen ${r.longestFrozen}s`),
    `- Media verification: ${verification.ok ? 'pass' : 'missing'} (${verification.width}×${verification.height}, ${verification.fps}, ${verification.duration?.toFixed?.(2)}s, narration correlation ${verification.narrationIntegrity?.correlation?.toFixed?.(4)})`,
    '', '## Warnings', ...(build.warnings || []).map(w => `- ${w}`), '', '## Limitations',
    '- Still frames and the motion transcript do not prove motion quality; reviewers report their own inspection limits.', '- Cue times come from ASR estimates.', ''];
  await writeFile(path.join(job, 'review/REPORT.md'), lines.join('\n'));
}

export async function listScenes(job) { return (await readdir(path.join(job, 'shots')).catch(() => [])).filter(f => f.endsWith('.json')); }
