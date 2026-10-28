// Thumbnails: N variants of one film, each from a different angle, independently reviewed; then one is picked (by the
// person, when they asked to pick, otherwise the reviewer's top-ranked) and archived. Any variant can be regenerated
// with feedback while the others stay. `thumbnailStep` is the state machine (`npm run video -- thumbnails`), in the
// same DO/spawn grammar as `next`.
//
//   thumbnail/variants/<v1..vN>/   BRIEF.md (a "Headline:" line), thumbnail.svg (self-contained), thumbnail.png
//                                  (video dimensions), preview-<width>x<height>.png, feedback.json (notes, each tied to the PNG it is about)
//   thumbnail/variants/REVIEW.json one entry per variant, tied to the PNG it judged, plus the reviewer's ranking
//   thumbnail/CHOSEN.json          which variant was picked, by whom, and its PNG hash
//   thumbnail/{BRIEF.md, thumbnail.svg, thumbnail.png, preview-<width>x<height>.png, REVIEW.json}  the picked variant's copy
import {readFile, writeFile, readdir, mkdir, copyFile, rm, rename, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig, FORMATS, formatName} from './format.mjs';
import {taskPrompt} from './briefs.mjs';
import {readPersonality} from './personalities.mjs';

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


/** How many variants a job makes: job.json `thumbnails`, else video.config.json `thumbnails`, else 3. */
export async function thumbnailCount(job) {
  const manifest = await json(path.join(job, 'job.json')).catch(() => ({}));
  const config = await loadConfig(ROOT).catch(() => ({}));
  const n = Number(manifest.thumbnails ?? config.thumbnails ?? 3);
  return Number.isInteger(n) && n >= 1 && n <= MAX_THUMBNAILS ? n : 3;
}

/** Saved video dimensions are authoritative for every personality; formats cover legacy jobs. */
export async function thumbnailDimensions(job) {
  const manifest = await json(path.join(job, 'job.json'));
  let {width, height} = manifest;
  if (width === undefined && height === undefined) {
    const format = manifest.format || (await loadConfig(ROOT)).format;
    [width, height] = FORMATS[formatName(format)];
  }
  if (![width, height].every(n => Number.isInteger(n) && n > 0)) throw new Error('Invalid video dimensions in job.json.');
  const scale = 320 / Math.max(width, height);
  const previewWidth = Math.max(1, Math.round(width * scale)), previewHeight = Math.max(1, Math.round(height * scale));
  return {width, height, previewWidth, previewHeight, previewFile: `preview-${previewWidth}x${previewHeight}.png`,
    orientation: height > width ? 'vertical' : height === width ? 'square' : 'landscape'};
}

function pngSize(bytes) {
  return bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47 ? {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)} : null;
}

