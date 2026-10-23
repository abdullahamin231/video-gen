// Thumbnails: N variants of one film, each from a different angle, independently reviewed; then one is picked (by the
// person, when they asked to pick, otherwise the reviewer's top-ranked) and archived. Any variant can be regenerated
// with feedback while the others stay. `thumbnailStep` is the state machine (`npm run video -- thumbnails`), in the
// same DO/spawn grammar as `next`.
//
//   thumbnail/variants/<v1..vN>/   BRIEF.md (a "Headline:" line), thumbnail.svg (self-contained), thumbnail.png
//                                  (1280×720), preview-320x180.png, feedback.json (notes, each tied to the PNG it is about)
//   thumbnail/variants/REVIEW.json one entry per variant, tied to the PNG it judged, plus the reviewer's ranking
//   thumbnail/CHOSEN.json          which variant was picked, by whom, and its PNG hash
//   thumbnail/{BRIEF.md, thumbnail.svg, thumbnail.png, preview-320x180.png, REVIEW.json}  the picked variant's copy
import {readFile, writeFile, readdir, mkdir, copyFile, rm, rename, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig} from './format.mjs';
import {ROLE_BOUNDARY} from './briefs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIBRARY = process.env.VG_LIBRARY || path.join(ROOT, 'library');
export const MAX_THUMBNAILS = 6;
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const exists = file => access(file).then(() => true, () => false);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const rel = (job, file) => path.relative(ROOT, path.join(job, file)).split(path.sep).join('/');
const V = (job, id, file = '') => path.join(job, 'thumbnail/variants', id, file);
const ids = n => Array.from({length: n}, (_, i) => `v${i + 1}`);

// Each variant starts from a different angle, so the person has a real choice.
const ANGLES = [
  'The thumbnail the visual plan describes, as written (its headline, subject and layout).',
  'A useful outcome or an evidenced problem: tease the stakes in money, time or quality while withholding the cause, fix and final verdict.',
  'A curiosity-led discovery: the most surprising explanation or comparison the film supports. Name the subject and the unanswered question; no invented reversal or accusation.',
  'An unexplained result as one big number or a before/after, with the number and conditions from the research; leave how it happened unresolved.',
  'A clue to a surprising mechanism; leave the actual mechanism and resolution for the video.',
  'Your own strongest idea, unlike every other variant.',
];

/** How many variants a job makes: job.json `thumbnails`, else video.config.json `thumbnails`, else 3. */
export async function thumbnailCount(job) {
  const manifest = await json(path.join(job, 'job.json')).catch(() => ({}));
  const config = await loadConfig(ROOT).catch(() => ({}));
  const n = Number(manifest.thumbnails ?? config.thumbnails ?? 3);
  return Number.isInteger(n) && n >= 1 && n <= MAX_THUMBNAILS ? n : 3;
}

function pngSize(bytes) {
  return bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47 ? {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)} : null;
}

