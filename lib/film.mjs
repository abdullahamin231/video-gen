
// Film-mode production: film.json + shots/*.json → compiled world → checks → render → review → delivery.
// Every command ends by telling the agent the next step; `next` derives the whole state machine from files.
import {readFile, writeFile, mkdir, access, readdir, stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeWords, browserCues} from './timing.mjs';
import {compileFilm, validateFilm, SpecError, storyboardMarkdown, sceneOwner} from './composition.mjs';
import {writeRoot, installRuntime} from './composition.mjs';
import {mixdown} from './mix.mjs';
import {soundCheck} from './sound-check.mjs';
import {inspectFilm, writeInspection, openInspector} from './inspect.mjs';
import {pixelChecks} from './pixels.mjs';
import {verifyCaptureVisibility} from './capture-visibility.mjs';
import {lintJob, removeRenderTempFiles} from './lint.mjs';
import {newsDirectorBrief, directorBrief, directorSceneBrief, builderBrief, reviewerBrief, visualsBrief, writeBrief} from './briefs.mjs';
import {VISUALS_FILE} from './timing.mjs';
import {sourceFingerprint, fileHash, reviewProgress, loadReviewPack, writeReviewFile, reviewHistory, maxReviewRounds, REVIEW_ROLES} from './review.mjs';
import {classifyFailure} from './failure.mjs';
import {verifyLibraryCopies} from './library.mjs';
import {humanStages, humanDecision, humanFindings} from './human.mjs';
import {isNews, newsPlan, buildNews, muxNews, verifyNews} from './news.mjs';
import {readPersonality, assertRenderReady} from './personalities.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIBRARY = process.env.VG_LIBRARY || path.join(ROOT, 'library');
const json = async f => JSON.parse(await readFile(f, 'utf8'));
const save = (f, v) => writeFile(f, JSON.stringify(v, null, 2) + '\n');
const exists = async f => { try { await access(f); return true; } catch { return false; } };
const jr = job => path.relative(ROOT, job);

export async function verifyAppCaptureSources(job) {
  const world = await json(path.join(job, 'assets/media-plan.json'));
  const sources = [];
  for (const media of (world.objects || []).filter(object => object.type === 'video')) {
    const file = path.resolve(job, media.src || '');
    const relative = path.relative(job, file);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error(`App-review capture source escapes the job: ${media.src}`);
    const probe = await new Promise((resolve, reject) => {
      const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], {stdio: ['ignore', 'pipe', 'pipe']});
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
      child.on('error', reject); child.on('close', code => code === 0 ? resolve(Number(stdout.trim())) : reject(new Error(stderr.trim())));
    }).catch(error => { throw new Error(`App-review capture ${media.id} is missing or unreadable (${media.src}): ${error.message}`); });
    const start = Math.max(0, Number(media.sourceStart ?? media.trimStart) || 0);
    const requested = Number(media.sourceDuration ?? media.trimDuration ?? media.clipDuration ?? media.mediaDuration);
    if (!Number.isFinite(probe) || !Number.isFinite(requested) || requested <= 0 || probe + 0.08 < start + requested)
      throw new Error(`App-review capture ${media.id} ends before its requested playback interval (${start.toFixed(2)}–${(start + requested).toFixed(2)}s; source ${probe.toFixed(2)}s).`);
    sources.push({id: media.id, src: media.src, sourceDuration: probe, sourceStart: start, expectedDuration: requested});
  }
  return sources;
}

export async function context(job) {
  assertRenderReady(readPersonality(job));
  const manifest = await json(path.join(job, 'job.json')), alignment = await json(path.join(job, 'alignment.json'));
  normalizeWords(alignment.words, isNews(readPersonality(job)) ? (manifest.commentaryDuration || manifest.duration) : manifest.duration);
  if (manifest.audio?.sha256 && await fileHash(path.join(job, 'assets/narration.wav')) !== manifest.audio.sha256)
    throw new Error('Narration changed since preparation. Create a new job instead of reusing stale timings.');
  if (alignment.matchRatio < 0.85 && !(alignment.review?.approved && alignment.review.note?.trim()))
    throw new Error(`Script match is only ${(alignment.matchRatio * 100).toFixed(0)}%. Inspect alignment.json discrepancies, then record them: npm run video -- alignment-approve --job ${jr(job)} --note "<what differs and why the recording is followed>"`);
  return {manifest, alignment};
}
// Accepted by all three independent reviewers of the full film.

export function printSpecError(error) {
  console.error(`\n${error.errors.length} error(s):`);
  for (const e of error.errors) console.error(`  ✗ ${e}`);
  if (error.warnings?.length) { console.error(`\n${error.warnings.length} warning(s):`); for (const w of error.warnings) console.error(`  ! ${w}`); }
}

