#!/usr/bin/env node
import {readFile, writeFile, mkdir, copyFile, access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {extractNarration, normalizeWords, reconcile, compilePlan, browserCues} from '../lib/timing.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HF = path.join(ROOT, 'node_modules/hyperframes/bin/hyperframes.mjs');
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
  const sourceDuration = Number(metadata.format.duration);
  const start = numeric(opts.start, 0, 'start'), duration = numeric(opts.duration, sourceDuration - start, 'duration');
  if (start < 0 || duration <= 0 || start + duration > sourceDuration + 0.01)
    throw new Error('Requested audio range lies outside the source recording.');
  const language = opts.language || 'en', model = opts.model || (language === 'en' ? 'small.en' : 'small');
  const engine = opts.engine || 'faster-whisper';
  const fps = numeric(opts.fps, 30, 'fps');
  if (![24,30,60].includes(fps)) throw new Error('--fps must be 24, 30, or 60.');
  if (!['faster-whisper', 'hyperframes'].includes(engine)) throw new Error('--engine must be faster-whisper or hyperframes.');
  if (language !== 'en' && model.endsWith('.en')) throw new Error('Non-English audio requires a multilingual model.');
  if (opts.resolution && !['landscape','1080p','portrait','square'].includes(opts.resolution)) throw new Error('Unsupported pipeline resolution.');
  await mkdir(path.dirname(job), {recursive: true});
  await hf(['init', job, '--non-interactive', '--resolution', opts.resolution || 'landscape', '--skill', 'faceless-explainer']);
  await writeFile(path.join(job, 'AGENTS.md'), '# Job authoring\n\nRead ../../AGENTS.md and ../../docs/agent-workflow.md first.\nThe agent has full creative discretion. Supplied audio is authoritative.\n');
  for (const dir of ['inputs', 'assets', 'compositions', 'review', 'renders']) await mkdir(path.join(job, dir), {recursive: true});
  await writeFile(path.join(job, 'inputs/source-script.md'), sourceScript);
  const narration = extractNarration(sourceScript);
  await writeFile(path.join(job, 'inputs/narration.txt'), narration);
  await run('ffmpeg', ['-v', 'error', '-i', audio, '-ss', String(start), '-t', String(duration),
    '-vn', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', path.join(job, 'assets/narration.wav')]);
  await copyFile(path.join(ROOT, 'public/gsap.min.js'), path.join(job, 'assets/gsap.min.js'));
  await copyFile(path.join(ROOT, 'lib/motion.js'), path.join(job, 'assets/motion.js'));
  const actualDuration = Number((await probe(path.join(job, 'assets/narration.wav'))).format.duration);
  const manifest = {version: 1, name: opts.name, createdAt: new Date().toISOString(),
    duration: actualDuration, width: 1920, height: 1080, fps,
    audio: {path: 'assets/narration.wav', source: path.relative(ROOT, audio), sourceStart: start,
      sha256: await digest(path.join(job, 'assets/narration.wav'))},
    script: {path: 'inputs/source-script.md', source: path.relative(ROOT, script), sha256: await digest(script)},
    transcription: {language, model, engine, suppliedWords: !!opts.words},
    creativeMode: 'agent-discretion', workflow: 'faceless-explainer', status: 'awaiting-transcription',
    canvas: '#151915'};
  if (opts.resolution && !['landscape', '1080p'].includes(opts.resolution)) {
    const dimensions = {portrait: [1080,1920], square: [1080,1080]};
    if (!dimensions[opts.resolution]) throw new Error('Pipeline currently supports landscape, portrait, or square.');
    [manifest.width, manifest.height] = dimensions[opts.resolution];
  }
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
  await save(path.join(job, 'beats.json'), {version: 1, scenes: []});
  await writeFile(path.join(job, 'BRIEF.md'), `---\nworkflow: faceless-explainer\nflow: autonomous\n---\n\n# ${manifest.name}\n\nUse the supplied ${actualDuration}s recording verbatim. Agent has full creative discretion.\nCanvas: ${manifest.width}×${manifest.height}; ${manifest.fps} fps.\nConsult repository AGENTS.md and docs/agent-workflow.md. Preserve narration; skip TTS.\n`);
  await writeFile(path.join(job, 'STORYBOARD.md'), '# Storyboard\n\nAgent: design evolving visuals from the recorded excerpt and word cues.\n');
  await writeFile(path.join(job, 'review/REPORT.md'), '# Production review\n\nPending creative build and validation.\n');
  manifest.status = 'prepared';
  await save(path.join(job, 'job.json'), manifest);
  await mkdir(path.join(ROOT, '.video'), {recursive: true});
  await save(path.join(ROOT, '.video/latest.json'), {job: path.relative(ROOT, job)});
  console.log(`Prepared ${path.relative(ROOT, job)}: ${words.length} words, ${(alignment.matchRatio * 100).toFixed(1)}% exact script matches.`);
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
  const manifest = await json(path.join(job, 'job.json')), file = path.join(job, 'renders/video.mp4');
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
  const report = {ok: true, output: path.relative(ROOT, file), duration: Number(metadata.format.duration),
    width: video.width, height: video.height, fps: video.avg_frame_rate, audioCodec: audio.codec_name,
    meanVolumeDb: mean, sha256: await digest(file)};
  await save(path.join(job, 'review/render-verification.json'), report);
  console.log(JSON.stringify(report, null, 2));
}

const HELP = `Narration-driven HyperFrames pipeline

prepare --name <slug> --audio <file> --script <file> [--start 0 --duration 30]
        [--language en --model small.en --engine faster-whisper|hyperframes]
        [--words measured-words.json --resolution landscape --fps 30]
transcribe [--job jobs/<slug>]       resume a failed transcription/preparation
compile | assemble | audit | check | preview | render | verify [--job jobs/<slug>]
render [--quality delivery]          audit + runtime check + render + verify
preview [--port 3002]                persistent HyperFrames Studio

The latest prepared job is used when --job is omitted.
Creative design is performed by the agent; see AGENTS.md and docs/agent-workflow.md.
`;
try {
  const [command = 'help', ...args] = process.argv.slice(2), opts = options(args);
  if (command === 'help') console.log(HELP);
  else if (command === 'prepare') await prepare(opts);
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
    } else if (command === 'compile') await compile(job);
    else if (command === 'assemble') await assemble(job);
    else if (command === 'audit') await audit(job);
    else if (command === 'verify') await verify(job);
    else if (command === 'check') {await audit(job); await hf(['check', '--snapshots'], {cwd: job});}
    else if (command === 'preview') await hf(['preview', '--background', '--port', opts.port || '3002'], {cwd: job});
    else if (command === 'render') {
      await audit(job); await hf(['check', '--snapshots'], {cwd: job});
      const manifest = await json(path.join(job,'job.json'));
      if (![24,30,60].includes(manifest.fps)) throw new Error('Job fps must be 24, 30, or 60.');
      await hf(['render', '--quality', opts.quality || 'delivery', '--fps', String(manifest.fps), '--output', 'renders/video.mp4'], {cwd: job});
      await verify(job);
    } else throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {console.error(`video: ${error.message}`); process.exitCode = 1;}