async function variantInfo(job, id) {
  const {width, height, previewWidth, previewHeight, previewFile} = await thumbnailDimensions(job);
  const files = await readdir(V(job, id)).catch(() => []);
  const png = files.includes('thumbnail.png') ? await readFile(V(job, id, 'thumbnail.png')) : null;
  const size = png && pngSize(png);
  const preview = files.includes(previewFile) ? pngSize(await readFile(V(job, id, previewFile))) : null;
  const validSize = size?.width === width && size?.height === height;
  const validPreview = preview?.width === previewWidth && preview?.height === previewHeight;
  const brief = files.includes('BRIEF.md') ? await readFile(V(job, id, 'BRIEF.md'), 'utf8') : '';
  const feedback = await json(V(job, id, 'feedback.json')).catch(() => []);
  const pngSha256 = png ? sha(png) : null;
  return {id, previewFile, dir: rel(job, `thumbnail/variants/${id}`), files,
    made: Boolean(png && validSize && validPreview && brief && files.some(f => f.endsWith('.svg'))),
    pngError: png && !validSize ? `thumbnail.png is ${size ? `${size.width}×${size.height}` : 'not a PNG'}, expected ${width}×${height}` : !validPreview ? `Missing or invalid ${previewFile}; expected ${previewWidth}×${previewHeight}.` : '',
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
    const current = Boolean(v.made && entry && v.pngSha256 && entry.pngSha256 === v.pngSha256);
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

async function makerBrief(job, variant, status, count) {
  return taskPrompt('thumbnail-maker', {job, variant:variant.id, outputDirectory:variant.dir,
    dimensions:await thumbnailDimensions(job), variants:count, contract:'docs/video-click-psychology.md',
    profile:'production-profile.json', script:'inputs/source-script.md', film:'film.json', frames:'review/final/',
    visualIntent:await visualPlanThumbnail(job), userAndReviewFeedback:variant.openFeedback,
    otherHeadlines:status.variants.filter(v=>v.id!==variant.id&&v.headline).map(v=>({id:v.id,headline:v.headline})),
    outputs:['BRIEF.md: Title, Headline, Description','thumbnail.svg','thumbnail.png','feed preview']});
}
async function reviewerBrief(job,status,todo) {
  return taskPrompt('thumbnail-reviewer', {job, contract:'docs/video-click-psychology.md', profile:'production-profile.json',
    dimensions:await thumbnailDimensions(job), variants:todo.map(v=>({id:v.id,png:`${v.dir}/thumbnail.png`,
      preview:`${v.dir}/${v.previewFile}`,brief:`${v.dir}/BRIEF.md`})),
    outputs:['thumbnail-verdict for each inspected variant','ranking of passing variants']});
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
  if (!v.made) throw new Error(`${variant} is not finished (BRIEF.md, an SVG, a thumbnail.png matching the video dimensions and its feed preview). ${v.pngError}`);
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
  if (!v.made || v.review?.status !== 'pass') throw new Error(`${variant} has not passed the independent review of its current version.`);
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

/** Render a variant's SVG to thumbnail.png at video dimensions and an aspect-matched feed preview with the repository's Chrome. */
export async function exportThumbnail(job, variant) {
  const {width, height, previewWidth, previewHeight, previewFile} = await thumbnailDimensions(job);
  const files = await readdir(V(job, variant)).catch(() => []);
  const svg = files.includes('thumbnail.svg') ? 'thumbnail.svg' : files.find(f => f.endsWith('.svg'));
  if (!svg) throw new Error(`Write ${rel(job, `thumbnail/variants/${variant}`)}/thumbnail.svg first.`);
  const {chromePath} = await import('./inspect.mjs');
  const {default: puppeteer} = await import('puppeteer-core');
  const {pathToFileURL} = await import('node:url');
  const browser = await puppeteer.launch({executablePath: await chromePath(), headless: true, args: ['--allow-file-access-from-files', '--no-sandbox', '--hide-scrollbars']});
  try {
    const page = await browser.newPage();
    await page.setViewport({width, height, deviceScaleFactor: 1});
    // Opened as a document (not an <img>), so fonts and images next to the SVG load too.
    await page.goto(pathToFileURL(V(job, variant, svg)).href, {waitUntil: 'load'});
    const ratio = await page.evaluate(() => {
      const svg = document.documentElement;
      const box = svg.viewBox?.baseVal;
      return box?.width > 0 && box?.height > 0 ? box.width / box.height : svg.width?.baseVal?.value / svg.height?.baseVal?.value;
    });
    if (!Number.isFinite(ratio) || Math.abs(ratio - width / height) > 0.001)
      throw new Error(`SVG aspect ratio must match the video's ${width}×${height} frame. Recompose the thumbnail for this orientation.`);
    await page.evaluate(({width, height}) => {
      Object.assign(document.documentElement.style, {width: `${width}px`, height: `${height}px`, display: 'block'});
    }, {width, height});
    await page.evaluate(() => document.fonts?.ready);
    await page.screenshot({path: V(job, variant, 'thumbnail.png'), clip: {x: 0, y: 0, width, height}});
    await page.setViewport({width: previewWidth, height: previewHeight, deviceScaleFactor: 1});
    // Leave the SVG document before replacing it with an HTML feed preview.
    await page.goto('about:blank');
    await page.setContent(`<!doctype html><style>html,body{margin:0}img{display:block;width:${previewWidth}px;height:${previewHeight}px}</style><img src="data:image/png;base64,${(await readFile(V(job, variant, 'thumbnail.png'))).toString('base64')}">`, {waitUntil: 'load'});
    await page.screenshot({path: V(job, variant, previewFile), clip: {x: 0, y: 0, width: previewWidth, height: previewHeight}});
    for (const file of files.filter(name => /^preview-\d+x\d+\.png$/.test(name) && name !== previewFile))
      await rm(V(job, variant, file));
  } finally { await browser.close(); }
  const size = pngSize(await readFile(V(job, variant, 'thumbnail.png')));
  return {png: rel(job, `thumbnail/variants/${variant}/thumbnail.png`), preview: rel(job, `thumbnail/variants/${variant}/${previewFile}`), size};
}

