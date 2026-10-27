import {readFile, writeFile, mkdir, readdir, lstat, realpath, rename, stat, open, unlink} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {readPersonality} from './personalities.mjs';

export const MAX_REVIEW_ROUNDS = 3;
export const REVIEW_ROLES = ['visual-mechanism', 'narration-fidelity', 'continuity-legibility'];
const stages = ['final'];
const sha = value => createHash('sha256').update(value).digest('hex');
const readJSON = async file => JSON.parse(await readFile(file, 'utf8'));
const present = value => typeof value === 'string' && value.trim().length > 0;
const hashPattern = /^[a-f0-9]{64}$/;
const inside = (root, target) => target.startsWith(root + path.sep);
const rangesCover = (ranges, start, end) => {
  let cursor = start;
  for (const range of [...ranges].filter(r => Number.isFinite(r.start) && Number.isFinite(r.end)).sort((a,b)=>a.start-b.start)) {
    if (range.start > cursor + 0.035) return false;
    cursor = Math.max(cursor, range.end);
    if (cursor >= end - 0.035) return true;
  }
  return cursor >= end - 0.035;
};
const rangesCoverStrict = (ranges, start, end) => {
  let cursor = start;
  for (const range of [...ranges].filter(r => Number.isFinite(r.start) && Number.isFinite(r.end)).sort((a,b)=>a.start-b.start)) {
    if (range.start > cursor + 0.001) return false;
    cursor = Math.max(cursor, range.end);
    if (cursor >= end - 0.001) return true;
  }
  return cursor >= end - 0.001;
};
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
  if (stage === 'prototype') throw new Error('Prototype review is retired; every film has one independent final review of the complete picture.');
  if (!stages.includes(stage)) throw new Error('Review stage must be final.');
  return stage;
}

