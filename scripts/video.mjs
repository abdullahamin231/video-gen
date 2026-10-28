#!/usr/bin/env node
import {readFile, writeFile, mkdir, copyFile, access, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {extractNarration, normalizeWords, reconcile, jobNameFor} from '../lib/timing.mjs';
import {itemPath, inspectBundle, searchLibrary, publishBundle, useBundle, saveToLibrary, saveAll} from '../lib/assets.mjs';
import {fileHash, submitReview, reviewStatus, waiveReview, qualifyDelivery, writeReviewFile, localFile, registerProducer, parseReviewDepth} from '../lib/review.mjs';
import {createReviewPack, generateCaptureInspection, assertIndependentCaptureReviewer} from '../lib/review-pack.mjs';
import {parseStages, parseNote, recordHumanReview} from '../lib/review.mjs';
import {thumbnailStep, thumbnailStatus, recordVerdict, recordRanking, addThumbnailFeedback, chooseThumbnail, exportThumbnail, MAX_THUMBNAILS} from '../lib/thumbnails.mjs';
import {compareNarration} from '../lib/audio.mjs';
import {audioEnv, audioPython} from '../lib/audio.mjs';
import {planCheck, buildFilm, snapshot, filmAudit, renderFilm, remixFilm, nextStep, jobProgress, writeReviewerBriefs, reviewTemplate, writeProductionReport, printSpecError} from '../lib/film.mjs';
import {installRuntime} from '../lib/composition.mjs';
import {importAsset, webImagesAllowed} from '../lib/assets.mjs';
import {SpecError} from '../lib/composition.mjs';
import {directorBrief, writeBrief, taskPrompt} from '../lib/briefs.mjs';
import {findVisualPlan, VISUALS_FILE} from '../lib/timing.mjs';
import {loadChannelTheme, CHANNEL_THEME_FILE} from '../lib/media.mjs';
import {loadConfig, resolveSettings} from '../lib/media.mjs';
import {PERSONALITIES, inferPersonality, loadPersonality, preparationPersonality, freezePersonality, assertRenderReady} from '../lib/personalities.mjs';
import {transcribeNews, ingestNews, newsPlan, isNews, verifyNews} from '../lib/news.mjs';
import {readPersonality} from '../lib/personalities.mjs';
import {readdir} from 'node:fs/promises';
import {findIdeas, loadIdeas, setIdeaStatus, newestFirst, STATUSES} from '../lib/ideas.mjs';
import {createProject, updateProject, listProjects, deleteProject, projectStep, projectStatus, printStatus, recordScriptReview, closeDelegation, carryCaptures,
  assertNoDelegation, projectOfJob, requireQuote, logDecision} from '../lib/project.mjs';
import {setHumanStages} from '../lib/review.mjs';
import {renderStageBar} from '../lib/project.mjs';
import {watchInstructions} from '../lib/watch.mjs';
import {youtubeAuth, youtubeUpload} from '../lib/youtube-upload.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HF = path.join(ROOT, 'node_modules/hyperframes/bin/hyperframes.mjs');
const LIBRARY = process.env.VG_LIBRARY || path.join(ROOT, 'library');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n');
const exists = async file => {try {await access(file); return true;} catch {return false;}};
const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');
// The harness identifies role agents with VIDEO_AGENT_ROLE. Role agents (director, builder, reviewer, ...) follow their
// brief; advancing the pipeline belongs to the orchestrator alone. Without the variable (a plain harness session) every
// command is allowed, as before.
const ROLE = process.env.VIDEO_AGENT_ROLE || '';
const ROLE_AGENT = Boolean(ROLE) && ROLE !== 'orchestrator';
const ORCHESTRATOR_ONLY = new Set(['start', 'prepare', 'next', 'render', 'review-pack', 'capture-visibility', 'deliver', 'save-all', 'preview', 'mix', 'transcribe', 'alignment-approve', 'human-review', 'play', 'youtube-auth', 'youtube-upload',
  'thumbnails', 'thumbnail-choose', 'thumbnail-feedback', 'thumbnail-settings',
  'project-new', 'project-set', 'project-delete', 'script-review', 'watch', 'watch-serve', 'delegated']);
// Chat projects (lib/project.mjs): commands that work on a project rather than a job.
const PROJECT_COMMANDS = new Set(['project-new', 'projects', 'project-set', 'project-delete', 'script-review', 'watch', 'watch-serve', 'delegated', 'stage-bar']);
// Commands that never advance the pipeline, so they stay usable while delegated work is open.
const DURING_DELEGATION = new Set(['status', 'projects', 'watch', 'watch-serve', 'delegated', 'stage-bar']);
const advances = (command, opts) => (ORCHESTRATOR_ONLY.has(command) && !DURING_DELEGATION.has(command)) || (command === 'build' && !opts.scene);
const nextHint = job => ROLE_AGENT ? '\nDone with this command. Finish your brief and reply; the orchestrator advances the pipeline.' : `\nNext: npm run video -- next --job ${path.relative(ROOT, job)}`;

function run(command, args, {cwd = ROOT, capture = false, env = {}, forwardSignals = false} = {}) {
  return new Promise((resolve, reject) => {
    // Some CLI naming uses PWD rather than process.cwd(). Keep both consistent
    // when npm invokes the job from the repository root.
    const child = spawn(command, args, {cwd, env: {...process.env, PWD: cwd, ...env},
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit'});
    const stop = signal => child.kill(signal);
    const term = () => stop('SIGTERM'), interrupt = () => stop('SIGINT');
    if (forwardSignals) {
      process.on('SIGTERM', term); process.on('SIGINT', interrupt);
      const cleanup = () => { process.off('SIGTERM', term); process.off('SIGINT', interrupt); };
      child.once('close', cleanup); child.once('error', cleanup);
    }
    let output = '';
    if (capture) child.stdout.on('data', chunk => {output += chunk;});
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`${command} exited ${code}`)));
  });
}
const hf = (args, opts) => run(process.execPath, [HF, ...args], opts);
const probe = async file => JSON.parse(await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], {capture: true}));
// Commands that change a film's sources, reviews or render. Once a job is delivered they would quietly send it back into
// production (status → rendering/draft-rendered, stale reviews), so they need an explicit --reopen true.
const PRODUCTION_COMMANDS = new Set(['transcribe', 'plan-check', 'build', 'asset', 'save', 'save-all', 'music', 'mix',
  'news-ingest', 'news-transcribe', 'alignment-approve', 'check', 'review-pack', 'human-review', 'review-submit', 'deliver', 'render', 'library-use']);
const PRODUCER_COMMANDS = new Set(['plan-check', 'build', 'asset', 'save', 'save-all', 'music', 'mix', 'news-ingest', 'news-transcribe', 'alignment-approve', 'check', 'capture-ingest', 'capture-scene']);
async function guardDelivered(job, command, opts) {
  if (!PRODUCTION_COMMANDS.has(command)) return;
  if (command === 'human-review' && opts.want !== undefined) return;
  const manifest = await json(path.join(job, 'job.json')).catch(() => null);
  if (manifest?.status !== 'complete') return;
  if (opts.reopen !== 'true') throw new Error(`${path.relative(ROOT, job)} is delivered; \`${command}\` would send it back into production. ` +
    'Make a new job, or pass --reopen true if you really mean to reopen this one (it then has to be reviewed and delivered again).');
  manifest.status = 'reopened'; manifest.reopenedAt = new Date().toISOString();
  await save(path.join(job, 'job.json'), manifest);
  console.log(`Reopened ${path.relative(ROOT, job)}: it is no longer delivered until it passes review and deliver again.`);
}