async function variantInfo(job, id) {
  const files = await readdir(V(job, id)).catch(() => []);
  const png = files.includes('thumbnail.png') ? await readFile(V(job, id, 'thumbnail.png')) : null;
  const size = png && pngSize(png);
  const brief = files.includes('BRIEF.md') ? await readFile(V(job, id, 'BRIEF.md'), 'utf8') : '';
  const feedback = await json(V(job, id, 'feedback.json')).catch(() => []);
  const pngSha256 = png ? sha(png) : null;
  return {id, dir: rel(job, `thumbnail/variants/${id}`), files,
    made: Boolean(png && size?.width === 1280 && size?.height === 720 && brief && files.some(f => f.endsWith('.svg'))),
    pngError: png && !(size?.width === 1280 && size?.height === 720) ? `thumbnail.png is ${size ? `${size.width}×${size.height}` : 'not a PNG'}, not 1280×720` : '',
    headline: /^\s*[-*]?\s*\**headline\**\s*:\s*(.+)$/im.exec(brief)?.[1].replace(/[*"“”]/g, '').trim() || '',
    pngSha256, feedback: Array.isArray(feedback) ? feedback : []};
}

/** Everything about a job's thumbnails, read from its files (no writes). Used by `thumbnails --json` and the UI. */
export async function thumbnailStatus(job) {
  const n = await thumbnailCount(job), manifest = await json(path.join(job, 'job.json')).catch(() => ({}));
  const review = await json(path.join(job, 'thumbnail/variants/REVIEW.json')).catch(() => ({variants: {}, ranking: []}));
  const chosen = await json(path.join(job, 'thumbnail/CHOSEN.json')).catch(() => null);
  const variants = [];
  for (const id of ids(n)) {
    const v = await variantInfo(job, id), entry = review.variants?.[id];
    const current = Boolean(entry && v.pngSha256 && entry.pngSha256 === v.pngSha256);
    const open = v.feedback.filter(f => v.pngSha256 && f.forPng === v.pngSha256);
    const reviewerRounds = v.feedback.filter(f => f.by === 'reviewer').length;
    variants.push({...v, review: current ? {status: entry.status, findings: entry.findings || [], reviewerAgentId: entry.reviewerAgentId} : null,
      openFeedback: open, needsWork: !v.made || open.length > 0,
      failed: current && entry.status === 'blocked' && reviewerRounds >= 3 && !open.some(f => f.by === 'you')});
  }
  const byId = Object.fromEntries(variants.map(v => [v.id, v]));
  const chosenCurrent = chosen && byId[chosen.variant]?.pngSha256 === chosen.pngSha256 && byId[chosen.variant]?.review?.status === 'pass';
  return {count: n, pick: manifest.pickThumbnail === true, variants, ranking: (review.ranking || []).filter(id => byId[id]),
    chosen: chosenCurrent ? chosen : null};
}

const visualPlanThumbnail = async job => {
  const text = await readFile(path.join(job, 'inputs/visuals.md'), 'utf8').catch(() => '');
  const m = /^## Thumbnail[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text);
  return m ? m[1].trim() : '';
};

async function makerBrief(job, v, status, n) {
  const J = rel(job, ''), others = status.variants.filter(o => o.id !== v.id && o.headline).map(o => `- ${o.id}: ${o.headline}`);
  const angle = ANGLES[Math.min(Number(v.id.slice(1)) - 1, ANGLES.length - 1)];
  const plan = await visualPlanThumbnail(job);
  const notes = v.openFeedback.map(f => `- ${f.by === 'you' ? 'From the person who asked for the film (their words; do exactly this)' : 'From the independent thumbnail reviewer'}: ${f.text}`);
  return `${ROLE_BOUNDARY}

# Thumbnail ${v.id} of ${n}${v.made ? ' (regenerate)' : ''}

You make one YouTube thumbnail for the finished film in \`${J}\`. ${n > 1 ? `${n} variants are made in parallel; this is ${v.id}.` : ''}

## Read first
- The script writer's plan for the thumbnail (from \`${J}/inputs/visuals.md\`):
${plan ? plan.split('\n').map(l => `  ${l}`).join('\n') : '  (none: derive the title and headline from the script and film.json)'}
- "Title and thumbnail" in \`.opencode/skills/script-writing/references/visuals.md\`, and \`docs/video-click-psychology.md\`:
  thumbnail text creates the mystery; the title establishes the subject; the video delivers the answer. Usually
  2–4 readable words; tease a specific incident, contradiction, consequence or unexplained result. Withhold the cause,
  fix and final verdict in both headline and description. A question mark is optional. Keep the subject understandable
  and any stakes or scale supported by evidence. Preserve explicitly requested wording.
- \`docs/kaiexplains-thumbnail-study.md\` and its two contact sheets (look at the images).
- The narration \`${J}/SCRIPT.md\` (or \`${J}/inputs/source-script.md\`), especially its first thirty seconds, and \`${J}/film.json\`.
  Take the look (palette, drawing style) from the film's frames in \`${J}/review/final/\` and its assets.

## Your angle
${angle}
${others.length ? `\nThe other variants' headlines (be clearly different from these):\n${others.join('\n')}\n` : ''}${notes.length ? `
## Change this variant
The last version is \`${v.dir}/thumbnail.png\`. Look at it, then make a new version that does this:
${notes.join('\n')}
Keep what the notes do not ask to change.
` : ''}
## Make
Everything goes in \`${v.dir}/\` (create it):
1. \`BRIEF.md\`: a line \`Title: <the video title>\`, a line \`Headline: <the words on the image>\`, and
   \`Description: <two sentences, roughly 30–60 words: topic, viewer benefit and scope>\`, then the intended viewer,
   why they would click, the subject, layout,
   colours, what the image adds to the title, where the film pays it off (scene id and words), and the research line
   behind any number or claim in the package. Preserve an explicitly approved title; propose changes separately.
   Read any packaging alternatives in \`${J}/inputs/visuals.md\` and choose copy that fits this variant.
2. \`thumbnail.svg\`: 1280×720 (\`viewBox="0 0 1280 720"\`), editable layers (text as text), self-contained: embed fonts
   and images as data: URLs or keep them as files in this folder; nothing from outside it.
3. Run \`npm run video -- thumbnail-export --job ${J} --variant ${v.id}\`: it writes \`thumbnail.png\` (1280×720) and
   \`preview-320x180.png\` from the SVG with the repository's browser. Open both and check the headline reads at 320×180.
   Fix and export again until it does.
Reply with the title, thumbnail headline, short description and one line explaining the click motivation.
`;
}

async function reviewerBrief(job, status, todo) {
  const J = rel(job, '');
  const list = todo.map(v => `- ${v.id}: \`${v.dir}/thumbnail.png\`, \`${v.dir}/preview-320x180.png\`, \`${v.dir}/BRIEF.md\``).join('\n');
  return `${ROLE_BOUNDARY}

# Independent thumbnail review

You did not make these thumbnails. Judge each variant below for the finished film in \`${J}\`.

## Variants to review
${list}
${status.variants.filter(v => v.review).length ? `Already reviewed and unchanged (for the ranking only): ${status.variants.filter(v => v.review && !todo.includes(v)).map(v => v.id).join(', ') || 'none'}.\n` : ''}
## Read
- \`docs/video-click-psychology.md\`, "Title and thumbnail" in \`.opencode/skills/script-writing/references/visuals.md\`, and \`docs/kaiexplains-thumbnail-study.md\`
  with its contact sheets.
- \`${J}/SCRIPT.md\` (or \`${J}/inputs/source-script.md\`), the research behind it, \`${J}/film.json\`.

## Check each variant (open the images; a brief is not the image)
- At 320×180 the headline reads and the subject is recognisable.
- Title, headline and short description form one clear, relevant promise. The image adds to the title.
- Check the explicit Title:, Headline: and Description: lines in each BRIEF.md. Missing copy needs revision.
- Benefits, discoveries, questions, results and supported warnings are all valid; no compulsory negative framing.
- Thumbnail text creates the mystery; the title establishes the subject; the video delivers the answer. Check that
  the headline and description leave the central cause, fix and final verdict unresolved, while the title and image
  supply enough context to understand the question. Spoilers or empty mystery need revision unless explicitly requested.
- The description identifies the topic, viewer benefit and scope without unsupported claims or keyword stuffing.
- The film's first thirty seconds raise what the headline claims, and the film settles it.
- Every claim and number on it is supported by the film and research; nothing accuses a named company or person of
  something the film does not show. False or unsupported is blocking; weak is a finding, not a block.
- Clearly different from the other variants. Explain the expected appeal; do not claim measured CTR or a proven winner.

## Record
For each variant: \`npm run video -- thumbnail-verdict --job ${J} --variant <id> --status pass|blocked --finding "<what and why>" [--finding ...] --inspected <files you opened, comma-separated>\`
Then rank every passing variant, best first: \`npm run video -- thumbnail-verdict --job ${J} --rank v2,v1,...\`
Reply with the ranking, each variant's title/headline/description, and one line explaining its strengths and tradeoffs.
`;
}

const spawn = (role, briefs, then) => [`DO: spawn ${briefs.length > 1 ? `${briefs.length} fresh sub-agents, one per brief below (they may run in parallel)` : 'one fresh sub-agent'} with no conversation history.`,
  `    Use the agent type named before each prompt if your harness has it; otherwise any fresh sub-agent.`,
  `    Give each sub-agent exactly its prompt, and nothing else:`,
  ...briefs.map(b => `      ${role}: "Read ${b} and follow it exactly."`),
  `    Wait until ${briefs.length > 1 ? 'all have' : 'it has'} finished. Do not do their work yourself and do not edit their files.`,
  `THEN: ${then}`].join('\n');

async function writeBriefFile(job, name, text) {
  await mkdir(path.join(job, 'briefs'), {recursive: true});
  const file = path.join(job, 'briefs', name); await writeFile(file, text); return file;
}

/** The next thumbnail step. Run only after the film is delivered. */
export async function thumbnailStep(job) {
  const J = rel(job, ''), NEXT = `npm run video -- thumbnails --job ${J}`;
  let status = await thumbnailStatus(job);
  // A blocked review becomes feedback for that variant's maker (once per PNG), up to three rounds.
  for (const v of status.variants) {
    if (v.review?.status !== 'blocked' || v.failed || v.openFeedback.length) continue;
    const feedback = [...v.feedback, {by: 'reviewer', text: v.review.findings.join(' ') || 'Blocked by the reviewer.', forPng: v.pngSha256, at: new Date().toISOString()}];
    await save(V(job, v.id, 'feedback.json'), feedback);
  }
  status = await thumbnailStatus(job);
  const live = status.variants.filter(v => !v.failed);
  const work = live.filter(v => v.needsWork);
  if (work.length) {
    const briefs = [];
    for (const v of work) { await mkdir(V(job, v.id), {recursive: true}); briefs.push(await writeBriefFile(job, `thumbnail-${v.id}.md`, await makerBrief(job, v, status, status.count))); }
    return {state: 'thumbnail variants', text: `STATE: make ${work.length === status.count ? `${work.length} thumbnail variant(s)` : `thumbnail ${work.map(v => v.id).join(', ')} again`}\n${spawn('thumbnail-maker', briefs, NEXT)}`};
  }
  const todo = live.filter(v => !v.review);
  if (todo.length) {
    const brief = await writeBriefFile(job, 'thumbnail-review.md', await reviewerBrief(job, status, todo));
    return {state: 'thumbnail review', text: `STATE: independent review of thumbnail ${todo.map(v => v.id).join(', ')}\n${spawn('thumbnail-reviewer', [brief], NEXT)}\n    The reviewer must be a new sub-agent that made no thumbnail.`};
  }
  const passing = live.filter(v => v.review?.status === 'pass');
  if (!passing.length) return {state: 'blocked', text: `STATE: blocked: no thumbnail variant passed review after three rounds each.\nDO: stop and report to the user the reviewer's findings from ${J}/thumbnail/variants/REVIEW.json. Do not call the video complete.`};
  if (!status.chosen || (status.pick && status.chosen.by !== 'you')) {
    if (status.pick) return {state: 'choose thumbnail', text: [`STATE: the person picks the thumbnail (${passing.length} passed review: ${passing.map(v => `${v.id} "${v.headline}"`).join(', ')})`,
      `DO: ask the user to pick one, or to say what to change in any one.`,
      `    With the video runner: call checkpoint {kind: "thumbnail", summary: "<one line>"}. The UI shows every variant and records their pick or feedback itself.`,
      `    Without it: show them ${passing.map(v => `${v.dir}/thumbnail.png`).join(', ')}, then record exactly what they say:`,
      `    \`npm run video -- thumbnail-choose --job ${J} --variant <id>\` or \`npm run video -- thumbnail-feedback --job ${J} --variant <id> --note "<their words>"\``,
      `    Never pick for them and never reword their feedback.`, `THEN: ${NEXT}`].join('\n')};
    const best = status.ranking.find(id => passing.some(v => v.id === id)) || passing[0].id;
    return {state: 'pick thumbnail', text: `STATE: pick the reviewer's top-ranked thumbnail (${best})\nDO: run \`npm run video -- thumbnail-choose --job ${J} --variant ${best}\`\nTHEN: ${NEXT}`};
  }
  const archived = await archiveMatches(job);
  if (!archived) return {state: 'archive thumbnail', text: `STATE: archive the picked thumbnail\nDO: run \`npm run video -- thumbnail-choose --job ${J} --variant ${status.chosen.variant}${status.chosen.by === 'you' ? ' --by you' : ''}\`\nTHEN: ${NEXT}`};
  return {state: 'done', text: `STATE: done\nThe thumbnail is ${J}/thumbnail/thumbnail.png (variant ${status.chosen.variant}, "${status.variants.find(v => v.id === status.chosen.variant).headline}", picked by ${status.chosen.by === 'you' ? 'the user' : 'the reviewer\'s ranking'}), archived at library/thumbnails/${path.basename(job)}/.`};
}

/** A reviewer's verdict on one variant, tied to the PNG it judged. */
export async function recordVerdict(job, {variant, status, findings = [], inspected = [], reviewer}) {
  if (!['pass', 'blocked'].includes(status)) throw new Error('--status is pass or blocked.');
  if (!reviewer) throw new Error('No reviewer id: the runner sets VIDEO_AGENT_ID; elsewhere pass --reviewer <your agent id>.');
  const v = await variantInfo(job, variant);
  if (!v.made) throw new Error(`${variant} is not finished (BRIEF.md, an SVG and a 1280×720 thumbnail.png). ${v.pngError}`);
  if (status === 'blocked' && !findings.length) throw new Error('A blocked variant needs at least one --finding saying what is wrong.');
  if (!inspected.some(f => f.endsWith('.png'))) throw new Error('--inspected must list the PNGs you opened.');
  const file = path.join(job, 'thumbnail/variants/REVIEW.json');
  const review = await json(file).catch(() => ({version: 1, variants: {}, ranking: []}));
  review.variants[variant] = {status, findings, inspectedFiles: inspected, pngSha256: v.pngSha256, reviewerAgentId: reviewer, at: new Date().toISOString()};
  await save(file, review);
  return review.variants[variant];
}

export async function recordRanking(job, ranking) {
  const file = path.join(job, 'thumbnail/variants/REVIEW.json');
  const review = await json(file).catch(() => null);
  if (!review) throw new Error('Record a verdict for each variant before ranking them.');
  const unknown = ranking.filter(id => !review.variants[id]);
  if (unknown.length) throw new Error(`No verdict recorded for ${unknown.join(', ')}.`);
  review.ranking = ranking; await save(file, review);
}

/** Feedback on one variant (the person's words, kept verbatim). Picking that variant is undone until it is remade. */
export async function addThumbnailFeedback(job, {variant, text, by = 'you'}) {
  text = String(text || '').trim();
  if (!text) throw new Error('Say what should change.');
  const status = await thumbnailStatus(job), v = status.variants.find(x => x.id === variant);
  if (!v) throw new Error(`No variant ${variant}; this job makes ${status.count}.`);
  if (!v.made) throw new Error(`${variant} is not made yet.`);
  await save(V(job, variant, 'feedback.json'), [...v.feedback, {by, text: text.slice(0, 4000), forPng: v.pngSha256, at: new Date().toISOString()}]);
  if (status.chosen?.variant === variant) await rm(path.join(job, 'thumbnail/CHOSEN.json'), {force: true});
  return {variant, feedback: v.feedback.length + 1};
}

const ROOT_FILES = new Set(['variants', 'CHOSEN.json']);
/** Make a passing variant the film's thumbnail, and archive the thumbnail folder to library/thumbnails/<slug>/. */
export async function chooseThumbnail(job, {variant, by = 'reviewer'}) {
  const status = await thumbnailStatus(job), v = status.variants.find(x => x.id === variant);
  if (!v) throw new Error(`No variant ${variant}; this job makes ${status.count}.`);
  if (v.review?.status !== 'pass') throw new Error(`${variant} has not passed the independent review of its current version.`);
  if (v.openFeedback.length) throw new Error(`${variant} has feedback that has not been applied yet.`);
  const dir = path.join(job, 'thumbnail');
  for (const name of await readdir(dir)) if (!ROOT_FILES.has(name)) await rm(path.join(dir, name), {recursive: true, force: true});
  for (const name of v.files) if (name !== 'feedback.json') await copyFile(V(job, variant, name), path.join(dir, name));
  const entry = (await json(path.join(dir, 'variants/REVIEW.json'))).variants[variant];
  await save(path.join(dir, 'REVIEW.json'), {status: 'pass', variant, reviewerAgentId: entry.reviewerAgentId, inspectedFiles: entry.inspectedFiles,
    findings: entry.findings, limitations: ['Thumbnail reviewed as still images at full and feed size; click-through is not measured.']});
  await save(path.join(dir, 'CHOSEN.json'), {version: 1, variant, by, pngSha256: v.pngSha256, headline: v.headline, at: new Date().toISOString()});
  await archiveThumbnail(job);
  return {variant, headline: v.headline};
}

async function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, {withFileTypes: true}).catch(() => [])) {
    if (entry.isDirectory()) out.push(...await listFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`));
    else if (entry.isFile()) out.push(`${prefix}${entry.name}`);
  }
  return out;
}
// Earlier archives are kept under history/<time>/, never overwritten.
async function archiveThumbnail(job) {
  const source = path.join(job, 'thumbnail'), target = path.join(LIBRARY, 'thumbnails', path.basename(job));
  if (await exists(target) && !await archiveMatches(job)) {
    const old = (await readdir(target)).filter(n => n !== 'history');
    if (old.length) {
      const keep = path.join(target, 'history', new Date().toISOString().replace(/[:.]/g, '-'));
      await mkdir(keep, {recursive: true});
      for (const name of old) await rename(path.join(target, name), path.join(keep, name));
    }
  }
  for (const file of await listFiles(source)) {
    await mkdir(path.dirname(path.join(target, file)), {recursive: true});
    await copyFile(path.join(source, file), path.join(target, file));
  }
}
async function archiveMatches(job) {
  const source = path.join(job, 'thumbnail'), target = path.join(LIBRARY, 'thumbnails', path.basename(job));
  for (const file of await listFiles(source)) {
    const [a, b] = await Promise.all([readFile(path.join(source, file)), readFile(path.join(target, file)).catch(() => null)]);
    if (!b || !a.equals(b)) return false;
  }
  return true;
}

/** Render a variant's SVG to thumbnail.png (1280×720) and preview-320x180.png with the repository's Chrome. */
export async function exportThumbnail(job, variant) {
  const files = await readdir(V(job, variant)).catch(() => []);
  const svg = files.includes('thumbnail.svg') ? 'thumbnail.svg' : files.find(f => f.endsWith('.svg'));
  if (!svg) throw new Error(`Write ${rel(job, `thumbnail/variants/${variant}`)}/thumbnail.svg first.`);
  const {chromePath} = await import('./inspect.mjs');
  const {default: puppeteer} = await import('puppeteer-core');
  const {pathToFileURL} = await import('node:url');
  const browser = await puppeteer.launch({executablePath: await chromePath(), headless: true, args: ['--allow-file-access-from-files', '--no-sandbox', '--hide-scrollbars']});
  try {
    const page = await browser.newPage();
    await page.setViewport({width: 1280, height: 720, deviceScaleFactor: 1});
    // Opened as a document (not an <img>), so fonts and images next to the SVG load too.
    await page.goto(pathToFileURL(V(job, variant, svg)).href, {waitUntil: 'load'});
    await page.evaluate(() => document.fonts?.ready);
    await page.screenshot({path: V(job, variant, 'thumbnail.png'), clip: {x: 0, y: 0, width: 1280, height: 720}});
    await page.setViewport({width: 320, height: 180, deviceScaleFactor: 1});
    // Leave the SVG document before replacing it with an HTML feed preview.
    await page.goto('about:blank');
    await page.setContent(`<!doctype html><style>html,body{margin:0}img{display:block;width:320px;height:180px}</style><img src="data:image/png;base64,${(await readFile(V(job, variant, 'thumbnail.png'))).toString('base64')}">`, {waitUntil: 'load'});
    await page.screenshot({path: V(job, variant, 'preview-320x180.png'), clip: {x: 0, y: 0, width: 320, height: 180}});
  } finally { await browser.close(); }
  const size = pngSize(await readFile(V(job, variant, 'thumbnail.png')));
  return {png: rel(job, `thumbnail/variants/${variant}/thumbnail.png`), preview: rel(job, `thumbnail/variants/${variant}/preview-320x180.png`), size};
}