// Producer IDs are the runner-provided identity and role, recorded on the job
// before a producing role executes. The harness does not cryptographically
// authenticate these values; this records what the runner supplied.
export async function registerProducer(job, {agentId, role} = {}) {
  const file = path.join(job, 'job.json'), lock = path.join(job, '.producer-registry.lock');
  let handle;
  for (let attempt=0; attempt<500; attempt++) {
    try { handle = await open(lock, 'wx'); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const owner = Number((await readFile(lock, 'utf8')).trim());
        if (Number.isInteger(owner) && owner > 0) {
          try { process.kill(owner, 0); }
          catch (probe) { if (probe.code === 'ESRCH') await unlink(lock); }
        } else if (Date.now() - (await stat(lock)).mtimeMs > 120000) await unlink(lock);
      } catch (cleanup) { if (cleanup.code !== 'ENOENT') throw cleanup; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  if (!handle) throw new Error('Timed out recording producer identity; retry the production command.');
  try {
  await handle.writeFile(String(process.pid));
  const manifest = await readJSON(file);
  manifest.review ||= {};
  manifest.review.producerAgentIds ||= [];
  manifest.review.producerAgentRecords ||= [];
  if (!present(agentId) || !present(role) || role === 'reviewer' || role.endsWith('-reviewer')) {
    manifest.review.producerIdentityStatus = 'incomplete';
    manifest.review.producerIdentityIssue = 'A producing command ran without a runner-provided agent ID and role.';
  } else {
    if (!manifest.review.producerAgentIds.includes(agentId)) manifest.review.producerAgentIds.push(agentId);
    if (!manifest.review.producerAgentRecords.some(r => r.agentId === agentId && r.role === role))
      manifest.review.producerAgentRecords.push({agentId, role, recordedAt: new Date().toISOString(), source: 'VIDEO_AGENT_ID/VIDEO_AGENT_ROLE'});
    if (manifest.review.producerIdentityStatus !== 'incomplete') {
      manifest.review.producerIdentityStatus = 'recorded';
      delete manifest.review.producerIdentityIssue;
    }
  }
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
  } finally { await handle.close(); await unlink(lock).catch(() => {}); }
}

function producerIds(manifest) {
  const review = manifest.review || {};
  if (review.producerIdentityStatus === 'incomplete' || (review.producerIdentityStatus === 'unrecorded' && !review.producerAgentRecords?.length) || !Array.isArray(review.producerAgentIds) || !review.producerAgentIds.length ||
      (review.producerAgentIds.length === 1 && review.producerAgentIds[0] === '/root' && !review.producerAgentRecords?.length))
    throw new Error('Producer identities are incomplete for this existing job; independence cannot be established. Record the producing agents from reliable history before review.');
  return review.producerAgentIds;
}

// Review records and render caches are deliberately outside the source digest.
// Actual inputs, fonts, assets, code, cue files and project config are included.
export async function sourceFingerprint(job) {
  // index.cut.html was a short copy of index.html written only for the retired prototype render. It stays excluded so
  // old jobs keep the same source fingerprint. thumbnail/ is made
  // after delivery and is not part of the film; hashing it made a delivered film look stale.
  const excluded = new Set(['node_modules', '.git', '.hyperframes', '.cache', 'review', 'renders', 'library-candidates', 'briefs', 'thumbnail', 'index.cut.html']);
  const entries = [];
  async function walk(dir, prefix = '') {
    for (const entry of (await readdir(dir, {withFileTypes: true})).sort((a,b) => a.name.localeCompare(b.name))) {
      if (!prefix && excluded.has(entry.name)) continue;
      const rel = prefix + entry.name, file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Production sources must be frozen local files, not symlinks: ${rel}`);
      if (entry.isDirectory()) await walk(file, rel + '/');
      else if (entry.isFile()) {
        if (rel === 'job.json') {
          const {status, completedAt, delivery, reviewRounds, reviewRoundPacks, reviewPlanRevision, humanReview, ...config} = await readJSON(file);
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
  // An html pack is frozen from the built timeline before any render (videoSha256 null); older packs come from the MP4.
  const html = pack.source === 'html';
  if (stage === 'final' && readPersonality(job).profile.id === 'app-review' && html)
    throw new Error('Final app-review evidence must represent the encoded render, not the seekable HTML build. Render and verify, then recreate the final pack with --from render.');
  if (pack.version !== 1 || pack.stage !== stage || !hashPattern.test(pack.sourceHash || '') ||
      (html ? pack.videoSha256 !== null : !hashPattern.test(pack.videoSha256 || '')) || !Number.isFinite(pack.duration) || pack.duration <= 0 ||
      Math.abs(pack.duration - manifest.duration) > 0.12 ||
      !validRange(pack.interval, {start:0, end:pack.duration})) throw new Error('Invalid review pack metadata.');
  if (pack.interval.start !== 0 || Math.abs(pack.interval.end - pack.duration) > 0.001)
    throw new Error('Final review must cover the entire recording.');
  if (!Array.isArray(pack.scenes) || !pack.scenes.length || pack.scenes.some(s => !present(s.id) || !validRange(s, pack.interval)) ||
      !covers(pack.scenes, pack.interval)) throw new Error('Review scene coverage is incomplete.');
  if (!Array.isArray(pack.evidence) || !pack.evidence.length) throw new Error('Review pack has no rendered evidence.');
  const paths = new Set();
  for (const item of pack.evidence) {
    if (!['frames','contact-sheet','clip','audio','verification','motion','checks','sound','capture-visibility-frame','capture-omissions'].includes(item.kind) || paths.has(item.path) || !hashPattern.test(item.sha256 || '') ||
        !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.end < item.start || item.end > pack.duration + 0.12)
      throw new Error('Invalid or duplicate rendered evidence.');
    paths.add(item.path);
    if (await fileHash(await localFile(job, item.path)) !== item.sha256) throw new Error(`Review evidence changed: ${item.path}`);
  }
  for (const kind of ['frames', 'contact-sheet', 'audio', ...(html ? [] : ['clip'])])
    if (!pack.evidence.some(e => e.kind === kind)) throw new Error(`Review pack missing ${kind} evidence.`);
  if (!html && !covers(pack.evidence.filter(e => e.kind === 'clip'), pack.interval)) throw new Error('Review clips do not cover the interval.');
  if (current && html) {
    if (pack.sourceHash !== await sourceFingerprint(job)) throw new Error('Review pack is stale: production sources changed. Build and review again.');
  } else if (current) {
    if (pack.sourceHash !== await sourceFingerprint(job)) throw new Error('Review pack is stale: production sources changed. Render and review again.');
    if (pack.videoSha256 !== await fileHash(await localFile(job, 'renders/video.mp4'))) throw new Error('Review pack is stale: render changed.');
    const receipt = await readJSON(await localFile(job, 'review/render-source.json'));
    if (receipt.version !== 1 || receipt.sourceHash !== pack.sourceHash || receipt.videoSha256 !== pack.videoSha256)
      throw new Error('Render provenance is missing or stale. Render through the pipeline again.');
  }
  return {pack, packSha256:sha(bytes), relative, personality: readPersonality(job).profile.id};
}

// Every problem in one pass, each with the field it concerns, so a reviewer fixes the report in one edit.
export function validateReview(report, context, producerIds = ['/root'], authenticated = null) {
  const {pack, packSha256} = context;
  const errors = [];
  const fail = (field, message) => errors.push(`${field}: ${message}`);
  if (report.version !== 1 || report.stage !== pack.stage || !REVIEW_ROLES.includes(report.role))
    fail('version/stage/role', `Invalid reviewer role or stage (expected version 1, stage "${pack.stage}", role one of ${REVIEW_ROLES.join(', ')}).`);
  if (report.sourceHash !== pack.sourceHash || report.videoSha256 !== pack.videoSha256 || report.packSha256 !== packSha256)
    fail('sourceHash/videoSha256/packSha256', 'Reviewer report refers to a different source, render or evidence pack. Run review-template again for the current pack.');
  if (!present(report.reviewer?.agentId) || report.reviewer.independent !== true ||
      [...producerIds, 'root', '/root', 'orchestrator'].includes(report.reviewer.agentId))
    fail('reviewer', 'Review must come from an independent sub-agent, not the producer (set reviewer.agentId to your own id and reviewer.independent to true).');
  if (authenticated && (authenticated.role !== 'reviewer' || report.reviewer?.agentId !== authenticated.agentId))
    fail('reviewer', 'Reviewer identity must match VIDEO_AGENT_ID and VIDEO_AGENT_ROLE=reviewer.');
  const inspection = report.inspection && typeof report.inspection === 'object' ? report.inspection : {};
  if (!['frame-sequence','playback','mixed'].includes(inspection.mode))
    fail('inspection.mode', 'Record the actual inspection mode and limitations: frame-sequence, playback or mixed.');
  const limitations = Array.isArray(inspection.limitations) ? inspection.limitations : null;
  if (!limitations || limitations.some(v => !present(v)))
    fail('inspection.limitations', 'Record the actual inspection mode and limitations as a list of non-empty strings.');
  else if (inspection.mode === 'frame-sequence' && !limitations.length)
    fail('inspection.limitations', 'Frame-sequence inspection must disclose the playback limitation.');
  if (report.role === 'narration-fidelity' && !['listened','signal-verified','unavailable'].includes(inspection.audio))
    fail('inspection.audio', 'Narration reviewer must record actual audio inspection capability: listened, signal-verified or unavailable.');
  if (report.role === 'narration-fidelity' && inspection.audio === 'signal-verified' && !limitations?.length)
    fail('inspection.limitations', 'Signal-only audio review must disclose its listening limitation.');
  if (report.role === 'visual-mechanism' && !present(report.initialObservation))
    fail('initialObservation', 'Visual reviewer must record what the pictures explained before reading the narrative.');
  const coverage = Array.isArray(report.coverage) ? report.coverage : null;
  if (!coverage) fail('coverage', 'Invalid reviewer coverage: give a list of {start, end} ranges you inspected.');
  else coverage.forEach((r, i) => { if (!validRange(r, pack.interval)) fail(`coverage[${i}]`, `Invalid reviewer coverage: start/end must be numbers within ${pack.interval.start}–${pack.interval.end} s.`); });
  if (!['pass','revise','incomplete'].includes(report.verdict)) fail('verdict', 'Invalid review findings or verdict: verdict must be pass, revise or incomplete.');
  if (!['viewed', 'unavailable'].includes(inspection.visual))
    fail('inspection.visual', 'Record inspection.visual as viewed or unavailable; a motion transcript is not visual inspection.');
  const visualPaths = new Set(pack.evidence.filter(e => ['frames', 'clip', 'contact-sheet'].includes(e.kind)).map(e => e.path));
  if (report.verdict === 'pass' && (inspection.visual !== 'viewed' ||
      !Array.isArray(inspection.evidence) || !inspection.evidence.length ||
      inspection.evidence.some(p => !visualPaths.has(p))))
    fail('inspection.evidence', `A passing review requires viewed images/video and inspected evidence paths from this pack${Array.isArray(inspection.evidence) ? ` (not in the pack: ${inspection.evidence.filter(p => !visualPaths.has(p)).join(', ') || 'none'})` : ''}.`);
  if (context.personality === 'app-review' && pack.stage === 'final' && report.verdict === 'pass' &&
      (inspection.mode === 'frame-sequence' || !inspection.evidence?.some(p => pack.evidence.some(e => e.kind === 'clip' && e.path === p))))
    fail('inspection.mode/evidence', 'A passing final app review must inspect at least one encoded MP4 clip in playback (mode playback or mixed); frame-sequence-only review cannot verify continuous app motion. If playback is unavailable, disclose that limitation and do not claim motion verification.');
  if (context.personality === 'app-review' && pack.stage === 'final' && report.verdict === 'pass') {
    const clips = pack.evidence.filter(e => e.kind === 'clip' && inspection.evidence?.includes(e.path));
    if (report.inspection?.playbackAssertion !== 'reviewer-asserted-not-authenticated')
      fail('inspection.playbackAssertion', 'Record playback honestly as reviewer-asserted-not-authenticated; the pipeline cannot authenticate that a reviewer actually watched the clips.');
    const gaps = (pack.scenes || []).filter(scene => !rangesCoverStrict(clips, scene.start, scene.end));
    if (gaps.length) fail('inspection.evidence', `Passing app review requires selected encoded playback clips covering every scene and handoff interval; uncovered: ${gaps.map(s=>s.id).join(', ')}.`);
    if (!rangesCoverStrict(clips, pack.interval.start, pack.interval.end))
      fail('inspection.evidence', 'Passing app review requires encoded playback evidence covering the full assigned interval, including transitions.');
    for (const capture of pack.appCaptureIntervals || []) if (!rangesCoverStrict(clips, capture.start, capture.end))
      fail('inspection.evidence', `Passing app review requires encoded playback clips covering app capture ${capture.id} (${capture.start}–${capture.end}s).`);
  }
  const findings = Array.isArray(report.findings) ? report.findings : null;
  if (!findings) fail('findings', 'Invalid review findings or verdict: findings must be a list (empty when there are none).');
  const ids = new Set(), knownEvidence = new Set(pack.evidence.map(e => e.path));
  for (const [i, finding] of (findings || []).entries()) {
    const at = `findings[${i}]${present(finding?.id) ? ` (${finding.id})` : ''}`;
    if (!finding || typeof finding !== 'object') { fail(at, 'Each finding must be an object.'); continue; }
    if (finding.category != null && !['readability','truth','mechanism','style','evidence'].includes(finding.category)) fail(`${at}.category`, 'Finding category must be readability, truth, mechanism, style or evidence.');
    if (finding.scope != null && !['scene','plan','evidence'].includes(finding.scope)) fail(`${at}.scope`, 'Finding scope must be scene, plan or evidence.');
    if (finding.sceneIds != null && (!Array.isArray(finding.sceneIds) || finding.sceneIds.some(id=>typeof id!=='string'||!/^[a-z][a-z0-9-]*$/.test(id)))) fail(`${at}.sceneIds`, 'Finding sceneIds must be scene identifiers.');
    const problems = [];
    if (!present(finding.id)) problems.push('id is missing');
    else if (ids.has(finding.id)) problems.push(`id "${finding.id}" is used twice`);
    if (!['blocking','advisory'].includes(finding.severity)) problems.push('severity must be blocking or advisory');
    if (!Number.isFinite(finding.start) || !Number.isFinite(finding.end) || finding.start < pack.interval.start ||
        finding.end < finding.start || finding.end > pack.interval.end) problems.push(`start/end must be numbers within ${pack.interval.start}–${pack.interval.end} s`);
    const empty = ['subject','requirement','observed','repair'].filter(k => !present(finding[k]));
    if (empty.length) problems.push(`${empty.join(', ')} must be filled in`);
    if (!Array.isArray(finding.evidence) || !finding.evidence.length) problems.push('evidence must list pack paths');
    else { const unknown = finding.evidence.filter(p => !knownEvidence.has(p)); if (unknown.length) problems.push(`evidence not in the pack: ${unknown.join(', ')}`); }
    if (problems.length) fail(at, `Each finding needs a unique ID, timestamp, observed defect, evidence and repair direction (${problems.join('; ')}).`);
    if (present(finding.id)) ids.add(finding.id);
  }
  if (report.verdict === 'pass' && ((findings || []).some(f => f?.severity === 'blocking') || !coverage || !covers(coverage, pack.interval) ||
      (report.role === 'narration-fidelity' && inspection.audio === 'unavailable')))
    fail('verdict', 'A passing review needs full coverage, audio evidence where required, and no blocking findings.');
  if (errors.length) throw new Error(errors.length === 1 ? errors[0] : `The report has ${errors.length} problems; fix them all, then submit again:\n- ${errors.join('\n- ')}`);
  return report;
}

async function validateAudioEvidence(job, report, context) {
  if (report.role !== 'narration-fidelity' || report.inspection.audio !== 'signal-verified') return;
  // Before a render the narration in the pack is the prepared recording itself (its hash is frozen in the pack); the
  // final render's narration is checked against it before delivery (render-verification.json).
  if (context.pack.source === 'html') return;
  const receipts = context.pack.evidence.filter(e => e.kind === 'verification');
  for (const evidence of receipts) {
    const receipt = await readJSON(await localFile(job,evidence.path));
    if (receipt.ok === true && receipt.sha256 === context.pack.videoSha256 && receipt.narrationIntegrity?.ok === true) return;
  }
  throw new Error('Signal-only review requires frozen technical evidence that the rendered narration matches the supplied recording.');
}

export function isReadabilityBlocker(finding) {
  return finding.severity === 'blocking' && (finding.category === 'readability' ||
    /overlap|obscur|unreadab|illegib|occlud|collid|cut.off|cropp|hidden.{0,20}(text|label|number)/i.test(`${finding.subject || ''} ${finding.observed || ''}`));
}

async function evaluate(job, context, directory) {
  const manifest = await readJSON(path.join(job, 'job.json'));
  const reports = [], errors = [];
  let producers;
  try { producers = producerIds(manifest); }
  catch (error) { return {ok:false, independentPassed:false, continued:false, nonWaivableFindings:[], waiver:null,
    disposition:'pending', stage:context.pack.stage, sourceHash:context.pack.sourceHash,
    videoSha256:context.pack.videoSha256, packSha256:context.packSha256, errors:[error.message], reports}; }
  for (const role of REVIEW_ROLES) {
    try {
      const saved = await readJSON(await localFile(job, `${directory}/${role}.json`));
      if (readPersonality(job).profile.id === 'app-review' && (saved.authenticatedReviewer?.role !== 'reviewer' || saved.authenticatedReviewer?.agentId !== saved.reviewer?.agentId))
        throw new Error('Reviewer identity was not authenticated by the runner at submission.');
      const report = validateReview(saved, context, producers, readPersonality(job).profile.id === 'app-review' ? saved.authenticatedReviewer : null);
      await validateAudioEvidence(job,report,context);
      if (report.role !== role) throw new Error('Reviewer role does not match its file.');
      reports.push(report);
      if (report.verdict !== 'pass') errors.push(`${role}: ${report.verdict}`);
    } catch (error) {errors.push(`${role}: ${error.message}`);}
  }
  if (new Set(reports.map(r => r.reviewer.agentId)).size !== reports.length) errors.push('Each role needs a different independent reviewer.');
  // A complete, valid inspection may finish with disclosed creative defects after
  // three rounds. Missing/stale evidence, invalid reports and unavailable inspection
  // remain errors; the fallback never manufactures a passing reviewer verdict.
  const independentPassed = !errors.length;
  const exhausted = (manifest.reviewRounds?.[context.pack.stage] || 0) >= MAX_REVIEW_ROUNDS;
  const complete = reports.length === REVIEW_ROLES.length &&
    new Set(reports.map(r => r.reviewer.agentId)).size === REVIEW_ROLES.length &&
    reports.every(r => r.verdict !== 'incomplete' && r.inspection.visual === 'viewed' &&
      r.inspection.evidence?.length && r.inspection.evidence.every(p => context.pack.evidence.some(e =>
        ['frames','contact-sheet','clip'].includes(e.kind) && e.path === p)) &&
      covers(r.coverage, context.pack.interval) &&
      (r.role !== 'narration-fidelity' || r.inspection.audio !== 'unavailable'));
  const nonWaivableFindings = reports.flatMap(report => report.findings.filter(isReadabilityBlocker).map(finding => ({...finding,role:report.role})));
  const continued = !independentPassed && exhausted && complete && !nonWaivableFindings.length;
  // The person may stop review of exactly this pack (`review-waive`); it never counts as an independent pass.
  const waiver = !independentPassed && !continued && directory === `review/${context.pack.stage}/reviews` ? await currentWaiver(job, context) : null;
  return {ok:independentPassed || continued || Boolean(waiver), independentPassed, continued, nonWaivableFindings, waiver,
    disposition: waiver ? 'waived-by-user' : continued ? 'review-limit-reached' : independentPassed ? 'passed' : 'pending',
    stage:context.pack.stage, sourceHash:context.pack.sourceHash,
    videoSha256:context.pack.videoSha256, packSha256:context.packSha256, errors, reports};
}

async function currentWaiver(job, context) {
  const waiver = await readJSON(path.join(job, `review/${context.pack.stage}/waiver.json`)).catch(() => null);
  return waiver?.version === 1 && waiver.by === 'user' && waiver.sourceHash === context.pack.sourceHash && waiver.packSha256 === context.packSha256 ? waiver : null;
}

// The person's decision to stop creative review and continue with the current sources. Bound to the current pack, so any
// change to the film needs review (or a new waiver) again. The unresolved findings are kept for delivery.json.
export async function waiveReview(job, stage, reason) {
  reviewStage(stage);
  if (!present(reason)) throw new Error('Give the reason the person stopped the review (--reason "...").');
  const context = await loadReviewPack(job, stage);
  const status = await evaluate(job, context, `review/${stage}/reviews`);
  if (status.independentPassed || status.continued) throw new Error(`The ${stage} review already qualifies (${status.disposition}); there is nothing to waive.`);
  const manifest = await readJSON(path.join(job, 'job.json'));
  const waiver = {version:1, by:'user', stage, reason:String(reason).trim(), at:new Date().toISOString(),
    sourceHash:context.pack.sourceHash, packSha256:context.packSha256, rounds:manifest.reviewRounds?.[stage] || 0,
    reviewErrors:status.errors,
    unresolvedFindings:status.reports.flatMap(r => r.findings.filter(f => f.severity === 'blocking').map(f => ({...f, role:r.role})))};
  await save(job, `review/${stage}/waiver.json`, waiver);
  return waiver;
}

export async function submitReview(job, report, authenticated = null) {
  reviewStage(report.stage);
  const context = await loadReviewPack(job, report.stage);
  const manifest = await readJSON(path.join(job, 'job.json'));
  const appReview = readPersonality(job).profile.id === 'app-review';
  validateReview(report, context, appReview ? producerIds(manifest) : manifest.review?.producerAgentIds || ['/root'], appReview ? authenticated : null);
  await validateAudioEvidence(job,report,context);
  if (appReview && authenticated) report.authenticatedReviewer = {agentId: authenticated.agentId, role: authenticated.role};
  const history = await reviewHistory(job, report.stage);
  const previous = history.filter(r => r.role === report.role && r.sourceHash !== report.sourceHash).at(-1);
  for (const finding of previous?.findings.filter(f => f.severity === 'blocking') || []) {
    const response = report.priorFindingResponses?.find(r => r.sourceHash === previous.sourceHash && r.findingId === finding.id);
    if (!response || !['resolved','unresolved','disputed'].includes(response.disposition) ||
        !present(response.reason) || response.reason.includes('FILL-IN'))
      throw new Error(`Respond to prior blocking finding ${finding.id} in priorFindingResponses with sourceHash, findingId, disposition and evidence-based reason.`);
  }
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
  return evaluate(job, context, `review/${stage}/reviews`);
}

// The same evaluation as reviewStatus, without any acceptance side effect. Used by `status`.
export async function reviewProgress(job, stage) {
  reviewStage(stage);
  let context;
  try {context = await loadReviewPack(job, stage);}
  catch (error) {return {ok:false, stage, pack:false, missing:error.code === 'ENOENT', errors:[error.message], reports:[]};}
  return {...await evaluate(job, context, `review/${stage}/reviews`), pack:true, interval:context.pack.interval};
}

export async function qualifyDelivery(job) {
  const {requireNewsDelivery} = await import('./news.mjs');
  await requireNewsDelivery(job);
  const final = await reviewStatus(job,'final');
  if (!final.ok) throw new Error(`Independent final review failed: ${final.errors.join('; ')}`);
  // Reviews of the built HTML qualify the render made from exactly those sources.
  let videoSha256 = final.videoSha256;
  if (videoSha256 === null) {
    const receipt = await localFile(job,'review/render-source.json').then(readJSON).catch(() => null);
    if (!receipt || receipt.version !== 1 || receipt.sourceHash !== final.sourceHash)
      throw new Error('The final render is missing or was not made from the reviewed sources. Render again.');
    videoSha256 = await fileHash(await localFile(job,'renders/video.mp4'));
    if (receipt.videoSha256 !== videoSha256) throw new Error('The final render changed after it was made. Render again.');
  }
  const technical = await readJSON(await localFile(job,'review/render-verification.json'));
  if (technical.ok !== true || technical.sha256 !== videoSha256) throw new Error('Final technical verification is missing or stale.');
  if (final.videoSha256 === null && technical.narrationIntegrity?.ok !== true)
    throw new Error('The rendered narration does not match the reviewed recording (render-verification.json).');
  const report = await readFile(await localFile(job,'review/REPORT.md'),'utf8');
  if (!report.trim() || /pending creative build and validation/i.test(report)) throw new Error('Complete the production report before delivery.');
  return {version:1,ok:true,sourceHash:final.sourceHash,videoSha256,
    packSha256:final.packSha256,
    reviewerIds:final.reports.map(r => r.reviewer.agentId),
    limitations:final.reports.flatMap(r => r.inspection.limitations),
    independentReviewPassed:final.independentPassed,
    reviewDisposition:final.waiver ? 'waived-by-user' : final.continued ? 'review-limit-reached' : 'passed',
    ...(final.waiver ? {reviewWaiver:{by:final.waiver.by, reason:final.waiver.reason, at:final.waiver.at, rounds:final.waiver.rounds, reviewErrors:final.waiver.reviewErrors}} : {}),
    unresolvedFindings:final.reports.flatMap(r => r.findings.filter(f => f.severity === 'blocking').map(f => ({...f, stage:r.stage, role:r.role}))),
    advisoryFindings:final.reports.flatMap(r => r.findings.filter(f => f.severity === 'advisory'))};
}

// Carry prior decisions into fresh reviewers without replacing their inspection.
export async function reviewHistory(job, stage) {
  const directory = path.join(job, `review/${stage}/history`);
  const files = await readdir(directory).catch(() => []);
  const entries = await Promise.all(files.filter(f => f.endsWith('.json')).map(async file => {
    const report = await readJSON(path.join(directory, file));
    const {mtimeMs} = await stat(path.join(directory, file));
    return {report, mtimeMs};
  }));
  const latest = new Map();
  for (const {report} of entries.sort((a,b) => a.mtimeMs - b.mtimeMs)) {
    latest.set(`${report.sourceHash}:${report.role}`, report);
  }
  return [...latest.values()].map(r => ({sourceHash:r.sourceHash, role:r.role, verdict:r.verdict,
    findings:r.findings, priorFindingResponses:r.priorFindingResponses || []}));
}
