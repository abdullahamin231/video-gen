import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReviewPack} from '../lib/review-pack.mjs';
import {sourceFingerprint, loadReviewPack} from '../lib/review.mjs';

const exec = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let available = true;
try { await exec('ffmpeg', ['-version']); await exec('ffprobe', ['-version']); }
catch { available = false; }
async function fixture(t, {videoDuration = 3, videoFps = 30} = {}) {
  const job = await mkdtemp(path.join(tmpdir(), 'review-pack-'));
  t.after(() => rm(job, {recursive: true, force: true}));
  for (const folder of ['assets', 'renders', 'review', 'compositions']) await mkdir(path.join(job, folder));
  await writeFile(path.join(job, 'job.json'), JSON.stringify({duration: 3, width: 320, height: 180, fps: 30}));
  await writeFile(path.join(job, 'timing.json'), JSON.stringify({duration: 3, scenes: [
    {id: 'opening', start: 0, end: 1.5, beats: [{id: 'change', at: 0.8}]},
    {id: 'payoff', start: 1.5, end: 3, beats: [{id: 'effect', at: 2}]}]}));
  await writeFile(path.join(job, 'compositions/opening.html'), '<p>Operating subject</p>');
  await exec('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=s=320x180:r=${videoFps}:d=${videoDuration}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${videoDuration}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', path.join(job, 'renders/video.mp4')]);
  await exec('ffmpeg', ['-v', 'error', '-i', path.join(job, 'renders/video.mp4'), '-vn', path.join(job, 'assets/narration.wav')]);
  const receipt = {version: 1, sourceHash: await sourceFingerprint(job), videoSha256: sha(await readFile(path.join(job, 'renders/video.mp4')))};
  await writeFile(path.join(job, 'review/render-source.json'), JSON.stringify(receipt));
  return job;
}

