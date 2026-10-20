// Reviews of the built HTML (no render before the final review), the person's own review, and one render at the end.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {nextStep, buildFilm, jobProgress} from '../lib/film.mjs';
import {sourceFingerprint, fileHash, loadReviewPack, submitReview, qualifyDelivery, REVIEW_ROLES} from '../lib/review.mjs';
import {recordHumanReview, humanDecision, humanFindings, parseNote, parseStages} from '../lib/human.mjs';

const put = (job, file, value) => writeFile(path.join(job, file), JSON.stringify(value));
const read = async (job, file) => JSON.parse(await readFile(path.join(job, file), 'utf8'));

async function fixture(t, {human} = {}) {
  const job = await mkdtemp(path.join(os.tmpdir(), 'html-review-'));
  t.after(() => rm(job, {recursive: true, force: true}));
  for (const dir of ['shots', 'inputs', 'review', 'assets']) await mkdir(path.join(job, dir));
  const words = ['opening', 'comparison', 'ending'].map((text, i) => ({id: `w${i}`, text, start: i * 6, end: i * 6 + 1}));
  const manifest = {duration: 18, width: 1920, height: 1080, status: 'prepared', ...(human ? {humanReview: human} : {})};
  const film = {version: 2, title: 'Fixture', concept: 'A comparison', theme: {name: 'Test look', description: 'Chunky white outlines on a near-black stage,flat saturated fills,hard offset shadows and heavy display type for prices.', bg: '#101010', colors: {white: '#f0f0f0', grey: '#888888', dim: '#444444', faint: '#222222', blue: '#1488dd', yellow: '#ffd23f', red: '#e0342f', green: '#3fbf6f'}, meanings: {yellow: 'money'}},
    alternatives: [{concept: 'A', rejected: 'B'}, {concept: 'C', rejected: 'D'}], subjects: [{id: 'subject', what: 'Recurring subject'}], prototype: 'comparison',
    scenes: words.map((w, i) => ({id: w.text, start: i ? {phrase: w.text} : {boundary: 'start'}, idea: 'Idea', mechanism: 'Operation', states: ['initial', 'operation', 'consequence'], payoff: 'Result', camera: 'Static', handoff: 'Same subject', why_not_basic: 'Meaning', alternatives: ['Other'], carry: i ? ['subject'] : []}))};
  await put(job, 'job.json', manifest); await put(job, 'alignment.json', {matchRatio: 1, words}); await put(job, 'film.json', film);
  await writeFile(path.join(job, 'assets/narration.wav'), 'Synthetic narration fixture');
  for (const id of ['opening', 'comparison', 'ending'])
    await put(job, `shots/${id}.json`, {scene: id, objects: id === 'opening' ? [{id: 'subject', type: 'circle', at: [960, 540], r: 100}] : [], actions: []});
  return job;
}

// A synthetic html pack (what review-pack writes from the built film), then the three reviews.
async function htmlPack(job, stage, {start = 0, end = 18, verdict = 'pass'} = {}) {
  await mkdir(path.join(job, `review/${stage}`), {recursive: true});
  const sourceHash = await sourceFingerprint(job), evidence = [];
  for (const [name, kind] of [['frame.png', 'frames'], ['sheet.png', 'contact-sheet']]) {
    const file = `review/${stage}/${name}`; await writeFile(path.join(job, file), 'Synthetic evidence fixture');
    evidence.push({path: file, kind, start, end: kind === 'frames' ? start : end, sha256: await fileHash(path.join(job, file))});
  }
  evidence.push({path: 'assets/narration.wav', kind: 'audio', start: 0, end: 18, sha256: await fileHash(path.join(job, 'assets/narration.wav'))});
  await put(job, `review/${stage}/pack.json`, {version: 1, stage, source: 'html', sourceHash, videoSha256: null, duration: 18, interval: {start, end},
    scenes: [{id: 'opening', start: 0, end: 6}, {id: 'comparison', start: 6, end: 12}, {id: 'ending', start: 12, end: 18}].filter(s => s.end > start && s.start < end)
      .map(s => ({...s, start: Math.max(s.start, start), end: Math.min(s.end, end)})), evidence});
  const context = await loadReviewPack(job, stage);
  for (const role of REVIEW_ROLES) await submitReview(job, {version: 1, stage, role, sourceHash, videoSha256: null, packSha256: context.packSha256,
    reviewer: {agentId: `/fixture/${stage}-${role}`, independent: true},
    inspection: {mode: 'frame-sequence', visual: 'viewed', evidence: [evidence[0].path], limitations: ['Synthetic test judgment.'], ...(role === 'narration-fidelity' ? {audio: 'signal-verified'} : {})},
    initialObservation: 'Synthetic fixture', coverage: [{start, end}], verdict, findings: []});
  return context;
}

async function render(job, {integrity = true} = {}) {
  await mkdir(path.join(job, 'renders'), {recursive: true});
  await writeFile(path.join(job, 'renders/video.mp4'), 'Synthetic render fixture, not video');
  const videoSha256 = await fileHash(path.join(job, 'renders/video.mp4'));
  await put(job, 'review/render-source.json', {version: 1, sourceHash: await sourceFingerprint(job), videoSha256});
  await put(job, 'review/render-verification.json', {ok: true, sha256: videoSha256, narrationIntegrity: {ok: integrity}});
  await put(job, 'review/pixels.json', {ok: true, errors: []});
  await writeFile(path.join(job, 'review/REPORT.md'), 'Production report fixture.');
}

