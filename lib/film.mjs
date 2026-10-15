// Film-mode production: film.json + shots/*.json → compiled world → checks → render → review → delivery.
// Every command ends by telling the agent the next step; `next` derives the whole state machine from files.
import {readFile, writeFile, mkdir, access, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeWords, browserCues} from './timing.mjs';
import {compileFilm, validateFilm, SpecError, storyboardMarkdown, sceneOwner} from './spec.mjs';
import {writeWorld, writeRoot, installKit} from './world.mjs';
import {inspectFilm, writeInspection, openInspector} from './inspect.mjs';
import {pixelChecks} from './pixels.mjs';
import {renderManimClips} from './manim.mjs';
import {directorBrief, directorSceneBrief, builderBrief, reviewerBrief, writeBrief} from './briefs.mjs';
import {sourceFingerprint, fileHash, reviewStatus, acceptedPrototype, loadReviewPack, qualifyDelivery, REVIEW_ROLES} from './review.mjs';
import {verifyLibraryCopies} from './library.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
    for (const w of allWarnings.filter(w => !scene || w.includes(scene) || !/\[|shots\//.test(w))) console.log(`  ! ${w}`);
    for (const e of allErrors) console.log(`  ✗ ${e}`);
    console.log(`\nBuild ${allErrors.length ? 'FAILED' : 'OK'}: ${allErrors.length} error(s), ${allWarnings.length} warning(s)${timing.missing.length ? `; scenes not built yet: ${timing.missing.join(', ')}` : ''}.`);
  }
  return {ok: !allErrors.length, errors: allErrors, warnings: allWarnings, timing, sourceHash};
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

export async function renderFilm(job, {hf, verify, quality = 'delivery', force = false}) {
  const manifest = await json(path.join(job, 'job.json'));
  const built = await buildFilm(job, {print: true});
  if (!built.ok && !force) throw new Error('Build has errors; fix them before rendering (see above).');
  await filmAudit(job, {allowBuildErrors: force});
  const sourceHash = await sourceFingerprint(job);
  manifest.status = 'rendering'; delete manifest.completedAt; delete manifest.delivery; await save(path.join(job, 'job.json'), manifest);
  await hf(['lint'], {cwd: job}).catch(() => { throw new Error('HyperFrames lint failed (see above).'); });
  await hf(['render', '--quality', quality, '--fps', String(manifest.fps), '--output', 'renders/video.mp4', '--quiet'], {cwd: job});
  await verify(job);
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

export function prototypeInterval(timing, film, duration) {
  const s = timing.scenes.find(x => x.id === film.prototype);
  let a = s.start, b = Math.min(s.end, a + 15);
  if (b - a < 10) { b = Math.min(duration, a + 10); if (b - a < 10) a = Math.max(0, b - 10); }
  return {start: Number(a.toFixed(3)), end: Number(b.toFixed(3))};
}

export async function writeReviewerBriefs(job, pack, packPath, packSha256) {
  const directions = {
    'visual-mechanism': 'Blind first pass: BEFORE reading motion.md, automated checks, script, narration, film.json or STORYBOARD.md, VIEW the ordered frames/clips. Save plain-language observations of what visibly changes and what causes it, what each object is recognisable as, and how the film looks (its visual theme and whether every frame shares it) to `visual-first.md` in the incoming directory (do not overwrite an earlier pass; use a new file named with the pack hash). Only then read the motion transcript, narration (SCRIPT.md, timing.json) and STORYBOARD.md (which starts with the declared design theme) and compare. Labels, fades and camera moves alone do not explain. If you cannot view images/video, report incomplete with inspection.visual = "unavailable".',
    'narration-fidelity': 'Read inputs/source-script.md, SCRIPT.md, alignment.json and timing.json, then the motion transcript and frames. Check that what is shown at each moment matches what is said then; every displayed number and claim is supported by the narration or script; cues land on the right words. If you cannot listen, set inspection.audio to "signal-verified" (the pack includes a waveform verification receipt) and state that limitation.',
    'continuity-legibility': 'VIEW full and phone-scale (480 px wide) frames: essential labels and numbers readable, no text collisions, one clear focus, framed uncrowded stages, no passage where the picture stops matching the narration, meaningful intermediate states, every scene inside the declared design theme (palette, line weight, type, imagery, motion), and handoffs that keep recurring subjects (read STORYBOARD.md). Inspect the ending. The motion transcript and automated checks are supporting diagnostics, never a substitute for viewing images. If images/video are unavailable, report incomplete with inspection.visual = "unavailable".',
  };
  const out = [];
  for (const role of REVIEW_ROLES) out.push({role, path: await writeBrief(job, `review-${pack.stage}-${role}.md`, reviewerBrief(job, role, pack, packPath, packSha256, directions[role]))});
  return out;
}

export async function reviewTemplate(job, {stage, role}) {
  if (!REVIEW_ROLES.includes(role)) throw new Error(`role must be one of ${REVIEW_ROLES.join(', ')}`);
  const {pack, packSha256} = await loadReviewPack(job, stage);
  const report = {version: 1, stage, role, sourceHash: pack.sourceHash, videoSha256: pack.videoSha256, packSha256,
    reviewer: {agentId: 'FILL-IN: your agent/session id', independent: true},
    inspection: {mode: 'FILL-IN: frame-sequence | playback | mixed', visual: 'FILL-IN: viewed | unavailable', evidence: [], limitations: [], ...(role === 'narration-fidelity' ? {audio: 'FILL-IN: listened | signal-verified | unavailable'} : {})},
    ...(role === 'visual-mechanism' ? {initialObservation: 'FILL-IN: what the pictures showed before you read the narrative'} : {}),
    coverage: [],
    findings: [],
    findingExample: {id: 'F1', severity: 'blocking', start: 0, end: 1, subject: 'which object', requirement: 'which rule', observed: 'what you saw', repair: 'what must change (not how)', evidence: [pack.evidence.find(e => e.kind === 'motion')?.path || pack.evidence[0].path]},
    verdict: 'FILL-IN: pass | revise'};
  const dir = path.join(job, `review/${stage}/incoming`); await mkdir(dir, {recursive: true});
  const file = path.join(dir, `${role}.json`);
  const prev = await json(file).catch(() => null);
  if (!prev || prev.packSha256 !== packSha256) await save(file, report);
  console.log(`Template: ${file}\nFill every FILL-IN field, delete "findingExample", then submit with review-submit.`);
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
    ...groups.flatMap(g => g.briefs.map(b => `      video-${g.role}: "Read ${b} and follow it exactly."`)),
    `    Wait until ${n > 1 ? 'all have' : 'it has'} finished. Do not do their work yourself and do not edit their files.`,
    `THEN: ${then}`].join('\n');
};
const spawnOne = (role, briefs, then) => spawnText([{role, briefs}], then);

export async function nextStep(job) {
  const J = jr(job), NEXT = `npm run video -- next --job ${J}`;
  const manifest = await json(path.join(job, 'job.json'));
  if (manifest.status === 'complete') {
    try {
      const current = await qualifyDelivery(job), delivered = await json(path.join(job, 'review/delivery.json'));
      if (!delivered.ok || delivered.videoSha256 !== current.videoSha256 || delivered.sourceHash !== current.sourceHash || delivered.packSha256 !== current.packSha256) throw new Error('Delivery changed.');
      return {state: 'done', text: `STATE: done\nThe film is delivered: ${J}/renders/video.mp4\nDO: run \`npm run video -- preview --job ${J}\`, then report the MP4 path and preview URL to the user with the verification note from ${J}/review/delivery.json.`};
    } catch { /* Re-enter production when persisted completion evidence is missing/stale. */ }
  }
  let ctx;
  try { ctx = await context(job); } catch (error) { return {state: 'alignment', text: `STATE: alignment-review\n${error.message}\nTHEN: ${NEXT}`}; }
  const {alignment} = ctx;
  // 1. plan
  let film = null, planErrors = null;
  try { film = await json(path.join(job, 'film.json')); validateFilm(film, alignment, manifest.duration); }
  catch (error) { planErrors = error.errors || [error.message]; }
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
  // 4. review
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
