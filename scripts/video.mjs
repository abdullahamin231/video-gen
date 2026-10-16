#!/usr/bin/env node
import {readFile, writeFile, mkdir, copyFile, access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {extractNarration, normalizeWords, reconcile, compilePlan, browserCues} from '../lib/timing.mjs';
import {itemPath, inspectBundle, searchLibrary, publishBundle, useBundle, verifyLibraryCopies, saveToLibrary, saveAll} from '../lib/library.mjs';
import {sourceFingerprint, fileHash, submitReview, reviewStatus, qualifyDelivery, writeReviewFile, localFile, REVIEW_ROLES} from '../lib/review.mjs';
import {createReviewPack} from '../lib/review-pack.mjs';
import {compareNarration} from '../lib/audio-verification.mjs';
import {isFilmJob, planCheck, buildFilm, snapshot, filmAudit, renderFilm, nextStep, writeReviewerBriefs, reviewTemplate, writeProductionReport, printSpecError} from '../lib/film.mjs';
import {installKit} from '../lib/world.mjs';
import {importAsset, webImagesAllowed} from '../lib/assets.mjs';
import {setupManim} from '../lib/manim.mjs';
import {SpecError} from '../lib/spec.mjs';
import {directorBrief, writeBrief} from '../lib/briefs.mjs';
import {loadConfig, resolveSettings} from '../lib/format.mjs';
import {readdir} from 'node:fs/promises';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HF = path.join(ROOT, 'node_modules/hyperframes/bin/hyperframes.mjs');
const LIBRARY = process.env.VG_LIBRARY || path.join(ROOT, 'library');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n');
const exists = async file => {try {await access(file); return true;} catch {return false;}};
const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');

function run(command, args, {cwd = ROOT, capture = false, env = {}} = {}) {
  return new Promise((resolve, reject) => {
    // Some CLI naming uses PWD rather than process.cwd(). Keep both consistent
    // when npm invokes the job from the repository root.
    const child = spawn(command, args, {cwd, env: {...process.env, PWD: cwd, ...env},
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit'});
    let output = '';
    if (capture) child.stdout.on('data', chunk => {output += chunk;});
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`${command} exited ${code}`)));
  });
}
const hf = (args, opts) => run(process.execPath, [HF, ...args], opts);
const probe = async file => JSON.parse(await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], {capture: true}));
function options(args) {
  const result = {};
  while (args.length) {
    const key = args.shift();
    if (!key.startsWith('--') || !args.length || args[0].startsWith('--')) throw new Error(`Expected --option value: ${key}`);
    result[key.slice(2)] = args.shift();
  }
  return result;
}
function numeric(value, fallback, label) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number.`);
  return n;
}
async function jobPath(opts) {
  if (opts.job) return path.resolve(ROOT, opts.job);
  const latest = await json(path.join(ROOT, '.video/latest.json')).catch(() => null);
  if (!latest) throw new Error('No job selected. Prepare a job or pass --job jobs/<name>.');
  return path.resolve(ROOT, latest.job);
}
async function state(job) {
  const [manifest, alignment, plan] = await Promise.all([
    json(path.join(job, 'job.json')), json(path.join(job, 'alignment.json')), json(path.join(job, 'beats.json'))]);
  const measured = normalizeWords(alignment.words, manifest.duration);
  if (measured.length !== alignment.words.length) throw new Error('Invalid alignment words.');
  if (await digest(path.join(job, 'assets/narration.wav')) !== manifest.audio.sha256)
    throw new Error('Narration changed since preparation. Create a new job instead of reusing stale timings.');
  return {manifest, alignment, timing: compilePlan(plan, alignment, manifest.duration)};
}
async function compile(job) {
  const s = await state(job);
  await save(path.join(job, 'timing.json'), s.timing);
  await writeFile(path.join(job, 'assets/cues.js'),
    `/* Generated from measured words and beats.json; do not hand-edit. */\nwindow.VideoCues = ${JSON.stringify(browserCues(s.timing), null, 2)};\n`);
  console.log(`Resolved ${s.timing.scenes.reduce((n, s) => n + s.beats.length, 0)} beats across ${s.timing.scenes.length} scenes.`);
  return s;
}
async function prepare(opts) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(opts.name || '')) throw new Error('--name must be a lowercase job slug.');
  if (!opts.audio || !opts.script) throw new Error('prepare requires --audio and --script.');
  const job = path.join(ROOT, 'jobs', opts.name);
  if (await exists(job)) throw new Error(`Job exists: ${job}. Use a new --name; existing work is never overwritten.`);
  const audio = path.resolve(ROOT, opts.audio), script = path.resolve(ROOT, opts.script);
  const [metadata, sourceScript] = await Promise.all([probe(audio), readFile(script, 'utf8')]);
  const settings = resolveSettings(opts, await loadConfig(ROOT), Number(metadata.format.duration));
  const {start, duration, format, fps} = settings;
  for (const w of settings.warnings) console.warn(`Warning: ${w}`);
  const language = opts.language || 'en', model = opts.model || (language === 'en' ? 'small.en' : 'small');
  const engine = opts.engine || 'faster-whisper';
  if (!['faster-whisper', 'hyperframes'].includes(engine)) throw new Error('--engine must be faster-whisper or hyperframes.');
  if (language !== 'en' && model.endsWith('.en')) throw new Error('Non-English audio requires a multilingual model.');
  await mkdir(path.dirname(job), {recursive: true});
  await hf(['init', job, '--non-interactive', '--resolution', format === 'vertical' ? 'portrait' : format], {capture: true, env: {HYPERFRAMES_SKIP_SKILLS: '1'}});
  const pointer = `# Job ${opts.name}\n\nThis is a pipeline job. Do not run hyperframes or npx commands here and never upgrade HyperFrames.\nFrom the repository root run: npm run video -- next --job jobs/${opts.name}\nand do exactly what it prints.\n`;
  for (const f of ['AGENTS.md', 'CLAUDE.md']) await writeFile(path.join(job, f), pointer);
  await writeFile(path.join(job, 'package.json'), JSON.stringify({name: opts.name, private: true, type: 'module',
    scripts: {next: `npm --prefix ../.. run video -- next --job jobs/${opts.name}`}}, null, 2) + '\n');
  for (const dir of ['inputs', 'assets', 'compositions', 'review', 'renders', 'shots', 'components', 'briefs']) await mkdir(path.join(job, dir), {recursive: true});
  await installKit(job);
  await writeFile(path.join(job, 'inputs/source-script.md'), sourceScript);
  const narration = extractNarration(sourceScript);
  await writeFile(path.join(job, 'inputs/narration.txt'), narration);
  await run('ffmpeg', ['-v', 'error', '-i', audio, '-ss', String(start), '-t', String(duration),
    '-vn', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', path.join(job, 'assets/narration.wav')]);
  await copyFile(path.join(ROOT, 'public/gsap.min.js'), path.join(job, 'assets/gsap.min.js'));
  await copyFile(path.join(ROOT, 'lib/motion.js'), path.join(job, 'assets/motion.js'));
  const actualDuration = Number((await probe(path.join(job, 'assets/narration.wav'))).format.duration);
  const manifest = {version: 1, name: opts.name, createdAt: new Date().toISOString(),
    duration: actualDuration, format, width: settings.width, height: settings.height, fps,
    audio: {path: 'assets/narration.wav', source: path.relative(ROOT, audio), sourceStart: start,
      sha256: await digest(path.join(job, 'assets/narration.wav'))},
    script: {path: 'inputs/source-script.md', source: path.relative(ROOT, script), sha256: await digest(script)},
    transcription: {language, model, engine, suppliedWords: !!opts.words},
    creativeMode: 'agent-discretion', workflow: 'faceless-explainer', status: 'awaiting-transcription',
    review: {producerAgentIds: ['/root'], requiredRoles: ['visual-mechanism', 'narration-fidelity', 'continuity-legibility']},
    canvas: '#151915'};
  await save(path.join(job, 'job.json'), manifest);
  if (opts.words) await copyFile(path.resolve(ROOT, opts.words), path.join(job, 'transcript.json'));
  else await transcribe(job, manifest);
  await finishPreparation(job, manifest, narration);
}
async function transcribe(job, manifest) {
  const {model, language, engine = 'faster-whisper'} = manifest.transcription;
  if (engine === 'hyperframes') await hf(['transcribe', 'assets/narration.wav', '--dir', job, '--engine', 'whisper', '--model', model, '--language', language], {cwd: job});
  else await run('uv', ['run', '--locked', '--script', path.join(ROOT,'scripts/transcribe.py'),
    path.join(job,'assets/narration.wav'), path.join(job,'transcript.json'), '--model', model, '--language', language]);
}
async function finishPreparation(job, manifest, narration) {
  const actualDuration = manifest.duration;
  const words = normalizeWords(await json(path.join(job, 'transcript.json')), actualDuration);
  const alignment = reconcile(words, narration);
  await save(path.join(job, 'alignment.json'), alignment);
  await writeFile(path.join(job, 'SCRIPT.md'), `# Recorded excerpt\n\n${words.map(w => w.text).join(' ')}\n`);
  await writeBrief(job, 'director.md', directorBrief(job, manifest, alignment));
  await writeFile(path.join(job, 'BRIEF.md'), `---\nworkflow: faceless-explainer\nflow: autonomous\n---\n\n# ${manifest.name}\n\nUse the supplied ${actualDuration}s recording verbatim. Agent has full creative discretion.\nCanvas: ${manifest.width}×${manifest.height}; ${manifest.fps} fps.\nConsult repository AGENTS.md, docs/agent-workflow.md and docs/independent-review.md.\nPreserve narration; skip TTS. Do internal sketches and asset preparation.\nProduction is driven by: npm run video -- next --job jobs/${manifest.name}\nA draft render is not delivery: qualify the exact reviewed MP4 with the deliver command.\n`);
  await writeFile(path.join(job, 'review/REPORT.md'), '# Production review\n\nPending creative build and validation.\n');
  manifest.status = 'prepared';
  await save(path.join(job, 'job.json'), manifest);
  await mkdir(path.join(ROOT, '.video'), {recursive: true});
  await save(path.join(ROOT, '.video/latest.json'), {job: path.relative(ROOT, job)});
  console.log(`Prepared ${path.relative(ROOT, job)}: ${words.length} words, ${(alignment.matchRatio * 100).toFixed(1)}% exact script matches.`);
  console.log(`\nNext: npm run video -- next --job ${path.relative(ROOT, job)}`);
}
// Agents often mangle unusual filenames (quotes, full-width punctuation). Resolve a near miss to the real file.
async function resolveInput(given, label) {
  const direct = path.resolve(ROOT, given);
  if (await exists(direct)) return direct;
  const dir = path.dirname(direct), want = normalizedName(path.basename(direct));
  const entries = await readdir(dir).catch(() => []);
  const match = entries.find(e => normalizedName(e) === want) || (entries.length === 1 ? entries[0] : null);
  if (match) return path.join(dir, match);
  throw new Error(`${label} not found: ${given}. Files in ${path.relative(ROOT, dir) || '.'}: ${entries.join(', ') || '(none)'}`);
}
const normalizedName = name => name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}.]/gu, '');
function slugFrom(file) { return path.basename(file, path.extname(file)).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'film'; }
async function start(opts) {
  const audio = await resolveInput(opts.audio || '', 'Audio'), script = await resolveInput(opts.script || '', 'Script');
  let name = opts.name || slugFrom(script);
  if (!/^[a-z0-9]/.test(name)) name = 'film-' + name;
  let candidate = name, i = 2;
  while (await exists(path.join(ROOT, 'jobs', candidate))) candidate = `${name}-${i++}`;
  await prepare({...opts, name: candidate, audio: path.relative(ROOT, audio), script: path.relative(ROOT, script)});
}

