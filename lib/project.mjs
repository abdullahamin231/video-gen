import {taskPrompt as renderTask} from './briefs.mjs';
// Chat production: one project per video, driven from a chat (T3 Code) instead of the web UI.
//
// A project is the whole life of one video, from the agreed brief to the delivered MP4 and thumbnail:
//   sources → script → independent script review → the person's script approval → narration → `start` →
//   the film's own `next` loop (with the person optionally watching the whole film before its one render) → thumbnails (the person picks).
// `npm run video -- next --project <slug>` prints the single next step of all of it, so a chat agent, in this chat or a
// new one after an interruption, only ever does what it prints. Every role runs as a fresh T3 delegated task; the
// person's decisions are recorded word for word, bound to the exact script or build they saw.
//
// State lives on disk, never in a conversation: jobs/scripts/<slug>/project.json (settings, open delegation),
// BRIEF.md (the agreed brief), briefs/ (the script-stage briefs), human/ (the person's decisions), and the job in jobs/<slug>/.
import {rendererAvailable} from './personalities.mjs';
import {readFile, writeFile, mkdir, stat, readdir, rename, copyFile, cp, rm, appendFile, access} from 'node:fs/promises';
import {createHash, randomBytes} from 'node:crypto';
import path from 'node:path';
import {nextStep, jobProgress} from './film.mjs';
import {thumbnailStep, thumbnailStatus} from './thumbnails.mjs';
import {findVisualPlan} from './timing.mjs';
import {DEFAULT_TTS_PROVIDER, TTS_PROVIDERS} from './tts.mjs';
import {reviewLocationStep} from './review-location.mjs';
import {parseReviewDepth} from './review.mjs';
import {inferPersonality, loadPersonality, freezePersonality, readPersonality, profileId, isAppReview} from './personalities.mjs';

export const PROJECT_FILE = 'project.json';
export const GATES = ['script', 'final', 'thumbnail'];
const SCRIPT_REVIEW_BUDGET = 3;
const EVIDENCE_ROUNDS = 2;

// Creative and review roles use the strong tier; explicit model choices take precedence.
export const ROLES = {
  'script-researcher': {tier: 'weak', agentFile: 'script-researcher', kind: 'research', label: 'script researcher'},
  'script-writer': {tier: 'strong', agentFile: 'script-writer', kind: 'general', label: 'script writer'},
  'script-reviewer': {tier: 'strong', agentFile: 'script-reviewer', kind: 'review', label: 'script reviewer'},
  director: {tier: 'strong', agentFile: 'video-director', kind: 'implementation', label: 'director'},
  builder: {tier: 'strong', agentFile: 'video-builder', kind: 'implementation', label: 'scene builder'},
  reviewer: {tier: 'strong', agentFile: 'video-reviewer', kind: 'review', label: 'film reviewer'},
  'thumbnail-maker': {tier: 'strong', agentFile: null, kind: 'design', label: 'thumbnail maker'},
  'thumbnail-reviewer': {tier: 'strong', agentFile: null, kind: 'review', label: 'thumbnail reviewer'},
};
// Agent type names printed by `next` and `thumbnails` → pipeline role.
const AGENT_TYPES = {'video-director': 'director', 'video-builder': 'builder', 'video-reviewer': 'reviewer',
  'script-researcher': 'script-researcher', 'script-writer': 'script-writer', 'script-reviewer': 'script-reviewer',
  'thumbnail-maker': 'thumbnail-maker', 'thumbnail-reviewer': 'thumbnail-reviewer'};
export const DEFAULT_CHAT_CONFIG = {
  provider: 'auto',
  profiles: {
    codex: {strong: {model: 'gpt-6.1-sol'}, weak: {model: 'gpt-6-luna'}},
    claudeAgent: {strong: {model: 'claude-opus-5-5'}, weak: {model: 'claude-haiku-5-5'}},
    opencode: {selection: 'free-auto', preferredFamilies: ['DeepSeek V4.1 Flash', 'GLM 5.3 Flash'], requireFree: true},
  },
  roles: {},
};