test('the prototype is reviewed from the built HTML: next never asks for a render before the final review', async t => {
  const job = await fixture(t);
  await buildFilm(job, {inspect: false, print: false});
  const first = await nextStep(job);
  assert.equal(first.state, 'review-pack prototype');
  assert.match(first.text, /no render/); assert.doesNotMatch(first.text, /video -- render/);
  await htmlPack(job, 'prototype', {start: 6, end: 16});
  // The third passing report accepts the prototype; next moves straight on to the rest of the film.
  assert.equal((await nextStep(job)).state, 'review-pack final');
  // The full film: built, reviewed from HTML, and only then rendered once.
  await buildFilm(job, {inspect: false, print: false});
  assert.equal((await nextStep(job)).state, 'review-pack final');
  await htmlPack(job, 'final');
  const step = await nextStep(job);
  assert.equal(step.state, 'render'); assert.match(step.text, /--reuse-build true/);
  assert.equal((await jobProgress(job)).current, 'final-render');
  assert.ok(!(await jobProgress(job)).steps.some(s => s.id === 'prototype-render'));
  await assert.rejects(qualifyDelivery(job), /final render is missing/);
  await render(job);
  assert.equal((await nextStep(job)).state, 'deliver');
  const qualification = await qualifyDelivery(job);
  assert.equal(qualification.videoSha256, await fileHash(path.join(job, 'renders/video.mp4')));
});

test('delivery needs the render of exactly the reviewed sources, with narration that matches', async t => {
  const job = await fixture(t);
  await buildFilm(job, {inspect: false, print: false});
  await htmlPack(job, 'prototype', {start: 6, end: 16}); await nextStep(job);
  await buildFilm(job, {inspect: false, print: false});
  await htmlPack(job, 'final');
  await render(job, {integrity: false});
  await assert.rejects(qualifyDelivery(job), /narration does not match/);
  await render(job);
  await writeFile(path.join(job, 'renders/video.mp4'), 'Edited after rendering');
  await assert.rejects(qualifyDelivery(job), /changed after it was made/);
  await render(job);
  await writeFile(path.join(job, 'shots/ending.json'), JSON.stringify({scene: 'ending', objects: [], actions: [], notes: 'changed'}));
  await assert.rejects(qualifyDelivery(job), /stale/);
});

test('the person reviews after the reviewers pass; their notes become repairs word for word', async t => {
  const job = await fixture(t, {human: ['prototype']});
  await buildFilm(job, {inspect: false, print: false});
  const pack = await htmlPack(job, 'prototype', {start: 6, end: 16});
  const waiting = await nextStep(job);
  assert.equal(waiting.state, 'human review prototype');
  assert.match(waiting.text, /checkpoint \{kind: "prototype"/); assert.match(waiting.text, /Never decide for them/);
  assert.equal((await jobProgress(job)).current, 'prototype-human');
  // Not accepted until the person decides.
  assert.equal((await nextStep(job)).state, 'human review prototype');
  await assert.rejects(recordHumanReview(job, {stage: 'prototype', decision: 'revise'}), /at least one note/);
  const record = await recordHumanReview(job, {stage: 'prototype', decision: 'revise', notes: [parseNote('3: The bar should be red, not blue'), parseNote('Slower overall')]});
  assert.equal(record.notes[0].start, 3, 'a note on the introduction keeps its moment');
  assert.equal(record.packSha256, pack.packSha256);
  const repair = await nextStep(job);
  assert.equal(repair.state, 'repair'); assert.match(repair.text, /from your review/);
  const brief = await readFile(path.join(job, 'briefs/repair-director.md'), 'utf8');
  assert.match(brief, /### opening[\s\S]*The bar should be red, not blue/); assert.match(brief, /Slower overall/);
  // The repaired film is a new pack: the old decision no longer counts.
  await writeFile(path.join(job, 'shots/comparison.json'), JSON.stringify({scene: 'comparison', objects: [], actions: [], notes: 'repaired'}));
  await buildFilm(job, {inspect: false, print: false});
  const second = await htmlPack(job, 'prototype', {start: 6, end: 16});
  assert.equal(await humanDecision(job, 'prototype', second.packSha256), null);
  assert.equal((await nextStep(job)).state, 'human review prototype');
  await recordHumanReview(job, {stage: 'prototype', decision: 'approve'});
  assert.equal((await nextStep(job)).state, 'review-pack final');
});

test('the final human review comes before the one render', async t => {
  const job = await fixture(t, {human: ['final']});
  await buildFilm(job, {inspect: false, print: false});
  await htmlPack(job, 'prototype', {start: 6, end: 16});
  assert.equal((await nextStep(job)).state, 'review-pack final', 'only the stages asked for wait');
  await buildFilm(job, {inspect: false, print: false});
  await htmlPack(job, 'final');
  assert.equal((await nextStep(job)).state, 'human review final');
  await recordHumanReview(job, {stage: 'final', decision: 'approve'});
  assert.equal((await nextStep(job)).state, 'render');
});

test('human review settings and notes parse strictly, and the setting is not a production source', async t => {
  assert.deepEqual(parseStages('prototype,final'), ['prototype', 'final']);
  assert.deepEqual(parseStages('none'), []);
  assert.throws(() => parseStages('script'), /prototype, final/);
  assert.deepEqual(parseNote('12.5-14: make it red'), {start: 12.5, end: 14, text: 'make it red'});
  assert.deepEqual(parseNote('just slower'), {text: 'just slower'});
  const job = await fixture(t), before = await sourceFingerprint(job);
  const manifest = await read(job, 'job.json'); await put(job, 'job.json', {...manifest, humanReview: ['final']});
  assert.equal(await sourceFingerprint(job), before);
  const findings = humanFindings({notes: [{start: null, end: null, sceneIds: [], text: 'Whole thing'}]}, {interval: {start: 0, end: 18}, scenes: [{id: 'opening'}, {id: 'ending'}]});
  assert.deepEqual(findings[0].sceneIds, ['opening', 'ending']);
});