function options(args) {
  const result = {};
  while (args.length) {
    const key = args.shift();
    if (['--json','--generate','--no-latest'].includes(key) && (!args.length || args[0].startsWith('--'))) { result[key.slice(2)] = true; continue; }
    if (!key.startsWith('--') || !args.length || args[0].startsWith('--')) throw new Error(`Expected --option value: ${key}`);
    if (key === '--note' || key === '--finding' || key === '--model' || key === '--tag') (result[key.slice(2)] ||= []).push(args.shift()); // repeatable
    else result[key.slice(2)] = args.shift();
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
function producerRecord() {
  const agentId = process.env.VIDEO_AGENT_ID, role = process.env.VIDEO_AGENT_ROLE;
  return agentId && role && role !== 'reviewer' && !role.endsWith('-reviewer') ? {agentId, role, source:'VIDEO_AGENT_ID/VIDEO_AGENT_ROLE'} : null;
}
async function captureProducerHistory(script) {
  const root = path.join(path.dirname(script), 'capture');
  const entries = await (await import('node:fs/promises')).readdir(root, {withFileTypes:true}).catch(()=>[]);
  const records=[];
  for (const entry of entries.filter(e=>e.isDirectory())) {
    const capture = await json(path.join(root,entry.name,'manifest.json')).catch(()=>null);
    // Both stages own real runner records: capture-ingest writes `producer`, while
    // capture-scene appends to `producerHistory`. Keep historical manifests
    // without either field honestly unattributed.
    const saved = [...(capture?.producer ? [capture.producer] : []), ...(Array.isArray(capture?.producerHistory) ? capture.producerHistory : [])];
    for (const record of saved) if (record?.agentId && record.role && record.role !== 'reviewer' && !record.role.endsWith('-reviewer'))
      records.push({agentId:record.agentId,role:record.role,source:record.source || 'saved-capture-manifest'});
  }
  const project=await json(path.join(path.dirname(script),'project.json')).catch(()=>null);
  const delegations=[...(Array.isArray(project?.history) ? project.history.filter(h=>h && typeof h === 'object' && Array.isArray(h.tasks)) : []),...(project?.delegation ? [project.delegation] : [])];
  for (const task of delegations.flatMap(d=>d.tasks || [])) if (task?.agentId && task.role && task.role !== 'reviewer' && !task.role.endsWith('-reviewer'))
    records.push({agentId:task.agentId,role:task.role,source:'saved-project-delegation'});
  return [...new Map(records.map(r=>[`${r.agentId}\0${r.role}`,r])).values()];
}
async function registerCaptureProducer(dir) {
  const record=producerRecord();
  if (!record) return;
  const file=path.join(dir,'manifest.json'), manifest=await json(file);
  manifest.producerHistory ||= [];
  if (!manifest.producerHistory.some(r=>r.agentId===record.agentId&&r.role===record.role)) manifest.producerHistory.push(record);
  await save(file,manifest);
}
async function prepare(opts) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(opts.name || '')) throw new Error('--name must be a lowercase job slug.');
  if (!opts.audio || !opts.script) throw new Error('prepare requires --audio and --script.');
  const reviewDepth = parseReviewDepth(opts['review-depth']);
  const job = path.join(ROOT, 'jobs', opts.name);
  if (await exists(job)) throw new Error(`Job exists: ${job}. Use a new --name; existing work is never overwritten.`);
  const audio = path.resolve(ROOT, opts.audio), script = path.resolve(ROOT, opts.script);
  const [metadata, sourceScript] = await Promise.all([probe(audio), readFile(script, 'utf8')]);
  const personality = preparationPersonality(path.dirname(script), sourceScript, opts.profile);
  assertRenderReady(personality);
  const config = await loadConfig(ROOT), settings = resolveSettings(opts, config, Number(metadata.format.duration));
  const channel = personality.profile.id === 'explainer' ? await loadChannelTheme(ROOT, config) : null;
  const {start, duration, format, fps} = settings;
  for (const w of settings.warnings) console.warn(`Warning: ${w}`);
  const language = opts.language || 'en', model = opts.model || (language === 'en' ? 'small.en' : 'small');
  const engine = opts.engine || 'faster-whisper';
  if (!['faster-whisper', 'hyperframes'].includes(engine)) throw new Error('--engine must be faster-whisper or hyperframes.');
  if (language !== 'en' && model.endsWith('.en')) throw new Error('Non-English audio requires a multilingual model.');
  await mkdir(path.dirname(job), {recursive: true});
  await hf(['init', job, '--non-interactive', '--resolution', format === 'vertical' ? 'portrait' : format], {capture: true, env: {HYPERFRAMES_SKIP_SKILLS: '1'}});
  const pointer = `# Job ${opts.name}\n\nThis is a pipeline job. Do not run hyperframes or npx commands here and never upgrade HyperFrames.\n\n` +
    `If you were given a brief (a file in briefs/), follow only that brief: do not run \`next\`, \`render\`, \`review-pack\` or \`deliver\`, ` +
    `do not start sub-agents, and reply when the brief is done.\n\n` +
    `Only the orchestrator, with no brief, advances the job: from the repository root it runs ` +
    `npm run video -- next --job jobs/${opts.name} and does what it prints.\n`;
  for (const f of ['AGENTS.md', 'CLAUDE.md']) await writeFile(path.join(job, f), pointer);
  await writeFile(path.join(job, 'package.json'), JSON.stringify({name: opts.name, private: true, type: 'module',
    scripts: {next: `npm --prefix ../.. run video -- next --job jobs/${opts.name}`}}, null, 2) + '\n');
  for (const dir of ['inputs', 'assets', 'compositions', 'review', 'renders', 'shots', 'components', 'briefs']) await mkdir(path.join(job, dir), {recursive: true});
  // An app review's session was recorded before the script, so it travels into the job with its evidence.
  await carryCaptures(script, job);
  const productionProfile = await freezePersonality(job, personality);

  await writeFile(path.join(job, 'inputs/source-script.md'), sourceScript);
  const sourceBrief = opts['brief-file'] ? path.resolve(ROOT,opts['brief-file']) : path.join(path.dirname(script),'BRIEF.md');
  const hasBrief = await exists(sourceBrief);
  if(hasBrief) await copyFile(sourceBrief,path.join(job,'inputs/brief.md'));
  // The writer's visual plan travels with the script; without one, `next` asks a writer for it before planning.
  const visuals = opts.visuals ? path.resolve(ROOT, opts.visuals) : await findVisualPlan(script);
  if (visuals) await copyFile(visuals, path.join(job, VISUALS_FILE));
  // The channel's theme travels with the job, so the plan is made in it and later checks compare against the same file.
  if (channel) await copyFile(channel.file, path.join(job, CHANNEL_THEME_FILE));
  const narration = extractNarration(sourceScript);
  await writeFile(path.join(job, 'inputs/narration.txt'), narration);
  await run('ffmpeg', ['-v', 'error', '-i', audio, '-ss', String(start), '-t', String(duration),
    '-vn', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', path.join(job, 'assets/narration.wav')]);
  const actualDuration = Number((await probe(path.join(job, 'assets/narration.wav'))).format.duration);
  const producerHistory = await captureProducerHistory(script);
  const manifest = {version: 1, name: opts.name, createdAt: new Date().toISOString(),
    duration: actualDuration, format, width: settings.width, height: settings.height, fps,
    audio: {path: 'assets/narration.wav', source: path.relative(ROOT, audio), sourceStart: start,
      sha256: await digest(path.join(job, 'assets/narration.wav'))},
    ...(hasBrief ? {brief:{path:'inputs/brief.md',source:path.relative(ROOT,sourceBrief)}} : {}),
    script: {path: 'inputs/source-script.md', source: path.relative(ROOT, script), sha256: await digest(script)},
    ...(visuals ? {visuals: {path: VISUALS_FILE, source: path.relative(ROOT, visuals), sha256: await digest(visuals)}} : {}),
    ...(channel ? {channelTheme: {path: CHANNEL_THEME_FILE, source: path.relative(ROOT, channel.file), sha256: await digest(channel.file)}} : {}),
    transcription: {language, model, engine, suppliedWords: !!opts.words},
    productionProfile, reviewDepth, creativeMode: 'agent-discretion', workflow: personality.profile.workflow, status: 'awaiting-transcription',
    review: {producerAgentIds: [...new Set(producerHistory.map(r=>r.agentId))], producerAgentRecords: producerHistory, producerIdentityStatus: producerHistory.length ? 'recorded' : 'unrecorded',
      ...(producerHistory.length ? {} : {producerIdentityIssue: 'No runner-provided producer identity has been recorded yet.'}),
      requiredRoles: ['visual-mechanism', 'narration-fidelity', 'continuity-legibility']},
    canvas: '#151915'};
  await save(path.join(job, 'job.json'), manifest);
  if (opts.words) await copyFile(path.resolve(ROOT, opts.words), path.join(job, 'transcript.json'));
  else await transcribe(job, manifest);
  await finishPreparation(job, manifest, narration, {updateLatest: !opts['no-latest']});
}
async function transcribe(job, manifest) {
  const {model, language, engine = 'faster-whisper'} = manifest.transcription;
  if (engine === 'hyperframes') await hf(['transcribe', 'assets/narration.wav', '--dir', job, '--engine', 'whisper', '--model', model, '--language', language], {cwd: job});
  else await run('uv', ['run', '--locked', '--script', path.join(ROOT,'scripts/transcribe.py'),
    path.join(job,'assets/narration.wav'), path.join(job,'transcript.json'), '--model', model, '--language', language]);
}
async function finishPreparation(job, manifest, narration, {updateLatest = true} = {}) {
  const actualDuration = manifest.duration;
  const words = normalizeWords(await json(path.join(job, 'transcript.json')), actualDuration);
  const alignment = reconcile(words, narration);
  await save(path.join(job, 'alignment.json'), alignment);
  await writeFile(path.join(job, 'SCRIPT.md'), `# Recorded excerpt\n\n${words.map(w => w.text).join(' ')}\n`);
  await writeBrief(job, 'director.md', directorBrief(job, manifest, alignment));
  await writeFile(path.join(job,'BRIEF.md'),taskPrompt('film',{name:manifest.name,contract:'docs/composition.md',recording:'assets/narration.wav',script:'inputs/source-script.md',userBrief:manifest.brief?.path||null,duration:manifest.duration,width:manifest.width,height:manifest.height}));
  await writeFile(path.join(job, 'review/REPORT.md'), '# Production review\n\nPending creative build and validation.\n');
  manifest.status = 'prepared';
  await save(path.join(job, 'job.json'), manifest);
  if (updateLatest) {
    await mkdir(path.join(ROOT, '.video'), {recursive: true});
    await save(path.join(ROOT, '.video/latest.json'), {job: path.relative(ROOT, job)});
  }
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
function thumbnailSettings({count, pick}) {
  const out = {};
  if (count !== undefined) {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > MAX_THUMBNAILS) throw new Error(`--thumbnails is a whole number from 1 to ${MAX_THUMBNAILS}.`);
    out.thumbnails = n;
  }
  if (pick !== undefined) {
    if (!['true', 'false'].includes(String(pick))) throw new Error('--pick-thumbnail is true or false.');
    out.pickThumbnail = String(pick) === 'true';
  }
  return out;
}
async function start(opts) {
  const audio = await resolveInput(opts.audio || '', 'Audio'), script = await resolveInput(opts.script || '', 'Script');
  if (opts.visuals) opts = {...opts, visuals: path.relative(ROOT, await resolveInput(opts.visuals, 'Visual plan'))};
  let name = opts.name || jobNameFor(script, await readFile(script, 'utf8'));
  if (!/^[a-z0-9]/.test(name)) name = 'film-' + name;
  let candidate = name, i = 2;
  while (await exists(path.join(ROOT, 'jobs', candidate))) candidate = `${name}-${i++}`;
  const {music, 'human-review': humanReview, thumbnails, 'pick-thumbnail': pick, ...rest} = opts;
  // Checked before any work.
  const stages = humanReview === undefined ? null : parseStages(humanReview);
  const thumbs = thumbnailSettings({count: thumbnails, pick});
  await prepare({...rest, name: candidate, audio: path.relative(ROOT, audio), script: path.relative(ROOT, script)});
  if (stages || Object.keys(thumbs).length) {
    const file = path.join(ROOT, 'jobs', candidate, 'job.json'), manifest = await json(file);
    if (stages) manifest.humanReview = stages;
    Object.assign(manifest, thumbs); await save(file, manifest);
  }
  if (music) { // a track the user supplied: keep it, analyse its beats, and tell the director to use it
    const track = await resolveInput(music, 'Music');
    await musicImport(path.join(ROOT, 'jobs', candidate), {src: path.relative(ROOT, track), name: `music/${path.basename(track).toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`,
      source: `supplied by the user (${path.relative(ROOT, track)})`, license: 'supplied by the user', note: 'music track supplied by the user for this film'});
    const job = path.join(ROOT, 'jobs', candidate), manifest = await json(path.join(job, 'job.json'));
    manifest.music = `assets/music/${path.basename(track).toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`;
    await save(path.join(job, 'job.json'), manifest);
    await writeBrief(job, 'director.md', directorBrief(job, manifest, await json(path.join(job, 'alignment.json'))));
  }
}

async function verify(job) {
  if (isNews(readPersonality(job))) { const report = await verifyNews(job); console.log(JSON.stringify(report,null,2)); return report; }
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
  // A film's soundtrack is mixed by the pipeline (renders/mix.wav: narration unprocessed + sound effects + music, one
  // master gain). The render must carry exactly that mix; without one (older jobs) it must carry the narration alone.
  const narrationFile = await localFile(job, 'assets/narration.wav'), mixFile = path.join(job, 'renders/mix.wav');
  const mixReport = await exists(mixFile) ? await json(path.join(job, 'review/mix.json')).catch(() => null) : null;
  const reference = mixReport ? mixFile : narrationFile;
  const soundtrack = mixReport ? {reference: 'renders/mix.wav (narration unprocessed + declared sound effects + music, master gain ' + mixReport.gainDb + ' dB)',
    narrationOnlyCorrelation: (await compareNarration(file, narrationFile)).correlation, loudness: {integratedLufs: mixReport.integratedLufs, truePeakDb: mixReport.truePeakDb,
      samplePeakDb: mixReport.samplePeakDb, mono: mixReport.mono, peaksOk: mixReport.peaksOk, limitedBy: mixReport.limitedBy}, soundEffects: mixReport.soundEffects,
    music: mixReport.music, voiceMasked: mixReport.voiceMasked, voiceClose: mixReport.voiceClose, soundsUnderMusic: mixReport.soundsUnderMusic} : null;
  const narrationIntegrity = {...await compareNarration(file, reference), ...(soundtrack ? {reference: soundtrack.reference} : {})};
  const report = {ok: true, output: path.relative(ROOT, file), duration: Number(metadata.format.duration),
    width: video.width, height: video.height, fps: video.avg_frame_rate, audioCodec: audio.codec_name,
    meanVolumeDb: mean, sha256: await fileHash(file), narrationIntegrity, ...(soundtrack ? {soundtrack} : {})};
  await writeReviewFile(job,'review/render-verification.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report, null, 2));
}

async function setupAudio() {
  const missing = [];
  for (const bin of ['ffmpeg', 'ffprobe']) if (!await run('which', [bin], {capture: true}).catch(() => null)) missing.push(bin);
  if (missing.length) throw new Error(`${missing.join(' and ')} not found. Install ffmpeg (for example: sudo apt install ffmpeg), then run setup-audio again.`);
  const env = audioEnv(), py = path.join(env, 'bin/python');
  if (!await run(py, ['-c', 'import librosa, matplotlib, scipy, soundfile'], {capture: true}).catch(() => null)) {
    await run('python3', ['-m', 'venv', env]);
    await run(py, ['-m', 'pip', 'install', '-q', '--no-cache-dir', 'librosa', 'matplotlib', 'scipy', 'soundfile']);
  }
  console.log(`Audio tools ready: ffmpeg, librosa (${env}).`);
  return py;
}
/** Bring a licensed music track into assets/music/, record its licence, find its beats (checked against the kicks). */
async function musicImport(job, opts) {
  if (!opts.src || !opts.name) throw new Error('music needs --src <url|file> --name music/<track>.mp3 --source "<page it came from>" --license "<licence>"');
  if (!opts.license?.trim() || !opts.source?.trim()) throw new Error('music needs --license "<the licence named on its page, e.g. Mixkit Stock Music Free License>" and --source "<that page URL>". Unlicensed music cannot be used.');
  if (/non-?commercial|\bNC\b|\bND\b|personal use|editorial/i.test(opts.license)) throw new Error(`Licence "${opts.license}" does not allow this use. Pick a track under a licence that allows commercial use and modification (Mixkit free license, Pixabay, CC0, CC BY).`);
  const name = opts.name.startsWith('music/') ? opts.name : `music/${opts.name}`;
  const a = await importAsset(job, ROOT, {src: opts.src, name, note: opts.note || `music: ${opts.title || path.basename(name)}`, title: opts.title || '', tags: opts.tags || 'music,track', license: opts.license, source: opts.source});
  const py = await audioPython() || await setupAudio();
  const base = path.basename(name).replace(/\.[^.]+$/, ''), beats = `assets/music/${base}.beats.json`, plot = `review/music/${base}-beats.png`;
  await mkdir(path.join(job, 'review/music'), {recursive: true});
  const out = await run(py, ['-I', path.join(ROOT, 'scripts/sfx/beats.py'), path.join(job, a.path), path.join(job, beats), path.join(job, plot)], {capture: true});
  const r = await json(path.join(job, beats));
  await saveToLibrary(LIBRARY, job, {file: a.path, title: opts.title || `music track ${base}`, tags: opts.tags || 'music,track', note: `${opts.title || base}: ${r.tempo} BPM. Source: ${opts.source}`, origin: opts.source, license: opts.license});
  console.log(out.trim());
  console.log(`\nMusic ${a.path}: ${r.tempo} BPM, beat every ${r.period}s; grid shifted ${(r.shiftApplied * 1000).toFixed(0)} ms${r.offBeatLock ? ' (librosa had locked onto the off-beat)' : ''}; kicks within 35 ms of the grid: ${Math.round((r.kickAlignment.after?.onBeat ?? 0) * 100)}%.`);
  console.log(`Look at the plot: ${path.relative(ROOT, path.join(job, plot))} (red grid lines must sit on the orange kick marks).`);
  console.log(`Then set film.json "music": {"src": "${a.path}", "source": ${JSON.stringify(opts.source)}, "license": ${JSON.stringify(opts.license)}, "trackStart": 0, "filmStart": 0} and run plan-check; the build reports which cuts land on the beat.`);
}

function printIdea(c, i) {
  console.log(`\n${i + 1}. ${c.title}   [${c.id} · ${c.form} · score ${c.score.toFixed(2)}${c.status !== 'new' ? ` · ${c.status}` : ''}]`);
  console.log(`   ${c.promise}`);
  for (const r of c.reasons) console.log(`   + ${r}`);
  for (const s of c.sources) console.log(`   - ${s.label}: ${s.title}${s.metric ? ` (${s.metric})` : ''}\n     ${s.url}`);
}
async function ideasCommand(opts) {
  if (opts.set) {
    const c = await setIdeaStatus(ROOT, opts.set, opts.status, opts.reason);
    return console.log(opts.json ? JSON.stringify(c) : `Marked ${c.id} as ${c.status}: ${c.title}`);
  }
  if (opts.show) {
    if (![...STATUSES, 'all'].includes(opts.show)) throw new Error(`--show must be one of: ${[...STATUSES, 'all'].join(', ')}`);
    const cards = newestFirst((await loadIdeas(ROOT)).cards).filter(c => opts.show === 'all' || c.status === opts.show);
    if (opts.json) return console.log(JSON.stringify(cards));
    if (!cards.length) return console.log(`No ${opts.show === 'all' ? '' : opts.show + ' '}ideas yet. Run: npm run video -- ideas`);
    return cards.forEach(printIdea);
  }
  const {run, cards} = await findIdeas(ROOT, {focus: opts.focus || '', count: numeric(opts.count, 0, 'count') || undefined, refresh: opts.refresh === 'true'});
  if (opts.json) return console.log(JSON.stringify({run, cards}));
  for (const s of run.sources) console.log(`${s.ok ? '✓' : '✗'} ${s.name}: ${s.ok ? `${s.count} item(s)${s.cached ? ' (cached)' : ''}` : s.error}`);
  if (!cards.length) console.log(`\nNo new ideas${run.focus ? ` matching “${run.focus}”` : ''}. Try --refresh true later, or a different --focus.`);
  else { console.log(`\n${cards.length} new idea(s)${run.focus ? ` for “${run.focus}”` : ''}:`); cards.forEach(printIdea); }
  console.log('\nRun again for more. Mark one with: npm run video -- ideas --set <id> --status saved|rejected');
}
// ------------------------------------------------------------------ chat projects (T3 Code; docs/orchestrator.md)
async function projectCommand(command, opts) {
  const slug = opts.project;
  if (command === 'project-new') {
    const project = await createProject(ROOT, opts, {resolveInput, setIdeaStatus});
    console.log(`Created project ${project.slug} (jobs/scripts/${project.slug}/). Personality: ${project.productionProfile.id}. Checkpoints: ${project.review.join(', ') || 'none'}.\nNext: npm run video -- next --project ${project.slug}`);
  } else if (command === 'projects') {
    const list = await listProjects(ROOT);
    if (opts.json) console.log(JSON.stringify(list));
    else console.log(list.length ? list.map(p => `${p.slug.padEnd(40)} ${p.phase}${p.delegation ? ` · delegated: ${p.delegation.join(', ')}` : ''}  (${String(p.createdAt).slice(0, 10)})`).join('\n')
      : 'No projects yet. Create one with: npm run video -- project-new --name <slug> (after writing jobs/scripts/<slug>/BRIEF.md)');
  } else if (command === 'next') {
    console.log((await projectStep(ROOT, slug)).text);
  } else if (command === 'status') {
    const status = await projectStatus(ROOT, slug);
    console.log(opts.json ? JSON.stringify(status) : printStatus(status));
  } else if (command === 'stage-bar') {
    const status = await projectStatus(ROOT, slug);
    console.log(renderStageBar(slug, status.stages));
  } else if (command === 'delegated') {
    const {closed} = await closeDelegation(ROOT, slug);
    // One command closes the batch and advances: the orchestrator should not spend a second turn on `next`.
    const step = await projectStep(ROOT, slug);
    console.log(`${closed ? `Closed: ${closed.tasks.map(t => t.title).join(', ')}.` : 'No delegated work was open.'}\n${step.text}`);
  } else if (command === 'script-review') {
    await assertNoDelegation(ROOT, slug, command);
    const quote = requireQuote(opts);
    const record = await recordScriptReview(ROOT, slug, {decision: opts.decision, notes: opts.note || [], quote});
    console.log(`Recorded: ${record.decision} on the script${record.notes.length ? ` with ${record.notes.length} note(s)` : ''}.\nNext: npm run video -- next --project ${slug}`);
  } else if (command === 'project-set') {
    await assertNoDelegation(ROOT, slug, command);
    const {changes} = await updateProject(ROOT, slug, opts, {setHumanStages});
    console.log(`Updated ${slug}: ${changes.join('; ')}.`);
  } else if (command === 'project-delete') {
    const removed = await deleteProject(ROOT, slug, opts.confirm);
    const {stopWatch} = await import('../lib/watch.mjs'); await stopWatch(ROOT, slug);
    console.log(`Deleted ${removed.join(', ')}. Saved library assets stay.`);
  } else if (command === 'watch') {
    const {startWatch, stopWatch} = await import('../lib/watch.mjs');
    if (opts.stop === 'true' || opts.stop === '') { console.log(await stopWatch(ROOT, slug) ? `Stopped the watch server for ${slug}.` : 'No watch server was running.'); return; }
    const {url, reused} = await startWatch(ROOT, slug, {script: fileURLToPath(import.meta.url)});
    console.log(watchInstructions(url, slug, reused));
  } else if (command === 'watch-serve') {
    const {serveWatch} = await import('../lib/watch.mjs');
    const {url} = await serveWatch(ROOT, slug, {port: opts.port || 0});
    console.log(`Serving ${slug} at ${url}`);
    await new Promise(() => {});
  }
}
// A person's decision recorded from a chat carries their own words.
async function personDecision(job, command, opts) {
  const project = await projectOfJob(ROOT, job);
  if (!project) return null;
  if (command === 'human-review' && opts.want !== undefined) return null;
  if (command === 'thumbnail-choose' && opts.by !== 'you') return null;
  if (command === 'thumbnail-choose') { // archiving a pick the person already made needs no new decision
    const chosen = (await thumbnailStatus(job).catch(() => null))?.chosen;
    if (chosen?.by === 'you' && chosen.variant === opts.variant) return null;
  }
  return {slug: project.slug, quote: requireQuote(opts)};
}

const HELP = `Narration-driven HyperFrames pipeline

Agents: run \`next\` and do exactly what it prints, until it says done.

start --audio <file> --script <file> [--profile <id>] [--format landscape|vertical --length 30 --start 0 --name slug --music <track> --visuals <VISUALS.md> --human-review final --review-depth fast|standard|deep]   create a job (a VISUALS.md beside the script is picked up automatically)
                                     defaults come from video.config.json; --length trims to the first N seconds (--duration is the same)
                                     the job is named from the script file, else its folder or title (e.g. jobs/scripts/<slug>/SCRIPT.md → <slug>); --name overrides
next [--job jobs/<slug>]             print the single next step (state machine)
status [--job jobs/<slug>] [--json]  read-only progress of every step, scene and review (writes nothing)
plan-check                          validate film.json (director output)
build [--scene <id>]                 compile shots, assemble, inspect, print motion transcript
snapshot [--scene <id>] [--at 1.2,3] write PNG frames of the world (for agents that can view images)
asset --src <url|file> --name <x.png|sfx/x.wav> --note "what it shows" [--title ".." --tags "a,b" --license ".." --source ".."]  bring an image/logo/font/sound into assets/ and save it to library/
                                     web URLs: SVG only unless VG_ALLOW_WEB_IMAGES=1 (png/jpg/webp/gif then allowed)
save --file <job file> --title ".." --tags "a,b" [--note ".." --id slug]  save something you made (drawing, component, Manim file) to library/
save-all                             save every job asset/component the library does not hold yet
review-template --stage S --role R   write a pre-filled reviewer report
alignment-approve --note "..."       record review of a low script match
setup-audio                          check ffmpeg, install librosa (beat analysis for music)
capture-ingest --run <reshoot run folder> --task <id> [--feature ".." --claim ".." --build ".." --dir capture/<task>]   turn a reshoot run
                                     (headless Chrome, cursor composited) into recording.mp4, actions.jsonl, shots/ and manifest.json;
                                     in a project this runs before the film job exists (docs/capture.md)
capture-scene --capture <dir> --scene <id> [--fit 0.9]   cut the recording per capture/<task>/edits.json and compile
                                     shots/<id>.json: click rings and camera push-in/pull-out over the recorded cursor (build it afterwards)
music --src <url|file> --name music/<x>.mp3 --source "<page>" --license "<licence>" [--title ..]  bring in a licensed track; finds its beats

news-ingest --job <job> --source <id> --file <repository-local cleared file>\nnews-transcribe --job <job> --source <id> [--model small.en --language en]  original-file word times; review draft before use\nnews-check --job <job>               validate news sources, rights, claims, edit and required speech subtitles\nprepare --name <slug> --audio <file> --script <file> [--profile <id>] [--start 0 --length 30 --format landscape|vertical] [--review-depth fast|standard|deep]
        [--language en --model small.en --engine faster-whisper|hyperframes]
        [--words measured-words.json --fps 30]
transcribe [--job jobs/<slug>]       resume a failed transcription/preparation
audit | check | preview | render | verify [--job jobs/<slug>]
render [--quality delivery --workers 3 --reuse-build true]  render + mix + verify, once, after the final reviews; reuse-build requires a current successful full build
mix                                  redo the soundtrack mix on the current render (sources unchanged)
review-pack --stage final [--from html|render]  freeze review evidence for the whole film (frames from the built HTML by default; nothing is rendered)
capture-visibility --generate | --record <review.json>   generate current paired source/render frames or record independent verdicts
human-review --stage final --decision approve|revise [--note "12.5: text" ...]  record the person's own review of the current pack
human-review --want final|none   choose whether the person reviews the whole film (start takes --human-review too)
play [--port 3004]                   play the built film in the browser, with a scene strip (read-only; no render)
thumbnails [--json]                  after delivery: the next thumbnail step (N variants, review, pick, archive)
thumbnail-settings [--count 1-6] [--pick true|false]   variants to make, and whether the person picks (start: --thumbnails, --pick-thumbnail)
thumbnail-export --variant v1        render a variant's SVG at video dimensions plus an aspect-matched feed preview
thumbnail-verdict --variant v1 --status pass|blocked [--finding ".." ...] --inspected a.png,b.png  |  --rank v2,v1   (reviewer)
thumbnail-choose --variant v1 [--by you]   make a passing variant the thumbnail and archive it
thumbnail-feedback --variant v1 --note "<their words>"   ask for that variant again with the person's feedback
review-submit --file <report.json>   validate an independent sub-agent report
review-status --stage final  check independent review qualification
review-waive --stage final --reason ".."   the person stops creative review of the current film (never an agent)
deliver                             qualify current reviews and mark complete
preview [--port 3002]                persistent HyperFrames Studio
library-search [--query "packet flow" --limit 8]  search shared artifact metadata
library-info --item <id@version>     inspect one bundle, usage and provenance
library-add --source <bundle-dir>   publish a new immutable artifact version
library-use --item <id@version> --job jobs/<slug>  freeze files and record hashes

Chat projects (T3 Code; docs/orchestrator.md): the whole video from an agreed brief, one step at a time
profiles | profile-route --prompt "<request>" [--profile <id>]   inspect personalities / infer routing (read-only)
project-new --name <slug> [--profile explainer|rules-story|news-financial|news-political|app-review] [--brief-file f] [--format landscape|vertical --duration <s> --tts ming --audio f --script f --music f
            --review script,final,thumbnail|none --review-depth fast|standard|deep --thumbnails 1-6 --idea <id> --thread <t3 thread id>]   (brief: jobs/scripts/<slug>/BRIEF.md)
next --project <slug>               the single next step of the whole video (T3 delegated tasks, your review checkpoints)
status --project <slug> [--json]    every stage, read-only        projects [--json]   every project and where it is
stage-bar --project <slug>          the stage bar as one HTML page, for T3 html_render (read-only)
delegated --project <slug>          the delegated tasks next started have finished (or were lost); next may go on
script-review --project <slug> --decision approve|revise [--note "<their words>" ...] --quote "<their message>"
watch --project <slug> [--stop true] read-only harness review page (background server)
project-set --project <slug> [--review ..] [--review-depth fast|standard|deep] [--thumbnails N] [--tts ..] [--model role=provider:model ...]
project-delete --project <slug> --confirm <slug>
(human-review, thumbnail-choose --by you, thumbnail-feedback and review-waive on a project's job also need --quote "<their message>")

ideas [--focus "mac hardware" --count 6 --refresh true --json]   find new video ideas (never repeats one already shown)
                                     feeds and reference channels come from ideas.config.json; YOUTUBE_API_KEY is optional
youtube-auth                         authorize the abdupdates YouTube channel (OAuth client JSON stays in .cache)
youtube-upload --file <video.mp4> --title "Title" [--description "..."] [--privacy private|unlisted|public] [--tag "ai" ...]
                                     upload with resumable transfer; privacy defaults to unlisted. See docs/publishing.md
frame-stats --video <a.mp4>[,<b.mp4>] [--every 2]   measure how much of the frame a film uses (ink, spread, near-blank), to compare films
ideas --show new|saved|rejected|used|all [--json]   list ideas found so far
ideas --set <id> --status new|saved|rejected|used [--reason ".."]   mark an idea

The latest prepared job is used when --job is omitted.
Creative design is performed by the agent; see docs/orchestrator.md.
`;
try {
  const [command = 'help', ...args] = process.argv.slice(2);
  if (command === 'tts') {
    await (await import('../lib/narration.mjs')).ttsCommand(args);
    process.exit(0);
  }
  const opts = options(args);
  const reviewerRecordingVerdict = command === 'capture-visibility' && Boolean(opts.record) && ROLE === 'reviewer';
  if (ROLE_AGENT && !reviewerRecordingVerdict && (ORCHESTRATOR_ONLY.has(command) || (command === 'build' && !opts.scene)))
    throw new Error(`\`${command}${command === 'build' ? ' without --scene' : ''}\` advances the pipeline, which is the orchestrator's job. You are the ${ROLE}: finish the brief you were given and reply with its result. Do not start sub-agents.`);
  if (command === 'profiles') console.log(JSON.stringify(PERSONALITIES.map(id => loadPersonality(id).profile), null, 2));
  else if (command === 'profile-route') {
    const prompt = opts.prompt || (opts['brief-file'] ? await readFile(path.resolve(ROOT, opts['brief-file']), 'utf8') : '');
    if (!prompt.trim()) throw new Error('profile-route needs --prompt <request> or --brief-file <file>.');
    console.log(JSON.stringify(inferPersonality(prompt, opts.profile), null, 2));
  }
  else if (command === 'youtube-auth') await youtubeAuth(ROOT);
  else if (command === 'youtube-upload') await youtubeUpload(ROOT, opts);
  else if (PROJECT_COMMANDS.has(command) || (['next', 'status'].includes(command) && opts.project)) {
    if (!opts.project && command !== 'project-new' && command !== 'projects') throw new Error(`${command} needs --project <slug> (see \`npm run video -- projects\`).`);
    await projectCommand(command, opts);
  }
  else if (command === 'help') console.log(HELP + '\ntts <file> [--provider ming] [--narration] [-s <speed>] [-o <file.wav>] [--status <file.json>] [--performance <file.json>]  generate local Ming narration (docs/audio.md)');
  else if (command === 'setup-audio') await setupAudio();
  else if (command === 'prepare') await prepare(opts);
  else if (command === 'start') { await assertNoDelegation(ROOT, opts.name, command); await start(opts); }
  else if (command === 'library-search') console.log(JSON.stringify(await searchLibrary(LIBRARY, opts.query, numeric(opts.limit, 8, 'limit')), null, 2));
  else if (command === 'library-info') console.log(JSON.stringify(await inspectBundle(itemPath(LIBRARY, opts.item)), null, 2));
  else if (command === 'ideas') await ideasCommand(opts);

  else if (command === 'frame-stats') {
    const {frameStats} = await import('../lib/pixels.mjs');
    const files = String(opts.video || '').split(',').map(v => v.trim()).filter(Boolean);
    if (!files.length) throw new Error('frame-stats needs --video <file.mp4>[,<file.mp4>...]');
    for (const f of files) { const r = await frameStats(path.resolve(f), {every: numeric(opts.every, 2, 'every')}); console.log(`${f}\n  ${r.frames} frames every ${r.every}s · ink median ${r.inkMedian}% (p90 ${r.inkP90}%) · spread median ${r.spreadMedian}% · near-blank ${r.nearBlank}%`); }
  }
  else if (command === 'library-add') {
    if (!opts.source) throw new Error('library-add requires --source bundle-directory.');
    console.log(JSON.stringify(await publishBundle(LIBRARY, path.resolve(ROOT, opts.source)), null, 2));
  }
  else if (command === 'library-use') {
    if (!opts.job) throw new Error('library-use requires an explicit --job.');
    await guardDelivered(await jobPath(opts), command, opts);
    console.log(JSON.stringify(await useBundle(LIBRARY, opts.item, await jobPath(opts)), null, 2));
  }
  else {
    const job = await jobPath(opts);
    if (ROLE_AGENT && PRODUCER_COMMANDS.has(command) && !ROLE.endsWith('-reviewer') && ROLE !== 'reviewer' && await exists(path.join(job, 'job.json')))
      await registerProducer(job, {agentId: process.env.VIDEO_AGENT_ID, role: ROLE});
    if (advances(command, opts)) await assertNoDelegation(ROOT, path.basename(job), command);
    const decision = ['human-review', 'thumbnail-choose', 'thumbnail-feedback', 'review-waive'].includes(command) ? await personDecision(job, command, opts) : null;
    await guardDelivered(job, command, opts);
    if (command === 'transcribe') {
      const manifest = await json(path.join(job,'job.json'));
      if (await exists(path.join(job,'film.json'))) throw new Error('Prepared job already exists; create a new job to change transcription.');
      if (opts.model) manifest.transcription.model = opts.model;
      if (opts.engine) manifest.transcription.engine = opts.engine;
      await save(path.join(job,'job.json'), manifest);
      await transcribe(job, manifest);
      await finishPreparation(job, manifest, await readFile(path.join(job,'inputs/narration.txt'),'utf8'));
    } else if (command === 'next') {
      const step = await nextStep(job);
      console.log(step.text);
    } else if (command === 'status') {
      const progress = await jobProgress(job);
      if (opts.json) console.log(JSON.stringify(progress));
      else {
        console.log(`STATE: ${progress.state}`);
        for (const s of progress.steps) console.log(`${{done: '✓', current: '▶', repair: '!', blocked: '✗', pending: '·'}[s.status] || '?'} ${s.label.padEnd(32)} ${s.detail}`);
        if (progress.scenes.length) console.log(`\nScenes: ${progress.scenes.filter(s => s.built).length}/${progress.scenes.length} built`);
      }
    } else if (command === 'plan-check') {
      try { await planCheck(job); console.log(nextHint(job)); }
      catch (error) { if (error instanceof SpecError) { printSpecError(error); console.error('\nFix film.json and run plan-check again.'); process.exitCode = 1; } else throw error; }
    } else if (command === 'build') {
      const result = await buildFilm(job, {scene: opts.scene || null});
      if (!result.ok) { process.exitCode = 1; console.log(opts.scene ? `\nFix the errors in shots/${opts.scene}.json and run build again.` : '\nFix the errors and run build again.'); }
      else console.log(opts.scene ? `\nScene ${opts.scene} passes the checks. Read the transcript above against the plan, then finish.` : nextHint(job));
    } else if (command === 'snapshot') await snapshot(job, {scene: opts.scene, at: opts.at});
    else if (command === 'review-template') await reviewTemplate(job, {stage: opts.stage || 'final', role: opts.role});
    else if (command === 'asset') {
      if (!opts.note?.trim()) throw new Error('asset needs --note "<what it shows>" so later films can find it in the library');
      if (/^(sfx|music)\//.test(opts.name || '') && !opts.license?.trim()) throw new Error('Audio needs --license "<the licence on its source page>" (and --source "<that page>").');
      if ((opts.name || '').startsWith('music/')) throw new Error('Bring music in with the music command (it also finds the beats): npm run video -- music --job <job> --src <url|file> --name ' + opts.name + ' --source "<page>" --license "<licence>"');
      const a = await importAsset(job, ROOT, {src: opts.src, name: opts.name, note: opts.note, title: opts.title || '', tags: opts.tags || '', allowWebImages: webImagesAllowed(), license: opts.license || '', source: opts.source || ''});
      const lib = await saveToLibrary(LIBRARY, job, {file: a.path, title: opts.title || a.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '), tags: opts.tags || '', note: opts.note, origin: opts.source || a.src, license: opts.license || ''});
      const use = a.name.startsWith('sfx/') ? `add it to a shot's "sounds": {"src": "${a.path}", "at": "<cue>", "align": "start|peak|end", "volume": 0.3, "why": "..."}`
        : `use it as {"type": "image", "src": "${a.path}", ...}${a.name.startsWith('fonts/') ? ' or in theme.fontFiles' : ''}. Look at it before using it`;
      console.log(`Saved ${a.path} (library: ${lib.item}). ${use[0].toUpperCase()}${use.slice(1)}.`);
    }
    else if (command === 'news-ingest') console.log(JSON.stringify(await ingestNews(job, opts.source, opts.file),null,2));
    else if (command === 'news-transcribe') console.log(JSON.stringify(await transcribeNews(job,opts.source,{model:Array.isArray(opts.model)?opts.model.at(-1):opts.model||'small.en',language:opts.language||'en',replace:opts.replace==='true'}),null,2));
    else if (command === 'news-check') console.log(JSON.stringify({ok:true,captions:(await newsPlan(job)).captions.length}));
    else if (command === 'save') {
      if (!opts.file || !opts.title?.trim() || !opts.tags?.trim()) throw new Error('save needs --file <job file> --title "<what it is>" --tags "<words someone would search for>"');
      const r = await saveToLibrary(LIBRARY, job, {file: opts.file, title: opts.title, tags: opts.tags, note: opts.note || '', id: opts.id});
      console.log(r.saved ? `Saved ${opts.file} to the library as ${r.item}.` : `Already in the library as ${r.item}.`);
    }
    else if (command === 'save-all') {
      const saved = await saveAll(LIBRARY, job);
      console.log(saved.length ? saved.map(s => `${s.file} → ${s.item}${s.saved ? '' : ' (already saved)'}`).join('\n') : 'Nothing new to save.');
      console.log(nextHint(job).trim());
    }
    else if (command === 'music') await musicImport(job, opts);
    else if (command === 'capture-ingest') {
      if (!opts.run) throw new Error('capture-ingest needs --run <reshoot run folder>, such as reshoot/takes/runs/<id> (docs/capture.md).');
      if (!opts.task) throw new Error('capture-ingest needs --task <id>: the feature/task id this recording evidences.');
      const runDir = path.resolve(ROOT, opts.run);
      const dir = opts.dir ? path.resolve(job, opts.dir) : path.join(job, 'capture', String(opts.task));
      const {ingestReshootRun} = await import('../lib/reshoot.mjs');
      const result = await ingestReshootRun(runDir, dir, {task: opts.task, feature: opts.feature || null, claim: opts.claim || null,
        build: opts.build || null, url: opts.url || null, notes: opts.notes || null});
      const producer = producerRecord();
      if (producer) result.manifest.producer = producer;
      await save(path.join(dir, 'manifest.json'), result.manifest);
      const failed = result.manifest.results.filter(r => r.kind === 'assert' && !r.ok);
      console.log(`Ingested ${path.relative(ROOT, result.recording)} from reshoot run ${result.manifest.source.run} — ${result.manifest.duration}s, ${result.manifest.frames ?? '?'} frames, ${result.clicks} logged action(s), ${result.manifest.frameSize.join('×')} px.`);
      console.log(`Evidence: ${path.relative(ROOT, path.join(dir, 'manifest.json'))}, actions.jsonl, shots/.`);
      console.log('The source log records clicks and result checks only: reshoot does not log typing or keypresses as separate actions.');
      if (failed.length) {
        console.log(`\n${failed.length} result check(s) did not pass in this run — keep them as evidence and write the review from what happened:`);
        for (const f of failed) console.log(`  ${f.beat || 'page'}: expected ${f.expected} — ${f.observed}`);
        process.exitCode = 1;
      } else console.log('\nNext: write capture/' + path.basename(dir) + '/edits.json (cue phrases + source ranges), then run capture-scene.');
    }
    else if (command === 'capture-scene') {
      if (!opts.capture) throw new Error('capture-scene needs --capture <capture directory> (written by capture-ingest).');
      if (!opts.scene) throw new Error('capture-scene needs --scene <id>; it is the scene in film.json this capture belongs to.');
      const captureDir = path.resolve(job, opts.capture);
      const edits = await json(path.join(captureDir, 'edits.json'));
      if (opts.scene) edits.scene = opts.scene === 'true' ? edits.scene : opts.scene;
      const manifest = await json(path.join(job, 'job.json')).catch(() => ({}));
      const frame = [manifest.width || 1920, manifest.height || 1080];
      const {compileCaptureScene} = await import('../lib/capture-scene.mjs');
      await registerCaptureProducer(captureDir);
      const result = await compileCaptureScene(job, captureDir, edits, {
        width: numeric(opts.width, frame[0], 'width'), height: numeric(opts.height, frame[1], 'height'),
        fit: Number(opts.fit ?? 0.9),
      });
      console.log(`Compiled ${path.relative(ROOT, result.file)} from capture "${result.capture.task}".`);
      for (const edit of result.report) console.log(`  ${edit.id}: ${edit.cut[0]}–${edit.cut[1]}s (${edit.duration}s), ${edit.clicks} click(s), camera ${edit.camera}`);
      for (const warning of result.warnings) console.log(`  warning: ${warning}`);
      console.log(`\nCues used: ${result.report.map(e => e.cue).join(', ')}. The scene must already exist in film.json with the same id ("${edits.scene}").`);
      console.log(`Next: npm run video -- build --job ${path.relative(ROOT, job)} --scene ${edits.scene}`);
    }
    else if (command === 'mix') await remixFilm(job, {verify});
    else if (command === 'alignment-approve') {
      if (!opts.note?.trim()) throw new Error('alignment-approve needs --note "<what differs and how it was handled>"');
      const file = path.join(job, 'alignment.json'), alignment = await json(file);
      alignment.review = {approved: true, note: opts.note}; await save(file, alignment);
      console.log(`Alignment review recorded.\nNext: npm run video -- next --job ${path.relative(ROOT, job)}`);
    }
    else if (command === 'audit') console.log(JSON.stringify(await filmAudit(job), null, 2));
    else if (command === 'verify') await verify(job);
    else if (command === 'review-pack') {
      const start = numeric(opts.start,0,'start'), end = opts.end === undefined ? undefined : numeric(opts.end,0,'end');
      const pack = await createReviewPack(job, {stage:opts.stage || 'final', start, end, from: opts.from || 'html'});
      const packPath = path.join(job,pack.packPath), packSha256 = await fileHash(packPath);
      const written = await writeReviewerBriefs(job, pack, packPath, packSha256);
      console.log(JSON.stringify({stage:pack.stage,packPath,packSha256,sourceHash:pack.sourceHash,videoSha256:pack.videoSha256,interval:pack.interval,evidenceCount:pack.evidence.length,briefs:written,
        next:`npm run video -- next --job ${path.relative(ROOT, job)}`},null,2));
    } else if (command === 'capture-visibility') {
      if (opts.generate === true || opts.generate === 'true') {
        const result=await generateCaptureInspection(job);
        await rm(path.join(job,'review/independent-verdict.json'),{force:true});
        console.log(JSON.stringify({dispositions:result.dispositions.length,file:path.relative(ROOT,path.join(job,'review/capture-visibility-dispositions.json')),
          instruction:'Delegate this file and its paired PNGs to an independent reviewer role; request one verdict per capture, then record the returned report with --record.'},null,2));
      } else if (opts.record) {
        const report=await json(path.resolve(ROOT,opts.record));
        const file=path.join(job,'review/capture-visibility-dispositions.json'), current=await json(file);
        if(report.sourceHash!==current.sourceHash||report.videoSha256!==current.videoSha256||!Array.isArray(report.dispositions)) throw new Error('Reviewer report is stale or malformed.');
        if(report.dispositions.length!==current.dispositions.length||report.dispositions.some(v=>!current.dispositions.some(d=>d.captureId===v.captureId&&d.sceneId===v.sceneId))) throw new Error('Reviewer report has missing, duplicate, or unrelated capture verdicts.');
        const reviewer=report.reviewer;
        const authenticatedReviewer={agentId:process.env.VIDEO_AGENT_ID,role:process.env.VIDEO_AGENT_ROLE};
        await assertIndependentCaptureReviewer(job,reviewer,authenticatedReviewer);
        current.dispositions=current.dispositions.map(item=>{
          const verdict=report.dispositions.find(v=>v.captureId===item.captureId&&v.sceneId===item.sceneId);
          if(!verdict||!['acceptable','reject'].includes(verdict.decision)||typeof verdict.observation!=='string'||!verdict.observation.trim()) throw new Error(`Missing independent verdict/observation for ${item.captureId}.`);
          return {...item,status:'visually-inspected',decision:verdict.decision,observation:verdict.observation.trim(),reviewer,authenticatedReviewer};
        });
        await save(file,current);
        console.log(`Recorded ${reviewer.agentId} independent visual verdict(s). ${current.dispositions.some(d=>d.decision==='reject')?'Rejected intervals remain blocked; repair and render again.':'Run review-pack --stage final --from render to continue.'}`);
      } else throw new Error('Use --generate or --record <reviewer-report.json>.');
    } else if (command === 'human-review') {
      if (opts.want !== undefined) {
        const file = path.join(job, 'job.json'), manifest = await json(file);
        manifest.humanReview = parseStages(opts.want); await save(file, manifest);
        console.log(manifest.humanReview.length ? `The pipeline will wait for your review of the ${manifest.humanReview.join(' and ')}.` : 'The pipeline will not wait for your review.');
      } else {
        const record = await recordHumanReview(job, {stage: opts.stage, decision: opts.decision, notes: (opts.note || []).map(parseNote)});
        if (decision) await logDecision(ROOT, decision.slug, {kind: record.stage, decision: record.decision, notes: record.notes, quote: decision.quote});
        console.log(`Recorded: ${record.decision} on the ${record.stage}${record.notes.length ? ` with ${record.notes.length} note(s)` : ''}.${nextHint(job)}`);
      }
    } else if (command === 'play') {
      const {startPlayer} = await import('../lib/watch.mjs');
      const {url} = await startPlayer(job, {port: opts.port || 3004});
      console.log(`Playing the built film (nothing is rendered or changed): ${url}\nStop with Ctrl+C.`);
      await new Promise(() => {});
    } else if (command === 'thumbnails') {
      if (opts.json) console.log(JSON.stringify(await thumbnailStatus(job)));
      else console.log((await thumbnailStep(job)).text);
    } else if (command === 'thumbnail-settings') {
      const file = path.join(job, 'job.json'), manifest = await json(file);
      Object.assign(manifest, thumbnailSettings({count: opts.count, pick: opts.pick})); await save(file, manifest);
      console.log(`Thumbnails: ${manifest.thumbnails ?? 'config default'} variant(s); ${manifest.pickThumbnail ? 'you pick one' : 'the reviewer\'s top-ranked is used'}.`);
    } else if (command === 'thumbnail-export') {
      if (!opts.variant) throw new Error('thumbnail-export needs --variant <id>.');
      const r = await exportThumbnail(job, opts.variant);
      console.log(`Wrote ${r.png} (${r.size?.width}×${r.size?.height}) and ${r.preview}. Open both and check the headline reads at 320×180.`);
    } else if (command === 'thumbnail-verdict') {
      if (opts.rank) { await recordRanking(job, String(opts.rank).split(',').map(v => v.trim()).filter(Boolean)); console.log('Ranking recorded.'); }
      else {
        const entry = await recordVerdict(job, {variant: opts.variant, status: opts.status, findings: opts.finding || [],
          inspected: String(opts.inspected || '').split(',').map(v => v.trim()).filter(Boolean),
          reviewer: process.env.VIDEO_AGENT_ROLE === 'thumbnail-reviewer' && process.env.VIDEO_AGENT_ID ? process.env.VIDEO_AGENT_ID : opts.reviewer});
        console.log(`Recorded ${entry.status} for ${opts.variant}.`);
      }
    } else if (command === 'thumbnail-choose') {
      if (!opts.variant) throw new Error('thumbnail-choose needs --variant <id>.');
      const r = await chooseThumbnail(job, {variant: opts.variant, by: opts.by === 'you' ? 'you' : 'reviewer'});
      if (decision) await logDecision(ROOT, decision.slug, {kind: 'thumbnail', decision: 'choose', variant: opts.variant, quote: decision.quote});
      console.log(`Thumbnail is now ${opts.variant} ("${r.headline}"), archived to library/thumbnails/${path.basename(job)}/.\nNext: npm run video -- thumbnails --job ${path.relative(ROOT, job)}`);
    } else if (command === 'thumbnail-feedback') {
      if (!opts.variant || !opts.note?.length) throw new Error('thumbnail-feedback needs --variant <id> --note "<their words>".');
      for (const note of opts.note) await addThumbnailFeedback(job, {variant: opts.variant, text: note});
      if (decision) await logDecision(ROOT, decision.slug, {kind: 'thumbnail', decision: 'revise', variant: opts.variant, notes: opts.note, quote: decision.quote});
      console.log(`Recorded feedback for ${opts.variant}.\nNext: npm run video -- thumbnails --job ${path.relative(ROOT, job)}`);
    } else if (command === 'review-submit') {
      if (!opts.file) throw new Error('review-submit requires --file from an independent reviewer.');
      const raw = await readFile(path.resolve(ROOT,opts.file),'utf8');
      let report;
      try { report = JSON.parse(raw); } catch (error) { throw new Error(`The report is not valid JSON: ${error.message}`); }
      delete report.findingExample;
      const unfilled = [];
      const scan = (value, at) => {
        if (typeof value === 'string' && value.includes('FILL-IN')) unfilled.push(at);
        else if (Array.isArray(value)) value.forEach((v, i) => scan(v, `${at}[${i}]`));
        else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) scan(v, at ? `${at}.${k}` : k);
      };
      scan(report, '');
      if (unfilled.length) throw new Error(`Replace the FILL-IN placeholder in: ${unfilled.join(', ')}. ("findingExample" is ignored.)`);
      console.log(JSON.stringify(await submitReview(job,report, {agentId: process.env.VIDEO_AGENT_ID, role: process.env.VIDEO_AGENT_ROLE}),null,2));
    } else if (command === 'review-waive') {
      // A person's decision only: no agent may waive its own reviews, the orchestrator included.
      if (ROLE) throw new Error('Only the person can waive review. Report the unresolved findings to them; they decide.');
      const waiver = await waiveReview(job, opts.stage || 'final', opts.reason);
      if (decision) await logDecision(ROOT, decision.slug, {kind: 'review-waive', stage: waiver.stage, reason: opts.reason, quote: decision.quote});
      console.log(`Waived ${waiver.stage} review of the current film after ${waiver.rounds} round(s): ${waiver.unresolvedFindings.length} unresolved blocking finding(s) will be disclosed in delivery.json.${nextHint(job)}`);
    } else if (command === 'review-status') {
      const status = await reviewStatus(job,opts.stage || 'final');
      console.log(JSON.stringify(status,null,2));
      if (!status.ok) process.exitCode = 1;
    } else if (command === 'deliver') {
      const manifest = await json(path.join(job,'job.json'));
      manifest.status = 'awaiting-review'; delete manifest.completedAt; delete manifest.delivery;
      await save(path.join(job,'job.json'),manifest);
      await filmAudit(job);
      const timing = await json(path.join(job,'timing.json'));
      if (timing.missing?.length) throw new Error(`Cannot deliver missing scenes: ${timing.missing.join(', ')}`);
      const pixels = await json(path.join(job,'review/pixels.json')).catch(() => null);
      if (!pixels?.ok) throw new Error('Pixel checks on the render have not passed; render again after repairs.');
      await writeProductionReport(job);
      await verify(job);
      const qualification = await qualifyDelivery(job);
      const listen = await json(path.join(job,'review/sound/listen.json')).catch(() => null), mixed = await json(path.join(job,'review/mix.json')).catch(() => null);
      if (mixed) qualification.soundtrack = {integratedLufs: mixed.integratedLufs, truePeakDb: mixed.truePeakDb, samplePeakDb: mixed.samplePeakDb, monoTruePeakDb: mixed.mono.truePeakDb,
        target: mixed.target, peaksOk: mixed.peaksOk, limitedBy: mixed.limitedBy, soundEffects: mixed.soundEffects, music: mixed.music ? {src: mixed.music.src} : null, measuredOn: mixed.measuredOn};
      if (listen?.listen?.length) qualification.headphoneChecks = listen.listen;
      await writeReviewFile(job,'review/delivery.json',JSON.stringify(qualification,null,2)+'\n');
      manifest.status = 'complete'; manifest.completedAt = new Date().toISOString();
      manifest.delivery = {videoSha256:qualification.videoSha256, sourceHash:qualification.sourceHash,
        packSha256:qualification.packSha256};
      await save(path.join(job,'job.json'), manifest);
      console.log(JSON.stringify({...qualification,output:path.relative(ROOT,path.join(job,'renders/video.mp4'))},null,2));
    }
    else if (command === 'check') { const r = await buildFilm(job); if (!r.ok) process.exitCode = 1; await hf(['lint'], {cwd: job}); }
    else if (command === 'preview') await hf(['preview', '--background', '--port', opts.port || '3002'], {cwd: job});
    else if (command === 'render') {
      await renderFilm(job, {hf, verify, quality: opts.quality || 'delivery', force: opts.force === 'true',
        reuseBuild: opts['reuse-build'] === 'true', workers: opts.workers});
      console.log(`\nNext: npm run video -- next --job ${path.relative(ROOT, job)}`);
    }
    else throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {console.error(`video: ${error.message}`); process.exitCode = 1;}
