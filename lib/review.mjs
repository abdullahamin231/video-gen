import {readFile, writeFile, mkdir, readdir, lstat, realpath, rename} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

export const REVIEW_ROLES = ['visual-mechanism', 'narration-fidelity', 'continuity-legibility'];
const stages = ['prototype', 'final'];
const sha = value => createHash('sha256').update(value).digest('hex');
const readJSON = async file => JSON.parse(await readFile(file, 'utf8'));
const present = value => typeof value === 'string' && value.trim().length > 0;
const hashPattern = /^[a-f0-9]{64}$/;
const inside = (root, target) => target.startsWith(root + path.sep);
export async function writeReviewFile(job, relative, bytes) {
  const root = await realpath(job);
  if (!present(relative) || !relative.startsWith('review/') || relative.includes('\\') || relative.split('/').includes('..'))
    throw new Error(`Unsafe review output path: ${relative}`);
  const target = path.resolve(root,relative);
  let parent = root;
  for (const part of relative.split('/').slice(0,-1)) {
    parent = path.join(parent,part);
    try {await mkdir(parent);} catch (error) {if (error.code !== 'EEXIST') throw error;}
    if ((await lstat(parent)).isSymbolicLink() || await realpath(parent) !== parent) throw new Error('Symlinked review output is not allowed.');
  }
  try {if ((await lstat(target)).isSymbolicLink()) throw new Error('Symlinked review output is not allowed.');}
  catch (error) {if (error.code !== 'ENOENT') throw error;}
  const temporary = path.join(parent,`.review-${randomUUID()}.tmp`);
  await writeFile(temporary,bytes,{flag:'wx'});
  await rename(temporary,target);
}
const save = (job, relative, value) => writeReviewFile(job,relative,JSON.stringify(value,null,2) + '\n');

export async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export function reviewStage(stage) {
  if (!stages.includes(stage)) throw new Error('Review stage must be prototype or final.');
  return stage;
}