test('review pack freezes dense rendered evidence and normal speed clips', {skip: !available}, async t => {
  const job = await fixture(t);
  await writeFile(path.join(job, 'review/render-verification.json'), JSON.stringify({ok: true,
    sha256: sha(await readFile(path.join(job, 'renders/video.mp4'))), narrationIntegrity: {ok: true}}));
  const pack = await createReviewPack(job, {from: 'render'});
  assert.equal(pack.stage, 'final');
  assert.equal(pack.duration, 3);
  assert.deepEqual(pack.interval, {start: 0, end: 3});
  assert.deepEqual(pack.scenes.map(scene => scene.id), ['opening', 'payoff']);
  assert.equal(pack.sourceHash, await sourceFingerprint(job));
  assert.equal((await loadReviewPack(job, 'final')).pack.videoSha256, pack.videoSha256);
  const samples = pack.evidence.filter(item => item.kind === 'frames');
  for (const expected of [0, 0.8, 1, 1.5, 2])
    assert.ok(samples.some(sample => Math.abs(sample.start - expected) < 0.02), `Missing sample ${expected}`);
  for (const expected of [0.25, 0.55, 1.05, 1.25, 1.75, 2.25, 2.75])
    assert.ok(samples.some(sample => Math.abs(sample.start - expected) < 0.02), `Missing dense sample ${expected}`);
  for (const evidence of pack.evidence) {
    assert.ok(!path.isAbsolute(evidence.path));
    assert.equal(sha(await readFile(path.join(job, evidence.path))), evidence.sha256);
  }
  const sheets = pack.evidence.filter(item => item.kind === 'contact-sheet');
  assert.ok(sheets.length);
  for (const sheet of sheets) { assert.equal(sheet.frameWidth, 480); assert.ok(sheet.samples.length <= 12); }
  const clips = pack.evidence.filter(item => item.kind === 'clip');
  assert.deepEqual(clips.map(clip => [clip.start, clip.end]), [[0, 1.75], [1.25, 3]]);
  for (const clip of clips) {
    const probe = JSON.parse((await exec('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path.join(job, clip.path)])).stdout);
    assert.ok(Math.abs(Number(probe.format.duration) - (clip.end - clip.start)) < 0.1);
    assert.ok(probe.streams.some(stream => stream.codec_type === 'audio'));
    assert.equal(clip.playbackRate, 1);
  }
  const second = await createReviewPack(job, {from: 'render', stage: 'prototype'});
  assert.notEqual(second.evidence.find(item => item.kind === 'frames').path, samples[0].path);
  assert.equal(second.videoSha256, pack.videoSha256);
  assert.equal((await loadReviewPack(job, 'prototype')).pack.videoSha256, pack.videoSha256);
  const frozenVerification = second.evidence.find(item => item.kind === 'verification');
  await writeFile(path.join(job, 'review/render-verification.json'), '{}');
  assert.equal(JSON.parse(await readFile(path.join(job, frozenVerification.path), 'utf8')).narrationIntegrity.ok, true);
  assert.equal((await loadReviewPack(job, 'prototype')).pack.videoSha256, pack.videoSha256);
  await assert.rejects(createReviewPack(job, {from: 'render'}), /verification is stale/);
});

test('review pack rejects partial final, invalid intervals and escaped output', {skip: !available}, async t => {
  const job = await fixture(t);
  for (const options of [{start: -1}, {end: 4}, {start: 2, end: 1}, {start: NaN}, {start: '0'}, {end: 2}])
    await assert.rejects(createReviewPack(job, {from: 'render', ...options}), /interval|full video/);
  await assert.rejects(createReviewPack(job, {from: 'render', stage: 'prototype', start: 1}), /10–15 seconds/);
  await assert.rejects(createReviewPack(job, {from: 'render', stage: 'other'}), /stage/);
  await assert.rejects(createReviewPack(job, {from: 'render', output: '../escape.json'}), /review directory/);
  await assert.rejects(createReviewPack(job, {from: 'render', output: 'review/../../escape.json'}), /review directory/);
  const outside = await mkdtemp(path.join(tmpdir(), 'review-outside-'));
  t.after(() => rm(outside, {recursive: true, force: true}));
  await symlink(outside, path.join(job, 'review/linked'));
  await assert.rejects(createReviewPack(job, {from: 'render', output: 'review/linked/pack.json'}), /Symlinked/);
});

test('review pack cannot bind an old render to edited sources', {skip: !available}, async t => {
  const job = await fixture(t);
  await writeFile(path.join(job, 'compositions/opening.html'), '<p>Changed subject</p>');
  await assert.rejects(createReviewPack(job, {from: 'render'}), /receipt is stale/);
  await rm(path.join(job, 'review/render-source.json'));
  await assert.rejects(createReviewPack(job, {from: 'render'}), /Missing render source receipt/);
});

test('review pack rejects symlinked render and receipt outside the job', {skip: !available}, async t => {
  const job = await fixture(t), outside = await mkdtemp(path.join(tmpdir(), 'review-external-'));
  t.after(() => rm(outside, {recursive: true, force: true}));
  for (const relative of ['renders/video.mp4', 'review/render-source.json']) {
    const original = await readFile(path.join(job, relative)), external = path.join(outside, path.basename(relative));
    await writeFile(external, original);
    await rm(path.join(job, relative));
    await symlink(external, path.join(job, relative));
    await assert.rejects(createReviewPack(job, {from: 'render'}), /must be a local file/);
    await rm(path.join(job, relative));
    await writeFile(path.join(job, relative), original);
  }
});

test('review covers accepted encoded padding without hiding content gaps', {skip: !available}, async t => {
  const job = await fixture(t, {videoDuration: 3.08, videoFps: 25}), pack = await createReviewPack(job, {from: 'render'});
  assert.ok(Math.abs(pack.duration - 3.08) < 0.005);
  assert.equal(pack.interval.end, pack.duration);
  assert.equal(pack.scenes[1].end, pack.duration);
  assert.equal(pack.scenes[1].contentEnd, 3);
  assert.ok(Math.abs(pack.scenes[1].trailingMuxPadding - 0.08) < 0.005);
  assert.equal((await loadReviewPack(job, 'final')).pack.duration, pack.duration);
  const timingFile = path.join(job, 'timing.json'), timing = JSON.parse(await readFile(timingFile, 'utf8'));
  timing.scenes[1].end = 2.9;
  await writeFile(timingFile, JSON.stringify(timing));
  await writeFile(path.join(job, 'review/render-source.json'), JSON.stringify({version: 1,
    sourceHash: await sourceFingerprint(job), videoSha256: pack.videoSha256}));
  const gapPack = await createReviewPack(job, {from: 'render'});
  assert.equal(gapPack.scenes[1].end, 2.9);
  assert.equal(gapPack.scenes[1].trailingMuxPadding, undefined);
  await assert.rejects(loadReviewPack(job, 'final'), /scene coverage is incomplete/);
});

test('shorter accepted encoded duration clips scene evidence at the render end', {skip: !available}, async t => {
  const job = await fixture(t, {videoDuration: 2.92, videoFps: 25}), pack = await createReviewPack(job, {from: 'render'});
  assert.ok(Math.abs(pack.duration - 2.92) < 0.005);
  assert.equal(pack.scenes[1].end, pack.duration);
  assert.equal(pack.scenes[1].trailingMuxPadding, undefined);
  assert.equal((await loadReviewPack(job, 'final')).pack.duration, pack.duration);
});