const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function assemble(job) {
  const {manifest: m, timing} = await compile(job);
  for (const scene of timing.scenes) if (!await exists(path.join(job, scene.file))) throw new Error(`Missing scene HTML: ${scene.file}`);
  const hosts = timing.scenes.map((s, i) => `<div id="host-${s.id}" class="clip" data-composition-id="${s.id}" data-composition-src="${s.file}" data-start="${s.start}" data-duration="${s.duration}" data-track-index="${i + 1}" data-width="${m.width}" data-height="${m.height}"></div>`).join('\n');
  await writeFile(path.join(job, 'index.html'), `<!doctype html>
<html lang="${escape(m.transcription.language)}"><head><meta charset="utf-8"><title>${escape(m.name)}</title>
<script src="assets/gsap.min.js"></script><script src="assets/cues.js"></script><script src="assets/motion.js"></script>
<style>html,body{margin:0;width:100%;height:100%;background:${/^#[a-fA-F0-9]{6}$/.test(m.canvas || '') ? m.canvas : '#151915'}}#root{position:relative;width:100%;height:100%;overflow:hidden}.clip{position:absolute;inset:0}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${m.duration}" data-width="${m.width}" data-height="${m.height}">
${hosts}
<audio id="narration" src="assets/narration.wav" data-start="0" data-duration="${m.duration}" data-track-index="0" data-volume="1"></audio>
</div><script>window.__timelines['main'] = gsap.timeline({paused:true});</script></body></html>\n`);
  console.log(`Assembled ${path.relative(ROOT, job)}/index.html with source narration.`);
}
async function audit(job) {
  const {manifest, timing} = await compile(job), errors = [], warnings = [...timing.warnings];
  errors.push(...await verifyLibraryCopies(job));
  const files = new Map();
  for (const scene of timing.scenes) {
    const source = await readFile(path.join(job, scene.file), 'utf8').catch(() => '');
    files.set(scene.file, source);
    if (!source) {errors.push(`Missing scene: ${scene.file}`); continue;}
    if (!source.includes(`data-composition-id="${scene.id}"`) && !source.includes(`data-composition-id='${scene.id}'`))
      errors.push(`${scene.id}: root composition id does not match plan.`);
    if (!source.includes('VideoCues')) errors.push(`${scene.id}: scene does not consume generated cue timing.`);
    for (const beat of scene.beats) for (const target of beat.targets) {
      const id = target.slice(1);
      if (!source.includes(`id="${id}"`) && !source.includes(`id='${id}'`)) errors.push(`${beat.id}: target ${target} absent from HTML.`);
    }
  }
  const root = await readFile(path.join(job, 'index.html'), 'utf8').catch(() => '');
  if (!root.includes('assets/narration.wav') || !root.includes('assets/cues.js')) errors.push('Root must contain supplied narration and cue script.');
  for (const scene of timing.scenes) {
    const host = root.match(new RegExp(`<div\\b[^>]*id=["']host-${scene.id}["'][^>]*>`))?.[0] || '';
    if (!host.includes(`data-start="${scene.start}"`) || !host.includes(`data-duration="${scene.duration}"`) ||
        !host.includes(`data-composition-src="${scene.file}"`))
      errors.push(`${scene.id}: root host timing is stale or missing; run assemble.`);
  }
  for (const [file, source] of [...files, ['index.html', root]]) {
    if (/Math\.random\s*\(|Date\.now\s*\(|requestAnimationFrame\s*\(|setInterval\s*\(/.test(source))
      errors.push(`${file}: nondeterministic animation clock/randomness.`);
    if (/(?:src|href)=["']https?:\/\//.test(source)) warnings.push(`${file}: external URL present; freeze render assets locally.`);
  }
  const report = {ok: !errors.length, duration: manifest.duration, sceneCount: timing.scenes.length,
    beatCount: timing.scenes.reduce((n, s) => n + s.beats.length, 0), errors, warnings,
    note: 'Pacing warnings are advisory. Inspect runtime motion and audio sync; static analysis cannot prove creative quality.'};
  await save(path.join(job, 'review/audit.json'), report);
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) throw new Error('Pipeline audit failed.');
  return report;
}
async function verify(job) {
  const manifest = await json(path.join(job, 'job.json')), file = await localFile(job, 'renders/video.mp4');
  const metadata = await probe(file), video = metadata.streams.find(s => s.codec_type === 'video');
  const audio = metadata.streams.find(s => s.codec_type === 'audio');
  if (!video || !audio || Number(metadata.format.size) < 1000) throw new Error('Output must contain video and audio streams.');
  if (Math.abs(Number(metadata.format.duration) - manifest.duration) > 0.12 ||
      video.width !== manifest.width || video.height !== manifest.height ||
      Math.abs(Number(audio.duration) - manifest.duration) > 0.15 ||
      Math.abs(video.avg_frame_rate.split('/').reduce((a,b) => Number(a)/Number(b)) - manifest.fps) > 0.01)
    throw new Error('Rendered dimensions, duration, audio length, or fps differ from the job.');
  const levels = await new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], {stdio: ['ignore','ignore','pipe']});
    let log = ''; child.stderr.on('data', c => {log += c;}); child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(log) : reject(new Error('Audio volume verification failed.')));
  });
  const mean = Number(levels.match(/mean_volume:\s*([-\d.]+) dB/)?.[1]);
  if (!Number.isFinite(mean) || mean < -60) throw new Error('Rendered narration is silent or effectively inaudible.');
  const narrationIntegrity = await compareNarration(file,await localFile(job,'assets/narration.wav'));
  const report = {ok: true, output: path.relative(ROOT, file), duration: Number(metadata.format.duration),
    width: video.width, height: video.height, fps: video.avg_frame_rate, audioCodec: audio.codec_name,
    meanVolumeDb: mean, sha256: await fileHash(file), narrationIntegrity};
  await writeReviewFile(job,'review/render-verification.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report, null, 2));
}

const HELP = `Narration-driven HyperFrames pipeline

Agents: run \`next\` and do exactly what it prints, until it says done.

start --audio <file> --script <file> [--format landscape|vertical --length 30 --start 0 --name slug]   create a job
                                     defaults come from video.config.json; --length trims to the first N seconds (--duration is the same)
next [--job jobs/<slug>]             print the single next step (state machine)
plan-check                          validate film.json (director output)
build [--scene <id>]                 compile shots, assemble, inspect, print motion transcript
snapshot [--scene <id>] [--at 1.2,3] write PNG frames of the world (for agents that can view images)
asset --src <url|file> --name <x.png> --note "what it shows" [--title ".." --tags "a,b"]  bring an image/logo/font into assets/ and save it to library/
                                     web URLs: SVG only unless VG_ALLOW_WEB_IMAGES=1 (png/jpg/webp/gif then allowed)
save --file <job file> --title ".." --tags "a,b" [--note ".." --id slug]  save something you made (drawing, component, Manim file) to library/
save-all                             save every job asset/component the library does not hold yet
review-template --stage S --role R   write a pre-filled reviewer report
alignment-approve --note "..."       record review of a low script match
setup-manim                          install ManimCE locally for "manim" objects
kit-update                           refresh the job's frozen kit copy from lib/kit

prepare --name <slug> --audio <file> --script <file> [--start 0 --length 30 --format landscape|vertical]
        [--language en --model small.en --engine faster-whisper|hyperframes]
        [--words measured-words.json --fps 30]
transcribe [--job jobs/<slug>]       resume a failed transcription/preparation
compile | assemble | audit | check | preview | render | verify [--job jobs/<slug>]
render [--quality delivery]          draft: audit + runtime check + render + verify
review-pack --stage prototype|final [--start N --end N]  freeze rendered evidence
review-submit --file <report.json>   validate an independent sub-agent report
review-status --stage prototype|final  check independent review qualification
deliver                             qualify current reviews and mark complete
preview [--port 3002]                persistent HyperFrames Studio
library-search [--query "packet flow" --limit 8]  search shared artifact metadata
library-info --item <id@version>     inspect one bundle, usage and provenance
library-add --source <bundle-dir>   publish a new immutable artifact version
library-use --item <id@version> --job jobs/<slug>  freeze files and record hashes

The latest prepared job is used when --job is omitted.
Creative design is performed by the agent; see AGENTS.md and docs/agent-workflow.md.
`;
try {
  const [command = 'help', ...args] = process.argv.slice(2), opts = options(args);
  if (command === 'help') console.log(HELP);
  else if (command === 'prepare') await prepare(opts);
  else if (command === 'start') await start(opts);
  else if (command === 'setup-manim') console.log(await setupManim());
  else if (command === 'library-search') console.log(JSON.stringify(await searchLibrary(LIBRARY, opts.query, numeric(opts.limit, 8, 'limit')), null, 2));
  else if (command === 'library-info') console.log(JSON.stringify(await inspectBundle(itemPath(LIBRARY, opts.item)), null, 2));
  else if (command === 'library-add') {
    if (!opts.source) throw new Error('library-add requires --source bundle-directory.');
    console.log(JSON.stringify(await publishBundle(LIBRARY, path.resolve(ROOT, opts.source)), null, 2));
  }
  else if (command === 'library-use') {
    if (!opts.job) throw new Error('library-use requires an explicit --job.');
    console.log(JSON.stringify(await useBundle(LIBRARY, opts.item, await jobPath(opts)), null, 2));
  }
  else {
    const job = await jobPath(opts);
    if (command === 'transcribe') {
      const manifest = await json(path.join(job,'job.json'));
      if (await exists(path.join(job,'beats.json'))) throw new Error('Prepared job already exists; create a new job to change transcription.');
      if (opts.model) manifest.transcription.model = opts.model;
      if (opts.engine) manifest.transcription.engine = opts.engine;
      await save(path.join(job,'job.json'), manifest);
      await transcribe(job, manifest);
      await finishPreparation(job, manifest, await readFile(path.join(job,'inputs/narration.txt'),'utf8'));
    } else if (command === 'next') {
      const step = await nextStep(job);
      console.log(step.text);
    } else if (command === 'plan-check') {
      try { await planCheck(job); console.log(`\nNext: npm run video -- next --job ${path.relative(ROOT, job)}`); }
      catch (error) { if (error instanceof SpecError) { printSpecError(error); console.error('\nFix film.json and run plan-check again.'); process.exitCode = 1; } else throw error; }
    } else if (command === 'build') {
      const result = await buildFilm(job, {scene: opts.scene || null});
      if (!result.ok) { process.exitCode = 1; console.log(opts.scene ? `\nFix the errors in shots/${opts.scene}.json and run build again.` : '\nFix the errors and run build again.'); }
      else console.log(opts.scene ? `\nScene ${opts.scene} passes the checks. Read the transcript above against the plan, then finish.` : `\nNext: npm run video -- next --job ${path.relative(ROOT, job)}`);
    } else if (command === 'snapshot') await snapshot(job, {scene: opts.scene, at: opts.at});
    else if (command === 'review-template') await reviewTemplate(job, {stage: opts.stage || 'final', role: opts.role});
    else if (command === 'asset') {
      if (!opts.note?.trim()) throw new Error('asset needs --note "<what it shows>" so later films can find it in the library');
      const a = await importAsset(job, ROOT, {src: opts.src, name: opts.name, note: opts.note, title: opts.title || '', tags: opts.tags || '', allowWebImages: webImagesAllowed()});
      const lib = await saveToLibrary(LIBRARY, job, {file: a.path, title: opts.title || a.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '), tags: opts.tags || '', note: opts.note, origin: a.src});
      console.log(`Saved ${a.path} (library: ${lib.item}). Use it as {"type": "image", "src": "${a.path}", ...}${a.name.startsWith('fonts/') ? ' or in theme.fontFiles' : ''}. Look at it before using it.`);
    }
    else if (command === 'save') {
      if (!opts.file || !opts.title?.trim() || !opts.tags?.trim()) throw new Error('save needs --file <job file> --title "<what it is>" --tags "<words someone would search for>"');
      const r = await saveToLibrary(LIBRARY, job, {file: opts.file, title: opts.title, tags: opts.tags, note: opts.note || '', id: opts.id});
      console.log(r.saved ? `Saved ${opts.file} to the library as ${r.item}.` : `Already in the library as ${r.item}.`);
    }
    else if (command === 'save-all') {
      const saved = await saveAll(LIBRARY, job);
      console.log(saved.length ? saved.map(s => `${s.file} → ${s.item}${s.saved ? '' : ' (already saved)'}`).join('\n') : 'Nothing new to save.');
      console.log(`Next: npm run video -- next --job ${path.relative(ROOT, job)}`);
    }
    else if (command === 'kit-update') { await installKit(job); console.log('Kit refreshed. Run build.'); }
    else if (command === 'alignment-approve') {
      if (!opts.note?.trim()) throw new Error('alignment-approve needs --note "<what differs and how it was handled>"');
      const file = path.join(job, 'alignment.json'), alignment = await json(file);
      alignment.review = {approved: true, note: opts.note}; await save(file, alignment);
      console.log(`Alignment review recorded.\nNext: npm run video -- next --job ${path.relative(ROOT, job)}`);
    }
    else if (command === 'compile') await compile(job);
    else if (command === 'assemble') await assemble(job);
    else if (command === 'audit') { if (await isFilmJob(job)) console.log(JSON.stringify(await filmAudit(job), null, 2)); else await audit(job); }
    else if (command === 'verify') await verify(job);
    else if (command === 'review-pack') {
      const film = await isFilmJob(job);
      let start = numeric(opts.start,0,'start'), end = opts.end === undefined ? undefined : numeric(opts.end,0,'end');
      if (film && (opts.stage || 'final') === 'prototype' && opts.start === undefined) {
        const {prototypeInterval} = await import('../lib/film.mjs');
        const iv = prototypeInterval(await json(path.join(job,'timing.json')), await json(path.join(job,'film.json')), (await json(path.join(job,'job.json'))).duration);
        start = iv.start; end = iv.end;
      }
      const pack = await createReviewPack(job, {stage:opts.stage || 'final', start, end});
      const packPath = path.join(job,pack.packPath), packSha256 = await fileHash(packPath), briefs = [];
      void briefs;
      const written = await writeReviewerBriefs(job, pack, packPath, packSha256);
      console.log(JSON.stringify({stage:pack.stage,packPath,packSha256,sourceHash:pack.sourceHash,videoSha256:pack.videoSha256,interval:pack.interval,evidenceCount:pack.evidence.length,briefs:written,
        next:`npm run video -- next --job ${path.relative(ROOT, job)}`},null,2));
    } else if (command === 'review-submit') {
      if (!opts.file) throw new Error('review-submit requires --file from an independent reviewer.');
      const raw = await readFile(path.resolve(ROOT,opts.file),'utf8');
      if (raw.includes('FILL-IN')) throw new Error('The report still contains FILL-IN placeholders. Replace every FILL-IN value (agentId, verdict, initialObservation) and delete "findingExample".');
      const report = JSON.parse(raw); delete report.findingExample;
      console.log(JSON.stringify(await submitReview(job,report),null,2));
    } else if (command === 'review-status') {
      const status = await reviewStatus(job,opts.stage || 'final');
      console.log(JSON.stringify(status,null,2));
      if (!status.ok) process.exitCode = 1;
    } else if (command === 'deliver') {
      const manifest = await json(path.join(job,'job.json'));
      manifest.status = 'awaiting-review'; delete manifest.completedAt; delete manifest.delivery;
      await save(path.join(job,'job.json'),manifest);
      const filmMode = await isFilmJob(job);
      if (filmMode) {
        await filmAudit(job);
        const timing = await json(path.join(job,'timing.json'));
        if (timing.missing?.length) throw new Error(`Cannot deliver missing scenes: ${timing.missing.join(', ')}`);
        const pixels = await json(path.join(job,'review/pixels.json')).catch(() => null);
        if (!pixels?.ok) throw new Error('Pixel checks on the render have not passed; render again after repairs.');
        await writeProductionReport(job);
      } else await audit(job);
      await verify(job);
      const qualification = await qualifyDelivery(job);
      await writeReviewFile(job,'review/delivery.json',JSON.stringify(qualification,null,2)+'\n');
      manifest.status = 'complete'; manifest.completedAt = new Date().toISOString();
      manifest.delivery = {videoSha256:qualification.videoSha256, sourceHash:qualification.sourceHash,
        packSha256:qualification.packSha256};
      await save(path.join(job,'job.json'), manifest);
      console.log(JSON.stringify({...qualification,output:path.relative(ROOT,path.join(job,'renders/video.mp4'))},null,2));
    }
    else if (command === 'check') { if (await isFilmJob(job)) { const r = await buildFilm(job); if (!r.ok) process.exitCode = 1; await hf(['lint'], {cwd: job}); } else {await audit(job); await hf(['check', '--snapshots'], {cwd: job});} }
    else if (command === 'preview') await hf(['preview', '--background', '--port', opts.port || '3002'], {cwd: job});
    else if (command === 'render' && await isFilmJob(job)) {
      await renderFilm(job, {hf, verify, quality: opts.quality || 'delivery', force: opts.force === 'true'});
      console.log(`\nNext: npm run video -- next --job ${path.relative(ROOT, job)}`);
    }
    else if (command === 'render') {
      const manifest = await json(path.join(job,'job.json'));
      if (![24,30,60].includes(manifest.fps)) throw new Error('Job fps must be 24, 30, or 60.');
      manifest.status = 'rendering'; delete manifest.completedAt; delete manifest.delivery;
      await save(path.join(job,'job.json'), manifest);
      await audit(job);
      const sourceHash = await sourceFingerprint(job);
      await hf(['check', '--snapshots'], {cwd: job});
      if (sourceHash !== await sourceFingerprint(job)) throw new Error('Production sources changed during checks. Check and render again.');
      await hf(['render', '--quality', opts.quality || 'delivery', '--fps', String(manifest.fps), '--output', 'renders/video.mp4'], {cwd: job});
      await verify(job);
      if (sourceHash !== await sourceFingerprint(job)) throw new Error('Production sources changed during rendering. Render again before review.');
      await writeReviewFile(job,'review/render-source.json', JSON.stringify({version:1,sourceHash,
        videoSha256:await fileHash(await localFile(job,'renders/video.mp4'))},null,2)+'\n');
      manifest.status = 'draft-rendered';
      await save(path.join(job,'job.json'),manifest);
      console.log('Draft rendered. Commission independent reviews, repair findings, and run deliver to qualify completion.');
    } else throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {console.error(`video: ${error.message}`); process.exitCode = 1;}