// Review records and render caches are deliberately outside the source digest.
// Actual inputs, fonts, assets, code, cue files and project config are included.
export async function sourceFingerprint(job) {
  const excluded = new Set(['node_modules', '.git', '.hyperframes', '.cache', 'review', 'renders', 'library-candidates', 'briefs']);
  const entries = [];
  async function walk(dir, prefix = '') {
    for (const entry of (await readdir(dir, {withFileTypes: true})).sort((a,b) => a.name.localeCompare(b.name))) {
      if (!prefix && excluded.has(entry.name)) continue;
      const rel = prefix + entry.name, file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Production sources must be frozen local files, not symlinks: ${rel}`);
      if (entry.isDirectory()) await walk(file, rel + '/');
      else if (entry.isFile()) {
        if (rel === 'job.json') {
          const {status, completedAt, delivery, reviewRounds, reviewRoundPacks, reviewPlanRevision, ...config} = await readJSON(file);
          entries.push([rel, sha(JSON.stringify(config))]);
        } else entries.push([rel, await fileHash(file)]);
      }
    }
  }
  await walk(job);
  return sha(JSON.stringify(entries));
}

export async function localFile(job, relative) {
  if (!present(relative) || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').includes('..'))
    throw new Error(`Unsafe review evidence path: ${relative}`);
  const root = await realpath(job), candidate = path.resolve(root, relative);
  if (!inside(root, candidate) || !inside(root, await realpath(candidate)) || !(await lstat(candidate)).isFile())
    throw new Error(`Review evidence must be a local file: ${relative}`);
  return candidate;
}

const validRange = (range, interval) => range && Number.isFinite(range.start) && Number.isFinite(range.end) &&
  range.start >= interval.start - 0.001 && range.end <= interval.end + 0.001 && range.end > range.start;

export function covers(ranges, interval) {
  let end = interval.start;
  for (const range of [...ranges].sort((a,b) => a.start - b.start)) {
    if (range.start > end + 0.05) return false;
    end = Math.max(end, range.end);
  }
  return end >= interval.end - 0.05;
}

export async function loadReviewPack(job, stage, {archivedPath, current = true} = {}) {
  reviewStage(stage);
  const relative = archivedPath || `review/${stage}/pack.json`;
  const file = await localFile(job, relative), bytes = await readFile(file);
  const pack = JSON.parse(bytes), manifest = await readJSON(path.join(job, 'job.json'));
  if (pack.version !== 1 || pack.stage !== stage || !hashPattern.test(pack.sourceHash || '') ||
      !hashPattern.test(pack.videoSha256 || '') || !Number.isFinite(pack.duration) || pack.duration <= 0 ||
      Math.abs(pack.duration - manifest.duration) > 0.12 ||
      !validRange(pack.interval, {start:0, end:pack.duration})) throw new Error('Invalid review pack metadata.');
  const span = pack.interval.end - pack.interval.start;
  if (stage === 'final' && (pack.interval.start !== 0 || Math.abs(pack.interval.end - pack.duration) > 0.001))
    throw new Error('Final review must cover the entire recording.');
  if (stage === 'prototype' && (span < Math.min(10, pack.duration) - 0.05 || span > 15.05))
    throw new Error('Prototype review must cover a demanding 10–15 seconds (or the entire shorter film).');
  if (!Array.isArray(pack.scenes) || !pack.scenes.length || pack.scenes.some(s => !present(s.id) || !validRange(s, pack.interval)) ||
      !covers(pack.scenes, pack.interval)) throw new Error('Review scene coverage is incomplete.');
  if (!Array.isArray(pack.evidence) || !pack.evidence.length) throw new Error('Review pack has no rendered evidence.');
  const paths = new Set();
  for (const item of pack.evidence) {
    if (!['frames','contact-sheet','clip','audio','verification','motion','checks','sound'].includes(item.kind) || paths.has(item.path) || !hashPattern.test(item.sha256 || '') ||
        !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.end < item.start || item.end > pack.duration + 0.12)
      throw new Error('Invalid or duplicate rendered evidence.');
    paths.add(item.path);
    if (await fileHash(await localFile(job, item.path)) !== item.sha256) throw new Error(`Review evidence changed: ${item.path}`);
  }
  for (const kind of ['frames', 'contact-sheet', 'clip', 'audio'])
    if (!pack.evidence.some(e => e.kind === kind)) throw new Error(`Review pack missing ${kind} evidence.`);
  if (!covers(pack.evidence.filter(e => e.kind === 'clip'), pack.interval)) throw new Error('Review clips do not cover the interval.');
  if (current) {
    if (pack.sourceHash !== await sourceFingerprint(job)) throw new Error('Review pack is stale: production sources changed. Render and review again.');
    if (pack.videoSha256 !== await fileHash(await localFile(job, 'renders/video.mp4'))) throw new Error('Review pack is stale: render changed.');
    const receipt = await readJSON(await localFile(job, 'review/render-source.json'));
    if (receipt.version !== 1 || receipt.sourceHash !== pack.sourceHash || receipt.videoSha256 !== pack.videoSha256)
      throw new Error('Render provenance is missing or stale. Render through the pipeline again.');
  }
  return {pack, packSha256:sha(bytes), relative};
}

export function validateReview(report, context, producerIds = ['/root']) {
  const {pack, packSha256} = context;
  if (report.version !== 1 || report.stage !== pack.stage || !REVIEW_ROLES.includes(report.role)) throw new Error('Invalid reviewer role or stage.');
  if (report.sourceHash !== pack.sourceHash || report.videoSha256 !== pack.videoSha256 || report.packSha256 !== packSha256)
    throw new Error('Reviewer report refers to a different source, render or evidence pack.');
  if (!present(report.reviewer?.agentId) || report.reviewer.independent !== true ||
      [...producerIds, 'root', '/root', 'orchestrator'].includes(report.reviewer.agentId))
    throw new Error('Review must come from an independent sub-agent, not the producer.');
  if (!['frame-sequence','playback','mixed'].includes(report.inspection?.mode) ||
      !Array.isArray(report.inspection.limitations) || report.inspection.limitations.some(v => !present(v)))
    throw new Error('Record the actual inspection mode and limitations.');
  if (report.inspection.mode === 'frame-sequence' && !report.inspection.limitations.length)
    throw new Error('Frame-sequence inspection must disclose the playback limitation.');
  if (report.role === 'narration-fidelity' && !['listened','signal-verified','unavailable'].includes(report.inspection.audio))
    throw new Error('Narration reviewer must record actual audio inspection capability.');
  if (report.role === 'narration-fidelity' && report.inspection.audio === 'signal-verified' && !report.inspection.limitations.length)
    throw new Error('Signal-only audio review must disclose its listening limitation.');
  if (report.role === 'visual-mechanism' && !present(report.initialObservation))
    throw new Error('Visual reviewer must record what the pictures explained before reading the narrative.');
  if (!Array.isArray(report.coverage) || report.coverage.some(r => !validRange(r, pack.interval))) throw new Error('Invalid reviewer coverage.');
  if (!Array.isArray(report.findings) || !['pass','revise','incomplete'].includes(report.verdict)) throw new Error('Invalid review findings or verdict.');
  if (!['viewed', 'unavailable'].includes(report.inspection.visual))
    throw new Error('Record inspection.visual as viewed or unavailable; a motion transcript is not visual inspection.');
  const visualPaths = new Set(pack.evidence.filter(e => ['frames', 'clip', 'contact-sheet'].includes(e.kind)).map(e => e.path));
  if (report.verdict === 'pass' && (report.inspection.visual !== 'viewed' ||
      !Array.isArray(report.inspection.evidence) || !report.inspection.evidence.length ||
      report.inspection.evidence.some(p => !visualPaths.has(p))))
    throw new Error('A passing review requires viewed images/video and inspected evidence paths from this pack.');
  const ids = new Set(), knownEvidence = new Set(pack.evidence.map(e => e.path));
  for (const finding of report.findings) {
    if (finding.scope != null && !['scene','plan','evidence'].includes(finding.scope)) throw new Error('Finding scope must be scene, plan or evidence.');
    if (finding.sceneIds != null && (!Array.isArray(finding.sceneIds) || finding.sceneIds.some(id=>typeof id!=='string'||!/^[a-z][a-z0-9-]*$/.test(id)))) throw new Error('Finding sceneIds must be scene identifiers.');
    if (!present(finding.id) || ids.has(finding.id) || !['blocking','advisory'].includes(finding.severity) ||
        !Number.isFinite(finding.start) || !Number.isFinite(finding.end) || finding.start < pack.interval.start ||
        finding.end < finding.start || finding.end > pack.interval.end ||
        ['subject','requirement','observed','repair'].some(k => !present(finding[k])) ||
        !Array.isArray(finding.evidence) || !finding.evidence.length || finding.evidence.some(p => !knownEvidence.has(p)))
      throw new Error('Each finding needs a unique ID, timestamp, observed defect, evidence and repair direction.');
    ids.add(finding.id);
  }
  if (report.verdict === 'pass' && (report.findings.some(f => f.severity === 'blocking') || !covers(report.coverage, pack.interval) ||
      (report.role === 'narration-fidelity' && report.inspection.audio === 'unavailable')))
    throw new Error('A passing review needs full coverage, audio evidence where required, and no blocking findings.');
  return report;
}

async function validateAudioEvidence(job, report, context) {
  if (report.role !== 'narration-fidelity' || report.inspection.audio !== 'signal-verified') return;
  const receipts = context.pack.evidence.filter(e => e.kind === 'verification');
  for (const evidence of receipts) {
    const receipt = await readJSON(await localFile(job,evidence.path));
    if (receipt.ok === true && receipt.sha256 === context.pack.videoSha256 && receipt.narrationIntegrity?.ok === true) return;
  }
  throw new Error('Signal-only review requires frozen technical evidence that the rendered narration matches the supplied recording.');
}

async function evaluate(job, context, directory) {
  const manifest = await readJSON(path.join(job, 'job.json'));
  const reports = [], errors = [];
  for (const role of REVIEW_ROLES) {
    try {
      const report = validateReview(await readJSON(await localFile(job, `${directory}/${role}.json`)), context,
        manifest.review?.producerAgentIds || ['/root']);
      await validateAudioEvidence(job,report,context);
      if (report.role !== role) throw new Error('Reviewer role does not match its file.');
      reports.push(report);
      if (report.verdict !== 'pass') errors.push(`${role}: ${report.verdict}`);
    } catch (error) {errors.push(`${role}: ${error.message}`);}
  }
  if (new Set(reports.map(r => r.reviewer.agentId)).size !== reports.length) errors.push('Each role needs a different independent reviewer.');
  return {ok:!errors.length, stage:context.pack.stage, sourceHash:context.pack.sourceHash,
    videoSha256:context.pack.videoSha256, packSha256:context.packSha256, errors, reports};
}

export async function submitReview(job, report) {
  reviewStage(report.stage);
  const context = await loadReviewPack(job, report.stage);
  const manifest = await readJSON(path.join(job, 'job.json'));
  validateReview(report, context, manifest.review?.producerAgentIds || ['/root']);
  await validateAudioEvidence(job,report,context);
  const relative = `review/${report.stage}/reviews/${report.role}.json`;
  await save(job, relative, report);
  // Preserve failures and revisions, even when a newer role report replaces one.
  const reportHash = sha(JSON.stringify(report));
  await save(job, `review/${report.stage}/history/${reportHash}.json`, report);
  const status = await reviewStatus(job, report.stage);
  return {accepted:true, path:relative, qualified:status.ok, errors:status.errors};
}

export async function reviewStatus(job, stage) {
  reviewStage(stage);
  let context;
  try {context = await loadReviewPack(job, stage);}
  catch (error) {return {ok:false,stage,errors:[error.message],reports:[]};}
  const status = await evaluate(job, context, `review/${stage}/reviews`);
  if (status.ok && stage === 'prototype') {
    const base = `review/prototype/accepted/${context.packSha256}`;
    await writeReviewFile(job,`${base}/pack.json`, await readFile(path.join(job,context.relative)));
    for (const role of REVIEW_ROLES) await writeReviewFile(job,`${base}/${role}.json`,
      await readFile(path.join(job,`review/prototype/reviews/${role}.json`)));
    await save(job,'review/prototype/accepted.json', {version:1,path:base,packSha256:context.packSha256,
      reports:Object.fromEntries(await Promise.all(REVIEW_ROLES.map(async role => [role, await fileHash(path.join(job,base,`${role}.json`))])))});
  }
  return status;
}

// The same evaluation as reviewStatus, without recording a prototype acceptance. Used by `status`.
export async function reviewProgress(job, stage) {
  reviewStage(stage);
  let context;
  try {context = await loadReviewPack(job, stage);}
  catch (error) {return {ok:false, stage, pack:false, missing:error.code === 'ENOENT', errors:[error.message], reports:[]};}
  return {...await evaluate(job, context, `review/${stage}/reviews`), pack:true, interval:context.pack.interval};
}

export async function acceptedPrototype(job) {
  const receipt = await readJSON(await localFile(job, 'review/prototype/accepted.json'));
  if (receipt.version !== 1 || !hashPattern.test(receipt.packSha256 || '') || receipt.path !== `review/prototype/accepted/${receipt.packSha256}`)
    throw new Error('Invalid prototype acceptance record.');
  const context = await loadReviewPack(job,'prototype',{archivedPath:`${receipt.path}/pack.json`,current:false});
  if (context.packSha256 !== receipt.packSha256) throw new Error('Accepted prototype pack changed.');
  for (const role of REVIEW_ROLES) if (await fileHash(await localFile(job,`${receipt.path}/${role}.json`)) !== receipt.reports?.[role])
    throw new Error('Accepted prototype review changed.');
  const status = await evaluate(job,context,receipt.path);
  if (!status.ok) throw new Error(`Prototype was not independently accepted: ${status.errors.join('; ')}`);
  return receipt;
}

export async function qualifyDelivery(job) {
  const prototype = await acceptedPrototype(job);
  const final = await reviewStatus(job,'final');
  if (!final.ok) throw new Error(`Independent final review failed: ${final.errors.join('; ')}`);
  const technical = await readJSON(await localFile(job,'review/render-verification.json'));
  if (technical.ok !== true || technical.sha256 !== final.videoSha256) throw new Error('Final technical verification is missing or stale.');
  const report = await readFile(await localFile(job,'review/REPORT.md'),'utf8');
  if (!report.trim() || /pending creative build and validation/i.test(report)) throw new Error('Complete the production report before delivery.');
  return {version:1,ok:true,sourceHash:final.sourceHash,videoSha256:final.videoSha256,
    packSha256:final.packSha256,prototypePackSha256:prototype.packSha256,
    reviewerIds:final.reports.map(r => r.reviewer.agentId),
    limitations:final.reports.flatMap(r => r.inspection.limitations),
    advisoryFindings:final.reports.flatMap(r => r.findings)};
}