const exists = file => access(file).then(() => true, () => false);
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n');
const mtime = file => stat(file).then(s => s.mtimeMs, () => 0);
const text = file => readFile(file, 'utf8').catch(() => null);
const sha = value => createHash('sha256').update(value).digest('hex');
const quoteBlock = s => String(s).trim().split('\n').map(l => `> ${l}`).join('\n');
const words = s => (String(s || '').replace(/^#.*$/gm, '').match(/[\p{L}\p{N}'’-]+/gu) || []).length;
const isSlug = s => /^[a-z0-9][a-z0-9-]*$/.test(s || '');

/** App-review captures were recorded before the script; `start` copies them beside the film that cites them. */
export async function carryCaptures(script, job) {
  const from = path.join(path.dirname(script), 'capture');
  if (!await exists(from)) return false;
  await cp(from, path.join(job, 'capture'), {recursive: true});
  return true;
}

export const projectDir = (root, slug) => path.join(root, 'jobs/scripts', slug);
export const projectJob = (root, slug) => path.join(root, 'jobs', slug);
const rel = (root, file) => path.relative(root, file);

export async function loadProject(root, slug) {
  if (!isSlug(slug)) throw new Error('--project must be a lowercase project slug (see `npm run video -- projects`).');
  const file = path.join(projectDir(root, slug), PROJECT_FILE);
  try { return await json(file); }
  catch (error) { if (error.code === 'ENOENT') throw new Error(`No project "${slug}". List them with \`npm run video -- projects\`, or create one with \`project-new\`.`); throw error; }
}
// Keys starting with "_" are working values of one command (the brief text), never stored.
export const saveProject = (root, project) => save(path.join(projectDir(root, project.slug), PROJECT_FILE),
  Object.fromEntries(Object.entries(project).filter(([k]) => !k.startsWith('_'))));
/** The project a job belongs to, or null for a job made without one. */
export async function projectOfJob(root, job) {
  const slug = path.basename(job);
  return json(path.join(projectDir(root, slug), PROJECT_FILE)).catch(() => null);
}

export async function loadChatConfig(root) {
  const file = await json(path.join(root, 'chat.config.json')).catch(() => ({}));
  return {...DEFAULT_CHAT_CONFIG, ...file, profiles: {...DEFAULT_CHAT_CONFIG.profiles, ...(file.profiles || {})}, roles: {...(file.roles || {})}};
}

/** Fixed legacy/explicit targets. auto is resolved by the orchestrator against the current T3 catalog. */
export function roleTarget(config, project, role) {
  const spec = ROLES[role] || {tier: 'weak'};
  const pick = project?.models?.[role] || config.roles?.[role] || null;
  const tier = config[spec.tier] || {};
  const provider = pick?.providerInstanceId || tier.providerInstanceId || config.provider;
  const model = pick?.model || tier.model;
  if (!provider || provider === 'inherit' || provider === 'auto' || !model) return null;
  const options = pick?.options || (pick?.model ? null : tier.options) || null;
  return {providerInstanceId: provider, model, ...(options && Object.keys(options).length ? {options} : {})};
}

// ------------------------------------------------------------------ create and change a project

function gateList(value) {
  if (value === undefined) return [...GATES];
  const raw = String(value).split(',').map(s => s.trim()).filter(Boolean);
  if (raw.length === 1 && ['none', 'off'].includes(raw[0])) return [];
  const list = raw.map(s => s === 'prototype' ? 'final' : s);
  const bad = list.filter(s => !GATES.includes(s));
  if (bad.length) throw new Error(`--review takes ${GATES.join(', ')} (comma-separated) or none; not ${bad.join(', ')}.`);
  return [...new Set(list)];
}
function parseModel(value) { // "builder=codex:gpt-6-luna" or "builder=inherit" or "builder=default"
  const m = /^([a-z-]+)=(?:([A-Za-z0-9_-]+):)?(.+)$/.exec(String(value).trim());
  if (!m || !ROLES[m[1]]) throw new Error(`--model is role=provider:model with role one of ${Object.keys(ROLES).join(', ')} (or role=default).`);
  return {role: m[1], choice: m[3] === 'default' ? null : m[3] === 'inherit' ? {providerInstanceId: 'inherit'} : {...(m[2] ? {providerInstanceId: m[2]} : {}), model: m[3]}};
}

export async function createProject(root, opts, {resolveInput = async f => path.resolve(root, f), setIdeaStatus} = {}) {
  const slug = opts.name;
  if (!isSlug(slug)) throw new Error('project-new needs --name <lowercase-slug> (letters, digits, dashes).');
  const dir = projectDir(root, slug);
  if (await exists(path.join(dir, PROJECT_FILE))) throw new Error(`Project "${slug}" exists. Continue it with \`npm run video -- next --project ${slug}\`.`);
  if (await exists(projectJob(root, slug))) throw new Error(`jobs/${slug} already exists. Choose another --name.`);
  const format = opts.format ?? null;
  if (format && !['landscape', 'vertical', 'square'].includes(format)) throw new Error('--format is landscape, vertical or square.');
  const duration = opts.duration === undefined ? null : Number(opts.duration);
  if (duration !== null && !(duration > 0)) throw new Error('--duration is the target length in seconds.');
  const tts = opts.tts || DEFAULT_TTS_PROVIDER;
  if (!TTS_PROVIDERS.includes(tts)) throw new Error('--tts is ming.');
  const thumbnails = opts.thumbnails === undefined ? null : Number(opts.thumbnails);
  if (thumbnails !== null && !(Number.isInteger(thumbnails) && thumbnails >= 1 && thumbnails <= 6)) throw new Error('--thumbnails is 1 to 6.');
  const reviewDepth = parseReviewDepth(opts['review-depth']);
  const audio = opts.audio ? rel(root, await resolveInput(opts.audio, 'Audio')) : null;
  const script = opts.script ? await resolveInput(opts.script, 'Script') : null;
  const music = opts.music ? rel(root, await resolveInput(opts.music, 'Music')) : null;
  if (audio && !script) throw new Error('A supplied recording needs its script too: add --script <file>.');
  await mkdir(dir, {recursive: true});
  const briefFile = path.join(dir, 'BRIEF.md');
  if (opts.brief) await writeFile(briefFile, String(opts.brief).trim() + '\n');
  else if (opts['brief-file']) await copyFile(path.resolve(root, opts['brief-file']), briefFile);
  const brief = await text(briefFile);
  if (!brief?.trim() && !script) throw new Error(`Write the agreed brief to jobs/scripts/${slug}/BRIEF.md first (or pass --brief-file), then run project-new again.`);
  const selection = inferPersonality(brief || await text(script), opts.profile);
  if (!selection.id) throw new Error(`${selection.reason} Ask one routing question before creating this project.`);
  const productionProfile = await freezePersonality(dir, loadPersonality(selection.id));
  if (script) { // the person's own script: kept as written, and its visual plan if one sits beside it
    if (path.resolve(script) !== path.join(dir, 'SCRIPT.md')) await copyFile(script, path.join(dir, 'SCRIPT.md'));
    const visuals = await findVisualPlan(script);
    if (visuals && path.resolve(visuals) !== path.join(dir, 'VISUALS.md')) await copyFile(visuals, path.join(dir, 'VISUALS.md'));
  }
  const project = {version: 1, slug, createdAt: new Date().toISOString(), thread: opts.thread || null,
    format, duration, tts, audio, inputScript: script ? rel(root, script) : null, music,
    productionProfile, review: gateList(opts.review), reviewDepth, thumbnails, models: {}, evidenceRounds: 0, delegation: null, history: []};
  if (opts.idea) { project.idea = opts.idea; if (setIdeaStatus) await setIdeaStatus(root, opts.idea, 'used').catch(() => {}); }
  await saveProject(root, project);
  return project;
}

export async function updateProject(root, slug, opts, {setHumanStages} = {}) {
  const project = await loadProject(root, slug), changes = [];
  if (opts.profile !== undefined) {
    const selected = profileId(opts.profile);
    if (selected !== (project.productionProfile?.id || 'explainer')) throw new Error('Personality is frozen for this project. Create a new project to change it.');
    changes.push(`personality unchanged: ${selected}`);
  }
  if (opts.review !== undefined) { project.review = gateList(opts.review); changes.push(`checkpoints: ${project.review.join(', ') || 'none'}`); }
  if (opts['review-depth'] !== undefined) {
    project.reviewDepth = parseReviewDepth(opts['review-depth']);
    changes.push(`review depth: ${project.reviewDepth}`);
  }
  if (opts.thumbnails !== undefined) {
    const n = Number(opts.thumbnails);
    if (!(Number.isInteger(n) && n >= 1 && n <= 6)) throw new Error('--thumbnails is 1 to 6.');
    project.thumbnails = n; changes.push(`${n} thumbnail variant(s)`);
  }
  if (opts.tts !== undefined) {
    if (!TTS_PROVIDERS.includes(opts.tts)) throw new Error('--tts is ming.');
    project.tts = opts.tts; changes.push(`narration: ${opts.tts}`);
  }
  for (const value of [].concat(opts.model || [])) {
    const {role, choice} = parseModel(value);
    project.models ||= {};
    if (choice) project.models[role] = choice; else delete project.models[role];
    changes.push(`${role}: ${choice ? `${choice.providerInstanceId || 'default provider'}${choice.model ? `/${choice.model}` : ''}` : 'default model'}`);
  }
  if (!changes.length) throw new Error('Nothing to change: pass --review, --review-depth, --thumbnails, --tts or --model role=provider:model.');
  await saveProject(root, project);
  // A job that already exists follows the project's film and thumbnail checkpoints.
  const job = projectJob(root, slug);
  if (await exists(path.join(job, 'job.json'))) {
    if (setHumanStages) await setHumanStages(job, project.review.map(g => g === 'prototype' ? 'final' : g).filter(g => g === 'final'));
    const file = path.join(job, 'job.json'), manifest = await json(file);
    manifest.pickThumbnail = project.review.includes('thumbnail');
    if (project.thumbnails) manifest.thumbnails = project.thumbnails;
    await save(file, manifest);
  }
  return {project, changes};
}

export async function listProjects(root) {
  const base = path.join(root, 'jobs/scripts');
  const out = [];
  for (const slug of await readdir(base).catch(() => [])) {
    const project = await json(path.join(base, slug, PROJECT_FILE)).catch(() => null);
    if (!project) continue;
    const facts = await inspect(root, project).catch(error => ({phase: `unreadable: ${error.message}`}));
    out.push({slug, createdAt: project.createdAt, phase: facts.phase, delegation: project.delegation?.open ? project.delegation.tasks.map(t => t.title) : null});
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function deleteProject(root, slug, confirm) {
  const project = await loadProject(root, slug);
  if (confirm !== slug) throw new Error(`Deleting removes jobs/${slug}/, jobs/scripts/${slug}/ and library/thumbnails/${slug}/. Run again with --confirm ${slug}.`);
  if (project.delegation?.open) throw new Error('Delegated work is still open on this project. Cancel those tasks (task_cancel), run `delegated`, then delete.');
  for (const dir of [projectJob(root, slug), projectDir(root, slug), path.join(root, 'library/thumbnails', slug)]) await rm(dir, {recursive: true, force: true});
  const latest = await json(path.join(root, '.video/latest.json')).catch(() => null);
  if (latest && path.basename(latest.job) === slug) await rm(path.join(root, '.video/latest.json'), {force: true});
  return [`jobs/${slug}/`, `jobs/scripts/${slug}/`, `library/thumbnails/${slug}/`];
}

// ------------------------------------------------------------------ the person's decisions

export async function logDecision(root, slug, record) {
  const dir = path.join(projectDir(root, slug), 'human');
  await mkdir(dir, {recursive: true});
  await appendFile(path.join(dir, 'decisions.jsonl'), JSON.stringify({at: new Date().toISOString(), ...record}) + '\n');
}
/** Every decision a chat records carries the person's own message, so the record shows what they actually said. */
export function requireQuote(opts) {
  const quote = String(opts.quote || '').trim();
  if (!quote) throw new Error('Add --quote "<the person\'s message, word for word>": a decision is only recorded with what they actually said. Never decide for them.');
  return quote;
}

async function scriptHash(dir) {
  const profile = await text(path.join(dir, 'production-profile.json'));
  return sha(`${await text(path.join(dir, 'SCRIPT.md')) ?? ''}\0${await text(path.join(dir, 'VISUALS.md')) ?? ''}${profile ? `\0${profile}` : ''}`);
}

export async function recordScriptReview(root, slug, {decision, notes = [], quote}) {
  const project = await loadProject(root, slug), dir = projectDir(root, slug);
  if (!['approve', 'revise'].includes(decision)) throw new Error('--decision is approve or revise.');
  if (!await exists(path.join(dir, 'SCRIPT.md'))) throw new Error('There is no script to review yet.');
  if (await exists(path.join(projectJob(root, slug), 'job.json'))) throw new Error('The film is already being made from this script; changes to it now need a new project.');
  const clean = notes.map(n => String(n).trim()).filter(Boolean);
  if (decision === 'revise' && !clean.length) throw new Error('Say what should change: give at least one --note with their words.');
  const record = {version: 1, decision, notes: clean, quote, scriptSha256: await scriptHash(dir), decidedAt: new Date().toISOString()};
  await mkdir(path.join(dir, 'human'), {recursive: true});
  await save(path.join(dir, 'human/script.json'), record);
  await logDecision(root, slug, {kind: 'script', decision, notes: clean, quote});
  void project;
  return record;
}

// ------------------------------------------------------------------ what state is the project in (read-only)

async function newestIn(dir) {
  let newest = 0;
  for (const name of await readdir(dir).catch(() => [])) newest = Math.max(newest, await mtime(path.join(dir, name)));
  return newest;
}

/** Facts about a project, read from its files. Writes nothing. */
export async function inspect(root, project) {
  const dir = projectDir(root, project.slug), job = projectJob(root, project.slug);
  const f = name => path.join(dir, name);
  const facts = {dir, job, hasJob: await exists(path.join(job, 'job.json'))};
  if (facts.hasJob) {
    if (project.productionProfile && readPersonality(facts.job).sha256 !== readPersonality(dir).sha256)
      throw new Error('Film job personality differs from its script project. Restore the matching frozen snapshot.');
    const manifest = await json(path.join(job, 'job.json'));
    facts.manifest = manifest;
    facts.phase = manifest.status === 'complete' ? 'film delivered' : `film: ${manifest.status}`;
    return facts;
  }
  const [sources, research, script, visuals, review] = await Promise.all(['SOURCES.md', 'research.md', 'SCRIPT.md', 'VISUALS.md', 'review.md'].map(n => text(f(n))));
  Object.assign(facts, {sources, research, script, visuals, review});
  const t = Object.fromEntries(await Promise.all(['SOURCES.md', 'research.md', 'SCRIPT.md', 'VISUALS.md', 'review.md', 'narration.wav'].map(async n => [n, await mtime(f(n))])));
  t.sourcesDir = await newestIn(f('sources'));
  facts.times = t;
  facts.reviewRounds = (await readdir(f('review-history')).catch(() => [])).filter(n => n.endsWith('.md')).length;
  facts.reviewStale = review != null && t['review.md'] < Math.max(t['SCRIPT.md'], t['VISUALS.md'], t['SOURCES.md'], t['research.md'], t.sourcesDir);
  facts.disposition = review != null ? scriptDisposition(review) : '';
  facts.scriptSha256 = script != null ? await scriptHash(dir) : null;
  const human = await json(f('human/script.json')).catch(() => null);
  facts.human = human && human.scriptSha256 === facts.scriptSha256 ? human : null;
  facts.narrated = Boolean(project.audio) || (t['narration.wav'] > 0 && t['narration.wav'] >= t['SCRIPT.md']);
  facts.evidenceRequested = !script && research != null && /^#{1,3}\s*evidence requests/im.test(research) && t['research.md'] > Math.max(t['SOURCES.md'], t.sourcesDir);
  // App reviews are scripted from a real session, so the recording comes before the writing. A capture task counts
  // once its manifest exists: the manifest is what names the build, the viewport and the hashes of the evidence.
  let workflow = null;
  try { workflow = readPersonality(dir).profile.workflow; } catch {}
  facts.capture = [];
  for (const entry of await readdir(f('capture'), {withFileTypes: true}).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    if (await exists(path.join(dir, 'capture', entry.name, 'manifest.json'))) facts.capture.push(entry.name);
  }
  facts.phase = isAppReview(workflow) && !facts.capture.length ? 'recording the session'
    : project.inputScript && script != null ? (facts.narrated ? 'ready to start the film' : 'narration')
    : sources == null ? 'gathering sources'
    : facts.evidenceRequested ? 'writer asked for more evidence'
    : script == null ? 'writing the script'
    : review == null || facts.reviewStale ? 'independent script review'
    : facts.human?.decision === 'approve' || (facts.disposition === 'pass' && !project.review.includes('script')) ? (facts.narrated ? 'ready to start the film' : 'narration')
    : facts.human?.decision === 'revise' ? 'revising the script (your notes)'
    : facts.disposition === 'pass' ? 'waiting for your script approval'
    : `script review: ${facts.disposition || 'no verdict'}`;
  return facts;
}

// The reviewer's final verdict in review.md (the same reading the web UI used).
export function scriptDisposition(value) {
  const clean = String(value || '').replace(/[*_`]+/g, '');
  const labelled = /^[ \t]*(?:#{1,6}[ \t]*)?(?:final[ \t]+)?(?:disposition|verdict|status|outcome)[ \t]*:[ \t]*(pass|revise|incomplete)\b.*$/gim;
  const bare = /^[ \t]*(?:#{1,6}[ \t]*)?(pass|revise|incomplete)\b(?:[ \t]*$|\.[ \t]*(?:$|.+$)|[ \t]*[—:–-][ \t]+.*$)/gim;
  const verdicts = [...clean.matchAll(labelled), ...clean.matchAll(bare)].sort((a, b) => a.index - b.index);
  return verdicts.at(-1)?.[1].toLowerCase() || '';
}

// ------------------------------------------------------------------ briefs for the script stage

const lengthLine = p => p.duration ? `Target length: ${p.duration} seconds (requested by the person).`
  : 'No length was requested: choose one that fits the material, as the skill describes, and record why in research.md.';
const formatLine = p => `Format: ${p.format || 'the default in video.config.json'}${p.format === 'vertical' ? ' (a short: one idea, one payoff)' : ''}.`;

function scriptTask(p, folder) {
  return {folder, brief: `${folder}/BRIEF.md`, profile: `${folder}/production-profile.json`, contract: 'skills/script-writing/SKILL.md', outputs: ['SCRIPT.md', 'research.md', 'VISUALS.md'],
    requestedSeconds: p.duration || null, format: p.format || null};
}
function researchBrief(p, folder, followUp) {
  return renderTask('research', {...scriptTask(p, folder), outputs: ['sources/', 'SOURCES.md'], reference: 'skills/script-writing/references/sourcing.md', evidenceRequests: followUp ? `${folder}/${followUp === 'writer' ? 'research.md' : 'review.md'}` : null});
}
function writerBrief(p, folder, {evidenceDone, capture = []}) {
  return renderTask('write-script', {...scriptTask(p, folder), evidenceRoundAvailable: !evidenceDone,
    captures: capture.map(id => ({manifest: `${folder}/capture/${id}/manifest.json`, actions: `${folder}/capture/${id}/actions.jsonl`, shots: `${folder}/capture/${id}/shots/`}))});
}
function revisionBrief(p, folder, {review, human}) {
  return renderTask('write-script', {...scriptTask(p, folder), revision: true,
    review: review ? `${folder}/review.md` : null, userNotes: human?.notes || []});
}
function reviewerBrief(p, folder, rounds) {
  return renderTask('review-script', {...scriptTask(p, folder), outputs: ['review.md'], reference: 'skills/script-writing/references/review.md', round: rounds + 1});
}

// ------------------------------------------------------------------ next --project: the whole life of the video

const nextCmd = slug => `npm run video -- next --project ${slug}`;

function taskPrompt(role, brief, agentId) {
  const spec = ROLES[role];
  return [`You are the ${spec.label} on a video-gen production (sub-agent started by the orchestrator through T3).`,
    spec.agentFile ? `First read .claude/agents/${spec.agentFile}.md (your role), then read ${brief} and follow it exactly.` : `Read ${brief} and follow it exactly.`,
    `Rules: do only what that brief asks, yourself. Never delegate or start sub-agents (no delegate_task, t3_thread_launch, Task or spawn tools). Never run \`npm run video -- next\`, \`render\`, \`review-pack\`, \`deliver\`, \`save-all\`, \`start\`, \`watch\` or \`delegated\`, and never record a person's decision.`,
    `Run every pipeline command as \`VIDEO_AGENT_ROLE=${role} VIDEO_AGENT_ID=${agentId} npm run video -- ...\`. Where a record asks for your agent id, use "${agentId}".`,
    `Trim long command output (| tail -40). Reply in under 150 words: what you did, the files you wrote, and your verdict or blockers.`].join('\n');
}

async function delegateStep(root, project, state, tasks, config) {
  const opened = new Date().toISOString();
  const entries = [];
  for (const {role, brief} of tasks) {
    const briefRel = rel(root, brief);
    const agentId = `t3-${role}-${randomBytes(3).toString('hex')}`;
    const target = roleTarget(config, project, role);
    const briefText = await text(brief) ?? '';
    const name = path.basename(brief, '.md');
    const selection = !target && config.provider === 'auto' ? {
      tier: ROLES[role].tier, profiles: config.profiles || DEFAULT_CHAT_CONFIG.profiles,
      override: project?.models?.[role] || config.roles?.[role] || null,
      ...(config[ROLES[role].tier] ? {tierOverride: config[ROLES[role].tier]} : {}),
    } : null;
    entries.push({role, selection, brief: briefRel, agentId, title: `${ROLES[role].label}: ${name}`,
      args: {title: `${project.slug} · ${ROLES[role].label} · ${name}`, role: ROLES[role].kind,
        clientRequestId: `${project.slug}-${name}-${sha(briefRel + briefText + opened).slice(0, 10)}`, mode: 'async',
        ...(target ? {target} : {}), task: taskPrompt(role, briefRel, agentId)}});
  }
  project.delegation = {open: true, openedAt: opened, state, tasks: entries.map(({args, ...rest}) => ({...rest, clientRequestId: args.clientRequestId}))};
  await saveProject(root, project);
  const n = entries.length;
  return [`STATE: ${state}`,
    `DO: start ${n > 1 ? `these ${n} tasks (they run in parallel)` : 'this task'} with the T3 \`delegate_task\` tool. Pass each JSON object below as the tool's arguments; resolve only target as directed by its MODEL SELECTION policy. Keep task, role, mode and clientRequestId unchanged.`,
    ...(entries.some(e => e.selection) ? [
      `MODEL SELECTION: call orchestrator_capabilities. For each policy, find inheritedProviderInstanceId in providers and select its profile by instance ID, then driverKind. Remain on that actual provider instance unless an explicit override chooses another; then use the chosen instance’s profile. A model-only override stays on the current instance. Resolve project/role override first, tierOverride next, then the profile's strong/weak model. A providerInstanceId of inherit means the current chat provider and model. Validate the selected provider canRunChildTask and model exists; never invent model IDs. If no profile applies, inherit the chat model. Missing or disabled requested models/providers are blockers; do not substitute silently.`,
      `OpenCode free-auto: choose an available free model appropriate for the task. Prefer a listed preferredFamily only when its exact model ID is available and free status is established. Otherwise choose a model explicitly labeled Free/:free/-free or verified zero-priced. Flash alone does not mean free. If none is available, stop and report it; never switch to paid automatically. On quota/unavailability, try another verified available free model and disclose the switch.`,
      `Set target.providerInstanceId and target.model to the resolved values before delegate_task. Preserve explicit options. Inherit model options only when BOTH provider instance and model match the parent; validate option descriptors. Pass options in target.options, not in task text. Check the returned provider/model/options match.`,
    ] : []),
    ...entries.flatMap(e => [...(e.selection ? [`MODEL SELECTION (${e.role}): ${JSON.stringify(e.selection)}`] : []), `  ${JSON.stringify(e.args)}`]),
    `    Do not do their work yourself, do not edit their files, and do not pass them your own opinions. Reviewers are always new tasks.`,
    `WAIT: end your turn; each finished task wakes you. If others are still running (task_status), end your turn again.`,
    `THEN: when ${n > 1 ? 'all have' : 'it has'} finished, run \`npm run video -- delegated --project ${project.slug}\`. It closes this batch and prints the next step; do not run \`next\` separately.`].join('\n');
}

function leaseText(project) {
  const d = project.delegation;
  return [`STATE: waiting for delegated work (${d.state}; started ${d.openedAt})`,
    ...d.tasks.map(t => `  · ${t.title} (${t.brief}; clientRequestId ${t.clientRequestId})`),
    `If you are one of those sub-agents: this command is not yours. Finish your brief and reply.`,
    `DO (orchestrator): wait until every task has finished (task_status). When they have, or if they were lost (a restart, a new chat that did not start them),`,
    `    run \`npm run video -- delegated --project ${project.slug}\`: it closes the batch and prints the next step. Anything unfinished is issued again.`].join('\n');
}

export async function closeDelegation(root, slug) {
  const project = await loadProject(root, slug);
  if (!project.delegation?.open) return {project, closed: null};
  const closed = {...project.delegation, open: false, closedAt: new Date().toISOString()};
  project.history = [...(project.history || []), {state: closed.state, openedAt: closed.openedAt, closedAt: closed.closedAt, tasks: closed.tasks.map(t => t.title)}].slice(-200);
  project.delegation = null;
  await saveProject(root, project);
  return {project, closed};
}

/** A command that advances the pipeline refuses while delegated work is open on its project. */
export async function assertNoDelegation(root, slug, command) {
  if (!slug) return;
  const project = await json(path.join(projectDir(root, slug), PROJECT_FILE)).catch(() => null);
  if (!project?.delegation?.open) return;
  throw new Error(`\`${command}\` advances the pipeline, and delegated work is open on "${slug}" (${project.delegation.state}). ` +
    `If you are a sub-agent, finish your brief and reply. If you are the orchestrator: wait for the tasks to finish, then run \`npm run video -- delegated --project ${slug}\` and \`${nextCmd(slug)}\`.`);
}

function speedFor(p, script, research) {
  let minutes = p.duration ? p.duration / 60 : null;
  if (!minutes && research) {
    const m = /target[^\n]{0,80}?(\d+(?:\.\d+)?)\s*(minutes?|min\b|seconds?|s\b)/i.exec(research);
    if (m) minutes = /^s/i.test(m[2]) ? Number(m[1]) / 60 : Number(m[1]);
  }
  if (!minutes) return 1.1;
  const speed = words(script) / minutes / 170;
  return Math.min(1.25, Math.max(0.9, Math.round(speed * 20) / 20));
}

function scriptGateText(p, S, facts, reason) {
  const w = words(facts.script), minutes = (w / 170 / 1.1).toFixed(1);
  const title = /^#\s+(.+)$/m.exec(facts.script || '')?.[1] || p.slug;
  return [`STATE: your review of the script (${reason})`,
    `Script: "${title}", ${w} words, about ${minutes} min spoken. Reviewer: ${facts.disposition || 'no verdict'}${facts.reviewRounds ? ` after ${facts.reviewRounds + 1} rounds` : ''}.`,
    `DO: 1. ${reviewLocationStep(p.slug)}`,
    `    2. Tell the user in two or three lines that the script is ready to read on the Tailscale review page (title, length, the reviewer's verdict${reason.includes('budget') ? ' and that review did not pass' : ''}), and ask them to approve it or say what to change.`,
    `    3. End your turn and wait for their reply. Never decide for them.`,
    `    4. Record the reply word for word, then run next:`,
    `       \`npm run video -- script-review --project ${p.slug} --decision approve --quote "<their message>"\``,
    `       \`npm run video -- script-review --project ${p.slug} --decision revise --note "<their words>" [--note ...] --quote "<their message>"\``,
    `       If the reply neither clearly approves nor asks for changes, ask them; record nothing.`,
    `THEN: ${nextCmd(p.slug)}`].join('\n');
}

function filmGateText(p, J, stage, original) {
  const what = 'the whole film, before its one render';
  return [`STATE: your review of the ${stage} (the independent reviews passed; the person decides next)`,
    `DO: 1. ${reviewLocationStep(p.slug)}`,
    `    2. Tell the user ${what} is ready on the Tailscale review page (Watch the current build): they can play it with sound, jump between scenes, pause and quote the time shown ("12.5: make the chart bigger"). Ask them to approve it or say what to change at which moment.`,
    `    3. End your turn and wait for their reply. Never decide for them.`,
    `    4. Record the reply, each note as "<seconds>: <their words>" (their words unchanged), then run next:`,
    `       \`npm run video -- human-review --job ${J} --stage ${stage} --decision approve --quote "<their message>"\``,
    `       \`npm run video -- human-review --job ${J} --stage ${stage} --decision revise --note "12.5: <their words>" [--note ...] --quote "<their message>"\``,
    `       A note without a time is about the whole stretch. If the reply is unclear, ask; record nothing.`,
    `THEN: ${nextCmd(p.slug)}`].join('\n');
  void original;
}

function thumbnailGateText(p, J, original) {
  const line = original.split('\n')[0].replace(/^STATE: the person picks the thumbnail/, 'STATE: you pick the thumbnail');
  return [line,
    `DO: 1. ${reviewLocationStep(p.slug)}`,
    `    2. Ask the user to pick one, or to say what to change in any one (only that variant is made again).`,
    `    3. End your turn and wait for their reply. Never pick for them.`,
    `    4. Record the reply word for word, then run next:`,
    `       \`npm run video -- thumbnail-choose --job ${J} --variant <id> --by you --quote "<their message>"\``,
    `       \`npm run video -- thumbnail-feedback --job ${J} --variant <id> --note "<their words>" --quote "<their message>"\``,
    `THEN: ${nextCmd(p.slug)}`].join('\n');
}

async function deliveredText(root, p, J, thumbText) {
  const d = await json(path.join(root, J, 'review/delivery.json')).catch(() => ({}));
  const s = d.soundtrack;
  const unresolved = (d.unresolvedFindings || []).map(f => `${(f.sceneIds || []).join(', ') || 'film'}: ${f.subject || f.observed || f.id}`);
  return [`STATE: done: the film and its thumbnail are delivered`,
    `Film: ${J}/renders/video.mp4`, thumbText.split('\n').find(l => l.startsWith('The thumbnail')) || `Thumbnail: ${J}/thumbnail/thumbnail.png`,
    `Review: ${d.reviewDisposition || 'unknown'}${unresolved.length ? `; ${unresolved.length} unresolved finding(s), disclosed in delivery.json: ${unresolved.slice(0, 5).join('; ')}` : ''}.`,
    ...(d.limitations?.length ? [`Limitations: ${d.limitations.slice(0, 4).join('; ')}`] : []),
    ...(d.advisoryFindings?.length ? [`Advisory findings: ${d.advisoryFindings.length}`] : []),
    ...(s ? [`Soundtrack (measured on the MP4): ${s.integratedLufs} LUFS integrated, true peak ${s.truePeakDb} dBTP${s.peaksOk === false ? ' (peaks NOT ok)' : ''}.`] : []),
    ...(d.headphoneChecks?.length ? ['Headphone checks (what to listen for):', ...d.headphoneChecks.map(h => `  ${typeof h === 'string' ? h : `${h.t ?? h.at ?? h.time ?? '?'}s: ${h.check ?? h.listen ?? JSON.stringify(h)}${h.because ? ` (${h.because})` : ''}`}`)] : []),
    `DO: give the user the paths and this note. Nobody in this pipeline can hear: never say it sounds good, only what was measured. Never describe a waived or budget-exhausted review as passed.`,
    `    ${reviewLocationStep(p.slug)} The overview plays the MP4 and shows the thumbnail. When they are done, stop it: \`npm run video -- watch --project ${p.slug} --stop true\`.`].join('\n');
}

// Turn the film's harness-neutral steps into chat steps: T3 tasks for spawns, the Tailscale page for the person's reviews.
export async function adaptStep(root, project, step, config) {
  const slug = project.slug, J = `jobs/${slug}`;
  let body = step.text.replaceAll(`npm run video -- next --job ${J}`, nextCmd(slug)).replaceAll(`npm run video -- thumbnails --job ${J}`, nextCmd(slug));
  const human = /^STATE: human review of the (prototype|final)/.exec(body);
  if (human) return filmGateText(project, J, 'final', body);
  if (step.state === 'choose thumbnail') return thumbnailGateText(project, J, body);
  const spawns = [...body.matchAll(/^\s+([a-z-]+): "Read (.+?) and follow it exactly\."$/gm)];
  if (!spawns.length) return body;
  const tasks = spawns.map(m => ({role: AGENT_TYPES[m[1]] || m[1], brief: path.resolve(root, m[2])}));
  for (const t of tasks) if (!ROLES[t.role]) throw new Error(`Unknown role "${t.role}" in a pipeline step; update lib/project.mjs.`);
  const state = body.split('\n')[0].replace(/^STATE:\s*/, '');
  const extra = body.split('\n').filter(l => /^\s+(Reviewers must|The reviewer must)/.test(l));
  return (await delegateStep(root, project, state, tasks, config)) + (extra.length ? `\n${extra.join('\n')}` : '');
}

async function writeBrief(dir, name, body) {
  await mkdir(path.join(dir, 'briefs'), {recursive: true});
  const file = path.join(dir, 'briefs', name);
  await writeFile(file, body);
  return file;
}

/** App reviews cannot be written before the session exists: the film is the evidence, not an illustration of a guess. */
function captureGateText(p, S) {
  return [`STATE: record the authorised session before anything is written`,
    `Nothing about this app has been observed yet, so there is no review to script. Plan the task, record it, and let the script describe what actually happened — including any step that failed.`,
    ``,
    `DO: write ${S}/reshoot/reshoot.toml and ${S}/reshoot/storyboard.toml — one useful task, beats with a caption and result checks that only the intended state can pass, in headless Chrome (see docs/reshoot.md)`,
    `DO: run \`reshoot run ${S}/reshoot/reshoot.toml\`, then watch the run and \`reshoot accept ${S}/reshoot/takes/runs/<id>\` when it is right`,
    `DO: ingest the accepted run with \`npm run video -- capture-ingest --job ${S} --run ${S}/reshoot/takes/runs/<id> --task <task>\``,
    `    It copies the clean take and writes recording.mp4, actions.jsonl, shots/ and manifest.json. The cursor is composited into that footage; the log carries clicks and result checks only.`,
    `THEN: ${nextCmd(p.slug)}`,
    ``,
    `If the task needs a native window, an OS dialog or a system permission, a browser recording cannot show it. Report that boundary and record the part that can be shown honestly. Never write SCRIPT.md or a verdict first and film it afterwards, and never record a commercial product's interface.`].join('\n');
}

/** The single next step of the whole video. May write briefs and open a delegation. */
export async function projectStep(root, slug) {
  const project = await loadProject(root, slug), config = await loadChatConfig(root);
  const personality = readPersonality(projectDir(root, slug));
  if (project.delegation?.open) return {state: 'delegated', text: leaseText(project)};
  const facts = await inspect(root, project), S = rel(root, facts.dir), J = `jobs/${slug}`;
  project._brief = await text(path.join(facts.dir, 'BRIEF.md')) || '(no brief: the person supplied the script)';
  const delegate = async (state, role, name, body) => ({state, text: await delegateStep(root, project, state, [{role, brief: await writeBrief(facts.dir, name, body)}], config)});
  const persist = () => saveProject(root, project);

  if (facts.hasJob) {
    const step = await nextStep(facts.job);
    if (step.state !== 'done') return {state: step.state, text: await adaptStep(root, project, step, config)};
    const thumbs = await thumbnailStep(facts.job);
    if (thumbs.state !== 'done') return {state: thumbs.state, text: await adaptStep(root, project, thumbs, config)};
    return {state: 'done', text: await deliveredText(root, project, J, thumbs.text)};
  }

  // ---- the script (skipped for a script the person supplied)
  if (isAppReview(personality.profile.workflow) && !facts.capture.length)
    return {state: 'record the session', text: captureGateText(project, S)};
  if (!project.inputScript) {
    if (facts.sources == null) return delegate('gather the sources', 'script-researcher', 'research.md', researchBrief(project, S));
    if (facts.evidenceRequested && project.evidenceRounds < EVIDENCE_ROUNDS) {
      project.evidenceRounds += 1; await persist();
      return delegate('the writer asked for more evidence', 'script-researcher', `research-followup-${project.evidenceRounds}.md`, researchBrief(project, S, 'writer'));
    }
    if (facts.script == null)
      return delegate('write the script and its visual plan', 'script-writer', 'write.md', writerBrief(project, S, {evidenceDone: project.evidenceRounds >= 1 || facts.evidenceRequested, capture: facts.capture}));
    if (facts.review == null || facts.reviewStale) {
      if (facts.review != null) { // keep each earlier review for the next reviewer
        await mkdir(path.join(facts.dir, 'review-history'), {recursive: true});
        await rename(path.join(facts.dir, 'review.md'), path.join(facts.dir, 'review-history', `round-${facts.reviewRounds + 1}.md`));
        facts.reviewRounds += 1;
      }
      return delegate(`independent script review${facts.reviewRounds ? ` (round ${facts.reviewRounds + 1})` : ''}`, 'script-reviewer', `review-${facts.reviewRounds + 1}.md`, reviewerBrief(project, S, facts.reviewRounds));
    }
    const approved = facts.human?.decision === 'approve' || (facts.disposition === 'pass' && !project.review.includes('script'));
    if (!approved) {
      if (facts.human?.decision === 'revise')
        return delegate('revise the script with your notes', 'script-writer', `revise-${facts.reviewRounds + 1}-you.md`, revisionBrief(project, S, {human: facts.human, review: facts.disposition !== 'pass'}));
      if (facts.disposition === 'pass') return {state: 'script approval', text: scriptGateText(project, S, facts, 'the independent review passed')};
      if (facts.reviewRounds + 1 >= SCRIPT_REVIEW_BUDGET)
        return {state: 'script approval', text: scriptGateText(project, S, facts, `review budget used: ${facts.reviewRounds + 1} rounds without a pass; the person decides whether to approve it as it is or give direction`)};
      if (facts.disposition === 'incomplete' && project.evidenceRounds < EVIDENCE_ROUNDS) {
        project.evidenceRounds += 1; await persist();
        return delegate('the reviewer needs more evidence', 'script-researcher', `research-followup-${project.evidenceRounds}.md`, researchBrief(project, S, 'reviewer'));
      }
      return delegate(`revise the script (review: ${facts.disposition || 'no verdict'})`, 'script-writer', `revise-${facts.reviewRounds + 1}.md`, revisionBrief(project, S, {review: true}));
    }
  } else if (facts.script == null) throw new Error(`${S}/SCRIPT.md is missing: the supplied script was not copied. Create the project again.`);

  // ---- narration, then the job
  if (!rendererAvailable(personality)) return {state: 'blocked', text: `STATE: blocked\nPersonality ${personality.profile.id}: ${personality.profile.blocker}\nFollow personalities/${personality.profile.id}/PROFILE.md. Do not substitute an animated explainer.`};
  if (!facts.narrated) {
    const speed = speedFor(project, facts.script, facts.research);
    return {state: 'narration', text: [`STATE: generate the narration (${project.tts}) from the approved script`,
      ...(project.tts === 'ming' ? [`DO: create ${S}/ming-performance.json using docs/tts.md. Generate the complete narration in one invocation; the continuity adapter holds the acoustic reference. Keep the reviewed script unchanged.`] : []),
      `DO: run \`npm run video -- tts ${S}/SCRIPT.md --narration --provider ${project.tts} --status ${S}/tts-status.json -s ${speed} -o ${S}/narration.wav\` (one command for the whole script; it can take several minutes). Ming uses a shared FIFO queue: while queued, wait for this same command; do not launch duplicate retries or change providers because of queue waiting.`,
      `    Keep all delivery segments in one invocation; report any generation error.`,
      `THEN: ${nextCmd(slug)}`].join('\n')};
  }
  const audio = project.audio || `${S}/narration.wav`;
  const film = [...new Set(project.review.map(g => g === 'prototype' ? 'final' : g).filter(g => g === 'final'))];
  const flags = [`--name ${slug}`, `--audio "${audio}"`, `--script ${S}/SCRIPT.md`, project.format ? `--format ${project.format}` : '',
    `--human-review ${film.length ? film.join(',') : 'none'}`, `--review-depth ${project.reviewDepth || 'standard'}`, project.thumbnails ? `--thumbnails ${project.thumbnails}` : '',
    `--pick-thumbnail ${project.review.includes('thumbnail')}`, project.music ? `--music "${project.music}"` : ''].filter(Boolean).join(' ');
  return {state: 'start', text: [`STATE: create the film job from the approved script and its narration`,
    `DO: run \`npm run video -- start ${flags}\` (transcribes the narration; takes a minute or two)`,
    `THEN: ${nextCmd(slug)}`].join('\n')};
}

/** Read-only overview of every stage, for `status --project` and the watch page. */
export async function projectStatus(root, slug) {
  const project = await loadProject(root, slug), facts = await inspect(root, project);
  const out = {slug, project, phase: facts.phase, delegation: project.delegation, script: null, film: null, thumbnails: null};
  if (!facts.hasJob) {
    out.script = {sources: facts.sources != null, words: words(facts.script), disposition: facts.disposition, rounds: facts.reviewRounds + (facts.review != null ? 1 : 0), stale: facts.reviewStale,
      human: facts.human, narrated: facts.narrated};
    out.stages = pipelineStages(out);
    return out;
  }
  out.film = await jobProgress(facts.job).catch(error => ({state: 'unknown', error: error.message, steps: [], scenes: []}));
  out.thumbnails = await thumbnailStatus(facts.job).catch(() => null);
  out.stages = pipelineStages(out);
  return out;
}

// The pipeline as stages and sub-steps, for the stage bar in chat (`stage-bar --project`). The pipeline is linear: the
// sub-steps before the current one are done and those after it are pending. A current step in repair or blocked keeps
// `problem` set. When everything is done there is no current step.
const FILM_GROUPS = [
  ['Plan', [['visuals', 'Visual plan'], ['plan', 'Film plan']]],
  ['Film', [['scenes', 'Scenes built'], ['final-build', 'Build and checks'], ['final-review', 'Independent review'], ['final-human', 'Your review'],
    ['final-render', 'Render and mix'], ['deliver', 'Delivery checks']]],
];
export const STAGE_LABELS = ['Script', 'Narration', ...FILM_GROUPS.map(([label]) => label), 'Thumbnail', 'Done'];

export function pipelineStages(status) {
  const phase = status.phase || '', p = status.project || {}, gates = p.review || GATES, film = status.film;
  const groups = [], add = (label, steps) => groups.push({label, steps: steps.map(([id, l, detail = '']) => ({id, label: l, status: 'pending', detail}))});
  const sc = status.script || {};
  add('Script', p.inputScript ? [['supplied', 'Your script', 'supplied by you']]
    : [['sources', 'Sources', ''], ['write', 'Script written', sc.words ? `${sc.words} words` : ''],
      ['review', 'Independent review', sc.disposition ? `${sc.disposition}${sc.stale ? ' (stale)' : ''} after ${sc.rounds} round(s)` : ''],
      ...(gates.includes('script') ? [['approve', 'Your approval', sc.human ? `you: ${sc.human.decision}` : '']] : [])]);
  const fs = id => film?.steps?.find(s => s.id === id);
  add('Narration', [['narrate', p.audio ? 'Your recording' : `Narration (${p.tts || 'ming'})`, p.audio ? 'supplied by you' : ''],
    ['prepare', 'Timed to the script', fs('prepare')?.detail || '']]);
  for (const [label, steps] of FILM_GROUPS) add(label, steps.filter(([id]) => !film || fs(id) || !id.endsWith('-human'))
    .filter(([id]) => film || !id.endsWith('-human') || gates.includes(id.split('-')[0])).map(([id, l]) => [id, l, fs(id)?.detail || '']));
  const t = status.thumbnails, made = t?.variants?.filter(v => v.made).length || 0, reviewed = t?.variants?.filter(v => v.review && !v.needsWork).length || 0, n = t?.variants?.length || 0;
  add('Thumbnail', [['thumb-make', 'Variants made', n ? `${made}/${n}` : ''], ['thumb-review', 'Independent review', n ? `${reviewed}/${n} passed or final` : ''],
    ['thumb-pick', gates.includes('thumbnail') ? 'Your pick' : 'Picked', t?.chosen ? `${t.chosen.variant}${t.chosen.by === 'you' ? ' (you)' : ''}` : '']]);
  add('Done', [['done', 'Delivered', '']]);

  // Where the pipeline is.
  let current = null, problem = false, note = '';
  if (!film) {
    current = p.inputScript ? (phase === 'narration' ? 'narrate' : 'prepare')
      : {'gathering sources': 'sources', 'writer asked for more evidence': 'sources', 'writing the script': 'write', 'independent script review': 'review',
        'revising the script (your notes)': 'write', 'waiting for your script approval': 'approve', narration: 'narrate', 'ready to start the film': 'prepare'}[phase]
        || (phase.startsWith('script review') ? 'write' : 'sources');
    if (phase === 'writer asked for more evidence') note = 'the writer asked for more evidence';
    else if (phase.startsWith('script review')) note = `revising after the review (${phase.slice(15)})`;
    else if (phase === 'revising the script (your notes)') note = 'revising with your notes';
    else if (phase === 'ready to start the film') note = 'creating the film job';
  } else {
    const live = film.steps?.find(s => !['done', 'pending'].includes(s.status));
    if (live) { current = live.id; problem = live.status === 'repair' || live.status === 'blocked'; }
    else if (!film.steps?.every(s => s.status === 'done')) current = film.steps?.find(s => s.status === 'pending')?.id || null;
    else current = !t || made < n ? 'thumb-make' : reviewed < n ? 'thumb-review' : !t.chosen ? 'thumb-pick' : null;
  }
  const flat = groups.flatMap(g => g.steps), at = current == null ? flat.length : flat.findIndex(s => s.id === current);
  flat.forEach((s, i) => { s.status = i < at ? 'done' : i === at ? 'current' : 'pending'; });
  if (at < flat.length && at >= 0 && problem) flat[at].problem = true;
  if (at < flat.length && at >= 0 && note) flat[at].detail = note;
  for (const g of groups) g.status = g.steps.every(s => s.status === 'done') ? 'done' : g.steps.some(s => s.status === 'current') ? 'current' : 'pending';
  const group = groups.find(g => g.status === 'current');
  return {groups, current: group ? {group: group.label, step: flat[at].label, detail: flat[at].detail, problem} : null, phase,
    delegated: status.delegation?.open ? status.delegation.tasks.map(x => x.title) : []};
}

export function printStatus(status) {
  const lines = [`PROJECT: ${status.slug}`, `PHASE: ${status.phase}`];
  if (status.delegation?.open) lines.push(`DELEGATED: ${status.delegation.tasks.map(t => t.title).join(', ')} (since ${status.delegation.openedAt})`);
  const p = status.project;
  lines.push(`PERSONALITY: ${p.productionProfile?.id || 'explainer'}${p.productionProfile ? ` v${p.productionProfile.version}` : ' (legacy)'}`);
  lines.push(`Checkpoints: ${p.review.join(', ') || 'none'} · review depth: ${p.reviewDepth || 'standard'} · narration: ${p.audio ? `supplied (${p.audio})` : p.tts} · format: ${p.format || 'default'} · length: ${p.duration ? `${p.duration}s` : 'writer chooses'}`);
  if (status.script) {
    const s = status.script;
    lines.push(`Script: ${s.words ? `${s.words} words` : 'not written'}${s.disposition ? ` · review ${s.disposition}${s.stale ? ' (stale)' : ''} after ${s.rounds} round(s)` : ''}${s.human ? ` · you: ${s.human.decision}` : ''}${s.narrated ? ' · narrated' : ''}`);
  }
  if (status.film) {
    lines.push(`Film: ${status.film.state}`);
    for (const s of status.film.steps || []) lines.push(`  ${{done: '✓', current: '▶', repair: '!', blocked: '✗', pending: '·'}[s.status] || '?'} ${s.label.padEnd(32)} ${s.detail}`);
    if (status.film.scenes?.length) lines.push(`  Scenes: ${status.film.scenes.filter(s => s.built).length}/${status.film.scenes.length} built`);
  }
  if (status.stages) lines.push(`Stages: ${status.stages.groups.map(g => `${{done: '✓', current: '▶', pending: '·'}[g.status]} ${g.label}`).join('  ')}${status.stages.current ? ` · now: ${status.stages.current.step}` : ''}`);
  if (status.thumbnails?.variants?.length) lines.push(`Thumbnails: ${status.thumbnails.variants.map(v => `${v.id}${v.review ? ` ${v.review.status}` : ''}`).join(', ')}${status.thumbnails.chosen ? ` · chosen ${status.thumbnails.chosen.variant}` : ''}`);
  return lines.join('\n');
}