export async function planCheck(job) {
  if (isNews(readPersonality(job))) { const plan = await newsPlan(job); console.log(`News plan valid: ${plan.edit.scenes.length} scenes, ${plan.captions.length} subtitle cues.`); return plan; }
  const {manifest, alignment} = await context(job);
  const film = await json(path.join(job, 'film.json')).catch(e => { throw new SpecError([`film.json: ${e.code === 'ENOENT' ? 'missing' : 'invalid JSON: ' + e.message}`]); });
  const {scenes, warnings} = validateFilm(film, alignment, manifest.duration);

  const timing = {scenes: scenes.map(s => ({...s, kind: film.scenes.find(x => x.id === s.id).kind || 'shots'}))};
  // Same storyboard as build writes (including builder notes): it is a source file, so the two must agree
  // or every plan-check would make the last build look stale.
  for (const s of timing.scenes) {
    const shot = await json(path.join(job, `shots/${s.id}.json`)).catch(() => null);
    if (typeof shot?.notes === 'string' && shot.notes.trim()) s.notes = shot.notes;
    // Black app states cannot be distinguished from missing playback in luma
    // samples alone. Preserve a scene-scoped rationale in pixel-check evidence.
    if (typeof shot?.blackScreenReason === 'string' && shot.blackScreenReason.trim())
      s.blackScreenReason = shot.blackScreenReason.trim();
  }
  await writeFile(path.join(job, 'STORYBOARD.md'), storyboardMarkdown(film, timing));
  for (const s of timing.scenes) if (sceneOwner(film, s.id) === 'builder') await writeBrief(job, `build-${s.id}.md`, builderBrief(job, manifest, film, s, alignment, {prior: await priorObjects(job, film, s.id)}));
  console.log(`Plan valid: ${scenes.length} scenes.`);
  for (const s of scenes) console.log(`  ${s.id.padEnd(22)} ${s.start.toFixed(2).padStart(7)}–${s.end.toFixed(2).padEnd(7)} (${s.duration.toFixed(1)}s) ${sceneOwner(film, s.id)}`);
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
  if (isNews(readPersonality(job))) return buildNews(job, {print});
  const {manifest, alignment} = await context(job);
  const film = await json(path.join(job, 'film.json'));
  if (allowMissing == null) allowMissing = false;
  await installRuntime(job);
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
  await save(path.join(job, 'timing.json'), timing);
  await writeFile(path.join(job, 'assets/cues.js'), `/* Generated from measured words and film.json/shots; do not hand-edit. */\nwindow.VideoCues = ${JSON.stringify(browserCues(timing), null, 2)};\n`);
  await save(path.join(job, 'assets/media-plan.json'), world);
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
  // HyperFrames lint runs here, not only at render, so its errors go to the scene's owner like any other check.
  let pipelineErrors = [];
  if (inspect && !scene) {
    const lint = await lintJob(job, film);
    allErrors.push(...lint.errors); allWarnings.push(...lint.warnings); pipelineErrors = lint.pipeline;
  }
  const sourceHash = await sourceFingerprint(job);
  const ok = !allErrors.length && !pipelineErrors.length;
  await save(path.join(job, 'review/build.json'), {ok, scope: scene || 'all', missing: timing.missing, sourceHash, errors: allErrors, pipelineErrors, warnings: allWarnings, report: result.report});
  if (print) {
    if (result.transcript) {
      const t = scene ? sliceTranscript(result.transcript, scene) : result.transcript;
      console.log(t.length > 12000 ? t.slice(0, 12000) + `\n… (full transcript: ${jr(job)}/review/motion.md)` : t);
    }
    const sounds = world.sounds.filter(x => !scene || x.scene === scene);
    if (sounds.length) console.log(`\nSound effects: ${sounds.length} placed${scene ? ` in ${scene}` : ''} (${jr(job)}/review/sounds.md).`);
    for (const w of allWarnings.filter(w => !scene || w.includes(scene) || !/\[|shots\//.test(w))) console.log(`  ! ${w}`);
    for (const e of allErrors) console.log(`  ✗ ${e}`);
    for (const e of pipelineErrors) console.log(`  ✗ PIPELINE BUG (generated code, not an agent's file): ${e}`);
    console.log(`\nBuild ${ok ? 'OK' : 'FAILED'}: ${allErrors.length + pipelineErrors.length} error(s), ${allWarnings.length} warning(s)${timing.missing.length ? `; scenes not built yet: ${timing.missing.join(', ')}` : ''}.`);
  }
  return {ok, errors: allErrors, pipelineErrors, warnings: allWarnings, timing, sourceHash};
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
  assertRenderReady(readPersonality(job));
  const errors = [...await verifyLibraryCopies(job)], warnings = [];
  const root = await readFile(path.join(job, 'index.html'), 'utf8').catch(() => '');
  const news = isNews(readPersonality(job));
  if (news) await newsPlan(job);
  if (!news && !root.includes('assets/narration.wav')) errors.push('index.html missing narration; run build');
  const build = await json(path.join(job, 'review/build.json')).catch(() => null);
  if (!build) errors.push('No build record; run build.');
  else { if (!build.ok && !allowBuildErrors) errors.push(`Last build has ${build.errors.length} error(s); fix them and rebuild.`); if (build.sourceHash !== await sourceFingerprint(job)) errors.push('Sources changed since the last build; run build again.'); }
  const report = {ok: !errors.length, errors, warnings};
  await save(path.join(job, 'review/audit.json'), report);
  if (errors.length) { for (const e of errors) console.error(`  ✗ ${e}`); throw new Error('Pipeline audit failed.'); }
  return report;
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
  assertRenderReady(readPersonality(job));
  if (workers != null && workers !== 'auto' && (!Number.isInteger(Number(workers)) || Number(workers) < 1))
    throw new Error('Render workers must be a positive integer or auto.');
  let manifest = await json(path.join(job, 'job.json'));
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
  manifest = await json(path.join(job, 'job.json')); // News build resolves full editorial duration from commentary plus excerpts.
  if (!built.ok && !force) throw new Error('Build has errors; fix them before rendering (see above).');
  await filmAudit(job, {allowBuildErrors: force});
  const sourceHash = await sourceFingerprint(job);
  manifest.status = 'rendering'; delete manifest.completedAt; delete manifest.delivery; await save(path.join(job, 'job.json'), manifest);
  await removeRenderTempFiles(job);
  await hf(['lint'], {cwd: job}).catch(() => { throw new Error('HyperFrames lint failed (see above).'); });
  await captureFrames(job, hf, {quality, fps: manifest.fps, workers});
  const news = isNews(readPersonality(job));
  if (news) { await muxNews(job); await verifyNews(job); }
  // The soundtrack is mixed and mastered here (narration + sound effects + ducked music), then muxed and measured.
  if (!news) {
    const mixed = await mixdown(job, {world: await json(path.join(job, 'assets/media-plan.json')), film: await json(path.join(job, 'film.json')), manifest});
    await finishSound(job, mixed, verify);
  }
  if (sourceHash !== await sourceFingerprint(job)) throw new Error('Sources changed during rendering. Render again.');
  const timing = await json(path.join(job, 'timing.json'));
  const scoped = {...timing, scenes: timing.scenes.filter(s => !(timing.missing || []).includes(s.id))};
  const appReview = readPersonality(job).profile.id === 'app-review';
  const captureSources = appReview ? await verifyAppCaptureSources(job) : undefined;
  const captureVisibility = appReview ? await verifyCaptureVisibility(job, path.join(job, 'renders/video.mp4'), await json(path.join(job, 'assets/media-plan.json'))) : undefined;
  const verifiedBlackIntervals = captureVisibility?.captures.filter(c => c.status === 'verified').flatMap(c => c.blackIntervals || []) || [];
  const pixels = await pixelChecks(path.join(job, 'renders/video.mp4'), scoped, {strictBlank: appReview, verifiedBlackIntervals});
  const videoSha256 = await fileHash(path.join(job, 'renders/video.mp4'));
  const visibilityErrors = captureVisibility?.captures.filter(c => c.status === 'failed').map(c => `[${c.scene}] ${c.id}: ${c.reason}`) || [];
  const verifiedPixels = {...pixels, errors: [...pixels.errors, ...visibilityErrors], ok: pixels.ok && !visibilityErrors.length,
    ...(captureSources ? {captureSources, captureVisibility} : {}), videoSha256, sourceHash};
  await save(path.join(job, 'review/pixels.json'), verifiedPixels);
  await save(path.join(job, 'review/render-source.json'), {version: 1, sourceHash, videoSha256});
  manifest.status = 'draft-rendered'; await save(path.join(job, 'job.json'), manifest);
  for (const e of verifiedPixels.errors) console.log(`  ✗ ${e}`);
  if (captureVisibility?.coverage.unverified) console.log(`  ! Capture visibility unverified for ${captureVisibility.coverage.unverified} scene(s); see review/pixels.json.`);
  console.log(`Rendered ${jr(job)}/renders/video.mp4 (${verifiedPixels.errors.length} playback verification error(s)).`);
  return {pixels: verifiedPixels};
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
  if (isNews(readPersonality(job))) throw new Error('News audio is part of the reviewed timeline; edit news.json, build, review and render again.');
  assertRenderReady(readPersonality(job));
  const receipt = await json(path.join(job, 'review/render-source.json')).catch(() => null), sourceHash = await sourceFingerprint(job);
  if (!receipt || receipt.sourceHash !== sourceHash || !await exists(path.join(job, 'renders/picture.mp4')))
    throw new Error('mix needs an up-to-date render (renders/picture.mp4 from the current sources). Run render.');
  const manifest = await json(path.join(job, 'job.json'));
  const mixed = await mixdown(job, {world: await json(path.join(job, 'assets/media-plan.json')), film: await json(path.join(job, 'film.json')), manifest});
  await finishSound(job, mixed, verify);
  await save(path.join(job, 'review/render-source.json'), {version: 1, sourceHash, videoSha256: await fileHash(path.join(job, 'renders/video.mp4'))});
  return mixed;
}

export async function writeReviewerBriefs(job, pack, packPath, packSha256) {
  const out = [], manifest = JSON.parse(await readFile(path.join(job, 'job.json'), 'utf8'));
  const historyPath = `review/${pack.stage}/prior-decisions-${packSha256}.json`;
  await writeReviewFile(job, historyPath, JSON.stringify(await reviewHistory(job, pack.stage), null, 2) + '\n');
  manifest.priorReviewHistoryPath = path.join(job, historyPath);
  for (const role of REVIEW_ROLES) out.push({role, path: await writeBrief(job, `review-${pack.stage}-${role}.md`, reviewerBrief(job, role, pack, packPath, packSha256, null, manifest))});
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
    priorFindingResponses: [],
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


function humanReviewText(J, stage, NEXT) {
  return [`STATE: human review of the ${stage} (the independent reviews passed; the person who asked for the film decides next)`,
    `DO: ask the user to watch the ${stage} and approve it or say what to change at which moment.`,
    `    With the video runner: call checkpoint {kind: "${stage}", summary: "<one line on what they will see>"}. The UI shows the film with a scene strip and saves their decision itself.`,
    `    Without it: tell them to run \`npm run video -- play --job ${J}\` and open the address it prints, then record what they say word for word:`,
    `    \`npm run video -- human-review --job ${J} --stage ${stage} --decision approve\` or`,
    `    \`npm run video -- human-review --job ${J} --stage ${stage} --decision revise --note "12.5: <their words>" [--note "..."]\``,
    `    Never decide for them and never reword their notes.`,
    `THEN: ${NEXT}`].join('\n');
}

/**
 * A delivered film stays delivered while its MP4 and sources are the ones the delivery receipt recorded. Reviews are
 * not re-validated here: rules added to the pipeline after delivery must not send a finished film back into production.
 * Only an explicit `--reopen true` on a production command (which clears the status) re-enters it.
 */
export async function deliveredIntact(job, manifest) {
  if (manifest.status !== 'complete') return false;
  try {
    const delivered = await json(path.join(job, 'review/delivery.json'));
    return Boolean(delivered.ok && delivered.videoSha256 === await fileHash(path.join(job, 'renders/video.mp4'))
      && delivered.sourceHash === await sourceFingerprint(job));
  } catch { return false; }
}

export async function nextStep(job) {
  const J = jr(job), NEXT = `npm run video -- next --job ${J}`;
  try { assertRenderReady(readPersonality(job)); }
  catch (error) { return {state: 'blocked', text: `STATE: blocked\n${error.message}`}; }
  const manifest = await json(path.join(job, 'job.json'));
  if (await deliveredIntact(job, manifest))
    return {state: 'done', text: `STATE: done\nThe film is delivered: ${J}/renders/video.mp4\nDO: make the thumbnail: follow \`npm run video -- thumbnails --job ${J}\` (same DO/spawn steps) until it says done. Then report the MP4 and thumbnail paths to the user with a short verification note from ${J}/review/delivery.json (its reviewDisposition, unresolvedFindings, limitations and advisory findings). Do not open a preview or change the film's files: the delivery is final.`};
  let ctx;
  try { ctx = await context(job); } catch (error) { return {state: 'alignment', text: `STATE: alignment-review\n${error.message}\nTHEN: ${NEXT}`}; }
  const {alignment} = ctx;
  const personality = readPersonality(job), news = isNews(personality), appReview = personality.profile.id === 'app-review';
  if (news) {
    try { await newsPlan(job); } catch (error) {
      const brief = await writeBrief(job, 'news-edit.md', newsDirectorBrief(job));
      return {state:'news sources/plan',text:`STATE: news sources/plan\n${error.message}\n${spawnOne('director',[brief],NEXT)}`};
    }
    const build = await json(path.join(job,'review/build.json')).catch(()=>null);
    if (!build || build.sourceHash !== await sourceFingerprint(job)) return {state:'build',text:`STATE: build news edit\nDO: run \`npm run video -- build --job ${J}\`\nTHEN: ${NEXT}`};
  }
  // 1. plan
  let film = null, planErrors = null;
  try { film = await json(path.join(job, 'film.json')); if (!news) validateFilm(film, alignment, manifest.duration); }
  catch (error) { planErrors = error.errors || [error.message]; }
  if (!film || planErrors) {
    const brief = await writeBrief(job, 'director.md', directorBrief(job, manifest, alignment, {planErrors: film ? planErrors : null}));
    return {state: 'plan', text: `STATE: plan the film${film ? ` (film.json has ${planErrors.length} error(s))` : ''}\n${spawnOne('director', [brief], NEXT)}`};
  }
  if (manifest.reviewPlanRevision) {
    if (manifest.reviewPlanRevision.filmHash === await fileHash(path.join(job,news ? 'news.json' : 'film.json')))
      return {state:'revise plan',text:`STATE: revise the concept/ownership with the director\n${spawnOne('director', [path.join(job,'briefs/director-revision.md')],NEXT)}`};
    delete manifest.reviewPlanRevision; await save(path.join(job,'job.json'),manifest);
  }
  if (!news) await planCheck(job).catch(() => {});
  // Build every scene in order. The director builds each run of consecutive scenes it owns, so the picture stays
  // in one head; a builder scene is handed over only when the director assigned it in film.json.
  const missing = [];
  for (const s of news ? [] : film.scenes) if (!await exists(path.join(job, s.kind === 'html' ? s.file : `shots/${s.id}.json`))) missing.push(s);
  if (missing.length) {
    const first = missing[0];
    if (sceneOwner(film, first.id) === 'director') {
      const run = [];
      for (const s of missing) { if (sceneOwner(film, s.id) !== 'director') break; run.push(s); }
      const {scenes: bounds} = validateFilm(film, alignment, manifest.duration);
      const brief = await writeBrief(job, `direct-${first.id}.md`, directorSceneBrief(job, manifest, film, run.map(s => bounds.find(b => b.id === s.id)), alignment));
      return {state: 'build', text: `STATE: the director builds ${run.map(s => `"${s.id}"`).join(', ')}\n${spawnOne('director', [brief], NEXT)}`};
    }
    return {state: 'build', text: `STATE: build scene "${first.id}"\n${spawnOne('builder', [path.join(job, 'briefs', `build-${first.id}.md`)], NEXT)}`};
  }
  // 2. build
  const build = await json(path.join(job, 'review/build.json')).catch(() => null);
  const fresh = build && build.sourceHash && build.sourceHash === await sourceFingerprint(job) && build.scope === 'all';
  if (!fresh) return {state: 'build', text: `STATE: build and check\nDO: run \`npm run video -- build --job ${J}\`\nTHEN: ${NEXT}`};
  if (build.pipelineErrors?.length) return {state: 'pipeline bug', text: `STATE: pipeline bug: HyperFrames rejects code the pipeline generated, which no agent may edit\n${build.pipelineErrors.map(e => `  ✗ ${e}`).join('\n')}\nDO: stop and report these errors to the user word for word; the fix belongs in the pipeline (lib/composition.mjs or lib/film.mjs). Do not edit job files to work around it.\nTHEN: once the user says it is fixed, run \`npm run video -- build --job ${J}\` and then ${NEXT}`};
  if (!build.ok) {
    const failure = classifyFailure(build.errors);
    if (failure.isInfrastructure)
      return {state: 'infrastructure', text: `STATE: infrastructure blocked — the build failed on the environment, not the film\n${failure.infrastructure.map(e => `  ✗ ${e}`).join('\n')}${failure.film.length ? `\nFilm errors also present, but fix the environment first:\n${failure.film.map(e => `  · ${e}`).join('\n')}` : ''}\nDO: fix the missing tool/module/browser/disk/network problem above, then run \`npm run video -- build --job ${J}\`.\nNo creative repair brief was written. Do not edit film scenes to work around this failure.\nTHEN: ${NEXT}`};
    return repairText(job, film, build.errors.map(e => ({text: e})), NEXT, 'the automated checks');
  }
  // 3. everything the film brought in or made is saved to the library before it is reviewed
  // App-review claims are grounded in browser footage. Its review must see the
  // actual encoded playback, since seeking the HTML timeline can leave video frames
  // cached and conceal media-slot gaps that appear during a real render.
  if (appReview) {
    const receipt = await json(path.join(job, 'review/render-source.json')).catch(() => null);
    const current = receipt && receipt.sourceHash === await sourceFingerprint(job) && await exists(path.join(job, 'renders/video.mp4')) && receipt.videoSha256 === await fileHash(path.join(job, 'renders/video.mp4'));
    if (!current) return {state: 'render for playback review', text: `STATE: render the complete app-review film before final review so reviewers inspect encoded playback\nDO: run \`npm run video -- render --job ${J} --reuse-build true\`\nTHEN: ${NEXT}`};
    const pixels = await json(path.join(job, 'review/pixels.json')).catch(() => ({errors: []}));
    if (pixels.errors?.length) return repairText(job, film, pixels.errors.map(text => ({text})), NEXT, 'the encoded app-review pixel checks');
    const unverified = pixels.captureVisibility?.captures?.filter(c => c.status === 'unverified') || [];
    if (unverified.length) {
      const inspectionFile=path.join(job,'review/capture-visibility-dispositions.json');
      const inspection=await json(inspectionFile).catch(()=>null);
      if (!inspection || inspection.sourceHash!==pixels.sourceHash || inspection.videoSha256!==pixels.videoSha256)
        return {state:'generate capture inspection evidence',text:`STATE: generate canonical paired source/render frames for ${unverified.length} unverified capture interval(s)\nDO: run \`npm run video -- capture-visibility --job ${J} --generate\`\nTHEN: ${NEXT}`};
      if (inspection.dispositions?.some(d=>d.decision==='reject'))
        return repairText(job,film,inspection.dispositions.filter(d=>d.decision==='reject').map(d=>({text:`Independent visual reviewer rejected ${d.captureId}: ${d.observation||'no observation supplied'}`})),NEXT,'independent capture-visibility inspection');
      const verdictFile=path.join(job,'review/independent-verdict.json');
      if (inspection.dispositions?.some(d=>d.status!=='visually-inspected')) {
        if (await exists(verdictFile)) return {state:'record capture inspection verdict',text:`STATE: record independent capture-visibility review\nDO: run \`npm run video -- capture-visibility --job ${J} --record ${path.relative(ROOT,verdictFile)}\`\nTHEN: ${NEXT}`};
        const brief=path.join(job,'briefs/capture-visibility-review.md');
        await mkdir(path.dirname(brief),{recursive:true});
        await writeFile(brief,`# Independent capture-visibility inspection\n\nInspect every paired source-frame and render-frame PNG named in \`review/capture-visibility-dispositions.json\`. The images are at 10%, 50%, and 90% of each exact interval. Compare whether the encoded render still shows the actual app recording throughout; inspect scene continuity and visibility, not merely whether both files decode. You did not build these scenes.\n\nReturn \`review/independent-verdict.json\` with this shape and the current hashes copied from the disposition document:\n\n\`\`\`json\n{"sourceHash":"...","videoSha256":"...","reviewer":{"agentId":"your agent id","independent":true},"dispositions":[{"captureId":"...","sceneId":"...","decision":"acceptable or reject","observation":"what the paired frames show"}]}\n\`\`\`\n\nProvide one evidence-based verdict per capture. Reject when the app content is absent, obscured, or materially inconsistent. Do not claim pixel verification; this is a visual judgment.\n`);
        return {state:'independent capture-visibility review',text:`STATE: independent visual inspection of unverified capture interval(s)\n${spawnOne('reviewer',[brief],NEXT)}\n    Reviewers must be new reviewer-role agents that did not build these scenes.`};
      }
    }
  }
  // 4. review the evidence frozen from the current source or encoded output
  let loaded = null;
  try { loaded = await loadReviewPack(job, 'final'); } catch {}
  if (!loaded) {
    const from = appReview ? ' --from render' : '';
    return {state: 'review-pack final', text: `STATE: freeze final review evidence ${from ? 'from the encoded render' : 'from the built film (no render)'}\nDO: run \`npm run video -- review-pack --job ${J} --stage final${from}\`\nTHEN: ${NEXT}`};
  }
  const {pack, packSha256} = loaded;
  const status = await reviewProgress(job, 'final');
  if (status.ok) {
    if ((await humanStages(job)).includes('final')) {
      const decision = await humanDecision(job, 'final', packSha256);
      if (!decision) return {state: 'human review final', text: humanReviewText(J, 'final', NEXT)};
      if (decision.decision === 'revise') return repairText(job, film, humanFindings(decision, pack), NEXT, 'your review');
    }
    // 5. one render, of exactly the reviewed sources
    const receipt = await json(path.join(job, 'review/render-source.json')).catch(() => null);
    const renderFresh = receipt && receipt.sourceHash === pack.sourceHash && await exists(path.join(job, 'renders/video.mp4')) && receipt.videoSha256 === await fileHash(path.join(job, 'renders/video.mp4'));
    if (!renderFresh) return {state: 'render', text: `STATE: final review complete; render the film once (any unresolved findings are recorded in delivery)\nDO: run \`npm run video -- render --job ${J} --reuse-build true\` (takes a few minutes)\nTHEN: ${NEXT}`};
    const pixels = await json(path.join(job, 'review/pixels.json')).catch(() => ({errors: []}));
    if (pixels.errors?.length) return repairText(job, film, pixels.errors.map(e => ({text: e})), NEXT, 'pixel checks on the render');
    return {state: 'deliver', text: `STATE: rendered from the reviewed film\nDO: run \`npm run video -- deliver --job ${J}\`\nTHEN: ${NEXT}`};
  }
  const pending = [], failed = [];
  for (const role of REVIEW_ROLES) {
    const r = status.reports.find(x => x.role === role);
    if (!r) pending.push(role); else if (r.verdict !== 'pass') failed.push(r);
  }
  // Collect the entire round before routing repairs: never lose later reviewers' findings. Identical findings from
  // different roles are one repair, not two.
  if (failed.length && !pending.length) {
    const rounds = (manifest.reviewRounds?.final || 0), packHash = await fileHash(path.join(job, 'review/final/pack.json'));
    if (manifest.reviewRoundPacks?.final !== packHash) {
      manifest.reviewRounds = {...(manifest.reviewRounds || {}), final: rounds + 1};
      manifest.reviewRoundPacks = {...(manifest.reviewRoundPacks || {}), final: packHash};
      await save(path.join(job, 'job.json'), manifest);
    }
    if ((manifest.reviewRounds?.final || 0) >= maxReviewRounds(manifest) && failed.every(r => r.verdict !== 'incomplete')) {
      const limited = await reviewProgress(job, 'final');
      if (limited.ok) return nextStep(job);
    }
    const seen = new Set(), findings = [];
    for (const r of failed) for (const f of r.findings.filter(f => f.severity === 'blocking')) {
      const key = JSON.stringify([f.sceneIds || [], f.start, f.end, f.subject, f.observed, f.repair]);
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({text: `[${r.role} ${f.start.toFixed(1)}–${f.end.toFixed(1)}s] ${f.subject}: ${f.observed} → ${f.repair}`, start: f.start, end: f.end, scope: f.scope, sceneIds: f.sceneIds});
    }
    if (!findings.length) return {state:'blocked', text:`STATE: blocked — review is incomplete without actionable scene findings.\n${failed.flatMap(r=>r.inspection.limitations).join('\n')}\nDO: obtain the missing inspection capability/evidence and fresh independent reviews. Do not invent a creative repair or call this complete.`};
    if (findings.some(f=>f.scope==='plan') || ((manifest.reviewRounds?.final || 0) >= 2 && failed.some(r=>r.role==='visual-mechanism') && !status.nonWaivableFindings?.length)) {
      const brief=await writeBrief(job,'director-revision.md',directorBrief(job,manifest,alignment,{repair:findings.map(f=>'- '+f.text).join('\n')}));
      manifest.reviewPlanRevision={filmHash:await fileHash(path.join(job,news ? 'news.json' : 'film.json')),packHash};await save(path.join(job,'job.json'),manifest);
      return {state:'revise plan',text:`STATE: revise the concept/ownership with the director\n${spawnOne('director', [brief],NEXT)}`};
    }
    return repairText(job, film, findings, NEXT, 'independent review');
  }
  const briefs = pending.map(role => path.join(job, 'briefs', `review-final-${role}.md`));
  for (const b of briefs) if (!await exists(b)) return {state: 'review-pack', text: `STATE: reviewer briefs missing\nDO: run \`npm run video -- review-pack --job ${J} --stage final\`\nTHEN: ${NEXT}`};
  return {state: 'review final', text: `STATE: independent final review (${pending.join(', ')})\n${spawnOne('reviewer', briefs, NEXT)}\n    Reviewers must be new sub-agents that did not build any scene.`};
}

// The whole state machine as data, for `status` and the job UI. It follows nextStep's order
// but only reads: no briefs, receipts or review-round counters are written.
const PROGRESS_STEPS = [
  ['prepare', 'Narration timed to the script'], ['visuals', 'Visual plan'], ['plan', 'Film plan'],
  ['scenes', 'Scenes built'], ['final-build', 'Full build and checks'],
  ['final-review', 'Independent final review'], ['final-human', 'Your final review'],
  ['final-render', 'Final render and mix'], ['deliver', 'Delivery qualified'],
];

export async function jobProgress(job) {
  const J = jr(job);
  // The person's own review steps appear only for the stages they asked to see (job.json humanReview).
  const human = await humanStages(job).catch(() => []);
  const steps = PROGRESS_STEPS.filter(([id]) => !id.endsWith('-human') || human.includes(id.split('-')[0]))
    .map(([id, label]) => ({id, label, status: 'pending', detail: ''}));
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
  try { film = await json(path.join(job, 'film.json')); bounds = isNews(readPersonality(job)) ? (await newsPlan(job)).edit.scenes.map(s=>({id:s.id,start:s.at,end:s.at+s.duration,duration:s.duration})) : validateFilm(film, ctx.alignment, manifest.duration).scenes; }
  catch (error) { planErrors = error.errors || [error.message]; }
  step('visuals').detail = await exists(path.join(job, VISUALS_FILE)) ? VISUALS_FILE : 'Director develops the visual approach';
  if (!film || planErrors) return at('plan', 'plan', {status: film ? 'repair' : 'current',
    detail: film ? `film.json has ${planErrors.length} error(s)` : 'The director is planning the film', errors: film ? planErrors : [],
    next: {role: 'director', briefs: [`${J}/briefs/director.md`]}});
  Object.assign(out.film, {title: film.title, concept: film.concept});
  step('plan').detail = `${film.scenes.length} scenes`;

  // Facts first, then the decision.
  const read = file => json(path.join(job, file)).catch(() => null);
  const [timing, build, pixels, verification, receipt] = await Promise.all(
    ['timing.json', 'review/build.json', 'review/pixels.json', 'review/render-verification.json', 'review/render-source.json'].map(read));
  const source = await sourceFingerprint(job).catch(() => null);
  const finalReview = await reviewProgress(job, 'final');
  // A passing current review counts once the person has approved it too (when they asked to review the film).
  const decisionOn = async (stage, review) => review?.ok && human.includes(stage)
    ? humanDecision(job, stage, await fileHash(path.join(job, `review/${stage}/pack.json`)).catch(() => '')) : null;
  out.reviews.final = await reviewSummary(job, 'final', manifest, finalReview);

  const briefNames = await readdir(path.join(job, 'briefs')).catch(() => []);
  const findings = out.reviews.final.roles.flatMap(r => r.findings);
  out.scenes = await Promise.all(film.scenes.map(async s => {
    const spec = s.kind === 'html' ? s.file : `shots/${s.id}.json`;
    const info = await stat(path.join(job, spec)).catch(() => null);
    const t = timing?.scenes?.find(x => x.id === s.id) || bounds.find(b => b.id === s.id) || {};
    const mentions = text => { text = String(text); return text.includes(`shots/${s.id}.`) || text.includes(`[${s.id}]`) || text.includes(`[${s.id} `); };
    return {id: s.id, start: t.start ?? null, end: t.end ?? null, owner: sceneOwner(film, s.id),
      spec: `${J}/${spec}`, built: Boolean(info), updatedAt: info ? info.mtime.toISOString() : null,
      briefs: briefNames.filter(n => [`build-${s.id}.md`, `direct-${s.id}.md`, `repair-${s.id}.md`].includes(n)).map(n => `${J}/briefs/${n}`),
      buildErrors: (build?.errors || []).filter(mentions).length, buildWarnings: (build?.warnings || []).filter(mentions).length,
      pixelErrors: (pixels?.errors || []).filter(mentions).length,
      findings: findings.filter(f => f.sceneIds.includes(s.id) || (f.start != null && t.start != null && f.start < t.end && f.end > t.start)).length};
  }));
  const count = list => `${list.filter(s => s.built).length}/${list.length} built`;
  step('scenes').detail = count(out.scenes);

  const buildFresh = Boolean(build?.sourceHash && build.sourceHash === source && build.scope === 'all');
  const video = path.join(job, 'renders/video.mp4'), rendered = await exists(video);
  const renderFresh = Boolean(buildFresh && receipt && receipt.sourceHash === build.sourceHash && rendered && receipt.videoSha256 === await fileHash(video));
  out.checks = {
    build: build ? {ok: Boolean(build.ok), fresh: buildFresh, errors: build.errors?.length || 0, warnings: build.warnings?.length || 0} : null,
    render: {exists: rendered, fresh: renderFresh, verified: verification?.ok === true, pixelErrors: pixels?.errors?.length || 0},
  };

  if (await deliveredIntact(job, manifest)) {
    steps.forEach(s => { s.status = 'done'; });
    step('deliver').detail = 'Delivered and qualified';
    return Object.assign(out, {state: 'done', current: 'deliver', next: null});
  }
  if (manifest.reviewPlanRevision && manifest.reviewPlanRevision.filmHash === await fileHash(path.join(job, 'film.json')))
    return at('plan', 'revise plan', {status: 'repair', detail: 'Independent review sent the concept back to the director',
      next: {role: 'director', briefs: [`${J}/briefs/director-revision.md`]}});

  const ids = {scenes: 'scenes', build: 'final-build', review: 'final-review', human: 'final-human'};
  const missing = out.scenes.filter(s => !s.built);
  if (missing.length) {
    const first = missing[0], run = [];
    if (first.owner === 'director') for (const s of missing) { if (s.owner !== 'director') break; run.push(s.id); }
    return at(ids.scenes, 'build', {detail: `${out.scenes.length - missing.length}/${out.scenes.length} built · next "${first.id}"`,
      next: first.owner === 'director' ? {role: 'director', briefs: [`${J}/briefs/direct-${first.id}.md`], scenes: run}
        : {role: 'builder', briefs: [`${J}/briefs/build-${first.id}.md`], scenes: [first.id]}});
  }
  if (!buildFresh) return at(ids.build, 'build', {detail: build ? 'Sources changed since the last build' : 'Not built yet', next: {command: 'build'}});
  if (build.pipelineErrors?.length) return at(ids.build, 'pipeline bug', {status: 'blocked', detail: `${build.pipelineErrors.length} error(s) in pipeline-generated code; needs a pipeline fix`, errors: build.pipelineErrors});
  if (!build.ok) return at(ids.build, 'repair', {status: 'repair', detail: `${build.errors.length} automated check error(s) to repair`, errors: build.errors});
  step(ids.build).detail = `Passed · ${build.warnings?.length || 0} style warning(s)`;
  const appReview = readPersonality(job).profile.id === 'app-review';
  if (appReview && !renderFresh)
    return at('final-render', 'render for encoded playback review', {detail: 'App-review reviewers must inspect the actual MP4 playback', next: {command: 'render'}});
  if (appReview && renderFresh && pixels.errors?.length)
    return at('final-render', 'repair encoded playback', {status: 'repair', detail: `${pixels.errors.length} app-review pixel error(s) block final review`, errors: pixels.errors});
  const review = out.reviews.final;
  if (!review.pack) return at(ids.review, 'review-pack final', {detail: appReview ? 'Freezing evidence from the encoded MP4 for reviewers' : 'Freezing frames of the built film for reviewers', next: {command: 'review-pack', ...(appReview ? {from: 'render'} : {})}});
  if (review.ok) {
    step(ids.review).detail = review.continued ? 'Review limit reached · continuing with disclosed findings' : 'All three reviewers passed';
    if (step(ids.human)) {
      const decision = await decisionOn('final', review);
      if (!decision) return at(ids.human, 'human review final', {status: 'current', detail: 'Waiting for you to watch it and decide', next: {human: 'final'}});
      if (decision.decision === 'revise') return at(ids.human, 'repair', {status: 'repair', detail: `${decision.notes.length} note(s) from you being repaired`,
        errors: decision.notes.map(n => `${n.start == null ? '' : `${n.start.toFixed(1)}s: `}${n.text}`)});
      step(ids.human).detail = 'Approved';
    }
    const reviewed = await json(path.join(job, 'review/final/pack.json')).catch(() => null);
    const renderCurrent = Boolean(reviewed && receipt && receipt.sourceHash === reviewed.sourceHash && rendered && receipt.videoSha256 === await fileHash(video));
    if (!renderCurrent) return at('final-render', 'render', {detail: rendered ? 'Sources changed since the last render' : 'Rendering once, after review', next: {command: 'render'}});
    if (pixels?.errors?.length) return at('final-render', 'repair', {status: 'repair', detail: `${pixels.errors.length} pixel check problem(s) to repair`, errors: pixels.errors});
    step('final-render').detail = verification?.ok ? 'Rendered, mixed and verified' : 'Rendered';
    return at('deliver', 'deliver', {detail: 'Reviewed and rendered', next: {command: 'deliver'}});
  }
  const failed = review.roles.filter(r => r.valid && r.verdict !== 'pass'), pending = review.roles.filter(r => !r.valid);
  if (failed.length && !pending.length) return at(ids.review, 'repair', {status: 'repair',
    detail: `${failed.map(r => r.role).join(', ')} found blocking problems · round ${review.rounds || 1}`});
  return at(ids.review, 'review final', {detail: `${3 - pending.length}/3 reviews in · waiting for ${pending.map(r => r.role).join(', ')}`,
    next: {role: 'reviewer', briefs: pending.map(r => `${J}/briefs/review-final-${r.role}.md`)}});
}

async function reviewSummary(job, stage, manifest, status) {
  const directory = `review/${stage}/reviews`;
  const errors = status?.errors || [];
  const roles = await Promise.all(REVIEW_ROLES.map(async role => {
    const report = await json(path.join(job, directory, `${role}.json`)).catch(() => null);
    const error = errors.find(e => e.startsWith(`${role}:`))?.slice(role.length + 2) || '';
    // A report counts when it validates against the current pack; a valid non-pass verdict is still a valid report.
    const valid = Boolean(report && status && (!error || error === report.verdict));
    const list = Array.isArray(report?.findings) ? report.findings : [];
    return {role, verdict: report?.verdict || null, valid, error: report && !valid ? error : '', reviewer: report?.reviewer?.agentId || '',
      blocking: list.filter(f => f.severity === 'blocking').length, advisory: list.filter(f => f.severity !== 'blocking').length,
      findings: list.filter(f => f.severity === 'blocking').slice(0, 12).map(f => ({sceneIds: Array.isArray(f.sceneIds) ? f.sceneIds : [],
        start: f.start ?? null, end: f.end ?? null, subject: f.subject || '', observed: f.observed || '', repair: f.repair || ''}))};
  }));
  return {stage, pack: Boolean(status?.pack), packError: status && !status.pack && !status.missing ? errors[0] : '',
    continued: status?.continued || false,
    ok: Boolean(status?.ok), interval: status?.interval || null, roles, rounds: manifest.reviewRounds?.[stage] || 0};
}

async function repairText(job, film, findings, NEXT, source) {
  if (isNews(readPersonality(job))) {
    const brief = await writeBrief(job,'repair-news.md',newsDirectorBrief(job) + '\n## Repair findings\n' + findings.map(f=>f.text || f.observed || JSON.stringify(f)).join('\n'));
    return {state:'repair',text:`STATE: repair news edit (${source})\n${spawnOne('director',[brief],NEXT)}`};
  }
  const {manifest, alignment} = await context(job), timing = await json(path.join(job, 'timing.json')), byScene = new Map();
  for (const f of findings) {
    let ids = (f.sceneIds || []).filter(id=>film.scenes.some(s=>s.id===id));
    if (!ids.length) ids = film.scenes.map(s => s.id).filter(id => f.text.includes(`[${id}]`) || f.text.includes(`shots/${id}.`) || f.text.includes(`[${id} `));
    if (!ids.length && f.start != null) ids = timing.scenes.filter(s => s.start < f.end + 0.01 && s.end > f.start).map(s => s.id);
    if (!ids.length) { const m = /t=([\d.]+)s/.exec(f.text); if (m) ids = timing.scenes.filter(s => s.start <= +m[1] && s.end > +m[1]).map(s => s.id); }
    if (!ids.length) ids = [film.scenes[0].id];
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
  const review = await reviewProgress(job, 'final');
  const lines = [`# Production report — ${film.title}`, '', `- Recording: ${manifest.audio.source} from ${manifest.audio.sourceStart}s, ${(manifest.commentaryDuration || manifest.duration).toFixed(2)}s recording${manifest.commentaryDuration ? `; ${manifest.duration.toFixed(2)}s news edit` : ''}; ${manifest.width}×${manifest.height} @ ${manifest.fps} fps`,
    `- Alignment: ASR word timestamps reconciled with the script (${(alignment.matchRatio * 100).toFixed(1)}% exact matches); not forced alignment. ${alignment.review?.note ? 'Review: ' + alignment.review.note : ''}`,
    `- Concept: ${film.concept}`, `- Scenes: ${film.scenes.map(s => s.id).join(', ')}`, '', '## Automated checks',
    `- Build/DOM inspection: ${build.ok ? 'pass' : 'FAIL'} (${(build.errors || []).length} errors, ${(build.warnings || []).length} warnings)`,
    ...Object.entries(build.report?.scenes || {}).map(([id, r]) => r.source ? `  - ${id}: actual source ${r.source}; framing and required subtitles inspected` : `  - ${id}: frame use ${Math.round(r.frameUse * 100)}%, longest still ${r.longestStill}s, developing elements per 3 s: ${(r.windows || []).join(' ')}`),
    `- Pixel checks on the render: ${pixels.ok ? 'pass' : 'FAIL'}`, ...Object.entries(pixels.scenes || {}).map(([id, r]) => `  - ${id}: content box ${Math.round(r.contentBox * 100)}%, longest frozen ${r.longestFrozen}s`),
    `- Media verification: ${verification.ok ? 'pass' : 'missing'} (${verification.width}×${verification.height}, ${verification.fps}, ${verification.duration?.toFixed?.(2)}s, narration correlation ${verification.narrationIntegrity?.correlation?.toFixed?.(4)})`,
    ...(isNews(readPersonality(job)) ? [`- Mandatory subtitles: ${verification.subtitles?.required && verification.ok ? 'encoded verification passed' : 'pending/FAILED'}; ${verification.subtitles?.cues || 0} cues; sidecar renders/subtitles.srt`, '- Source and rights ledgers: news-sources.json; exact edit/source/audio ranges: news.json. Transcript accuracy, clearance validity and editorial context require independent review and human listening.'] : []),
    '', '## Independent review',
    `- Disposition: ${review.continued ? 'review-limit-reached (completed with disclosed findings; not independently passed)' : review.ok ? 'passed' : 'pending'}`,
    ...(review.reports || []).flatMap(r => r.findings.filter(f => f.severity === 'blocking').map(f => `- Unresolved [${r.role} ${f.start}–${f.end}s]: ${f.subject}: ${f.observed}`)),
    '', '## Warnings', ...(build.warnings || []).map(w => `- ${w}`), '', '## Limitations',
    '- Still frames and the motion transcript do not prove motion quality; reviewers report their own inspection limits.', '- Cue times come from ASR estimates.', ''];
  await writeFile(path.join(job, 'review/REPORT.md'), lines.join('\n'));
}
