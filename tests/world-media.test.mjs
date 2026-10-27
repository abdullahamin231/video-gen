import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, readFile, rm, access, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeWorld} from '../lib/world.mjs';
import {verifyAppCaptureSources} from '../lib/film.mjs';
import {pixelChecks} from '../lib/pixels.mjs';
import {verifyCaptureVisibility} from '../lib/capture-visibility.mjs';

const exec = promisify(execFile);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let available = true;
try { await exec('ffmpeg', ['-version']); } catch { available = false; }

test('world compilation holds a trimmed video on its genuine final frame until the scene handoff', {skip: !available}, async t => {
  const cache = path.join(ROOT, '.cache');
  await mkdir(cache, {recursive: true});
  const job = await mkdtemp(path.join(cache, 'world-media-'));
  t.after(() => rm(job, {recursive: true, force: true}));
  await mkdir(path.join(job, 'assets'), {recursive: true});
  const source = path.join(job, 'assets/capture.mp4');
  await exec('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=24:d=0.8',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=0.4', '-f', 'lavfi', '-i', 'color=c=green:s=320x180:r=15:d=0.8',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-vsync', 'vfr',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source]);
  const world = {
    width: 320, height: 180, duration: 4, theme: {bg: '#111111'},
    objects: [{id: 'app-screen', type: 'video', src: 'assets/capture.mp4', at: [160, 90], size: [320, 180],
      clipDuration: 0.4, sourceStart: 0.8, sourceDuration: 0.4, scene: 'result'}],
    actions: [{do: 'play', target: 'app-screen', t: 0, order: 0, scene: 'result'}],
    scenes: [{id: 'result', start: 0, end: 4, cues: {}}], components: [], hooks: [],
  };
  await writeWorld(job, world, {width: 320, height: 180, duration: 4});
  const hold = world.objects.find(object => object.id === 'hold-app-screen');
  assert.equal(hold?.type, 'image');
  assert.equal(hold?.visible, false);
  await access(path.join(job, hold.src));
  assert.ok(world.actions.some(action => action.do === 'show' && action.target === hold.id && action.t === 0.4));
  assert.ok(!world.actions.some(action => action.target === hold.id && action.do === 'fadeOut'));
  // The poster must match the final frame of the requested blue trim, not the
  // source file's later green frames. Verify decoded luma near both sides.
  const decoded = async file => (await exec('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'scale=1:1:flags=area,format=gray', '-f', 'rawvideo', 'pipe:1'], {encoding: 'buffer'})).stdout;
  const posterLuma = (await decoded(path.join(job, hold.src)))[0];
  const sourceTrim = path.join(job, 'assets/trim.mp4');
  await exec('ffmpeg', ['-v', 'error', '-y', '-i', source, '-ss', '0.8', '-t', '0.4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sourceTrim]);
  const trimLuma = (await decoded(sourceTrim)).at(-1);
  assert.ok(Math.abs(posterLuma - trimLuma) < 12, `poster luma ${posterLuma} should match trimmed final luma ${trimLuma}`);
  const playback = path.join(job, 'playback.mp4');
  await exec('ffmpeg', ['-v', 'error', '-y', '-i', sourceTrim, '-loop', '1', '-i', path.join(job, hold.src),
    '-filter_complex', '[0:v]fps=30,trim=duration=0.4,setpts=PTS-STARTPTS[a];[1:v]fps=30,trim=duration=1.2,setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0[out]',
    '-map', '[out]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', playback]);
  const boundaryFrames = (await exec('ffmpeg', ['-v', 'error', '-i', playback,
    '-vf', 'fps=30,scale=1:1:flags=area,format=gray', '-f', 'rawvideo', 'pipe:1'], {encoding: 'buffer'})).stdout;
  for (const frame of [10, 11, 12, 30, 45]) {
    const luma = boundaryFrames[frame];
    assert.ok(Math.abs(luma - posterLuma) < 12, `encoded playback frame ${frame} near/after hold boundary should remain on the genuine final frame`);
  }
  const serialized = JSON.parse(await readFile(path.join(job, 'assets/world.json'), 'utf8'));
  assert.ok(serialized.objects.some(object => object.id === hold.id), 'the rendered composition includes the held frame');
});

test('explicit video exits and hold:false do not create frozen end frames', {skip: !available}, async t => {
  const cache = path.join(ROOT, '.cache');
  await mkdir(cache, {recursive: true});
  const job = await mkdtemp(path.join(cache, 'world-media-exit-'));
  t.after(() => rm(job, {recursive: true, force: true}));
  await mkdir(path.join(job, 'assets'), {recursive: true});
  await exec('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=1.2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(job, 'assets/capture.mp4')]);
  const world = {
    width: 320, height: 180, duration: 4, theme: {bg: '#111111'},
    objects: [
      {id: 'dismissed', type: 'video', src: 'assets/capture.mp4', at: [160, 90], size: [320, 180], clipDuration: 1.2, scene: 'result'},
      {id: 'no-hold', type: 'video', src: 'assets/capture.mp4', at: [160, 90], size: [320, 180], clipDuration: 1.2, scene: 'result', hold: false},
    ],
    actions: [
      {do: 'play', target: 'dismissed', t: 0, order: 0, scene: 'result'},
      {do: 'fadeOut', target: 'dismissed', t: 1.5, dur: 0.2, order: 1, scene: 'result'},
      {do: 'play', target: 'no-hold', t: 0, order: 2, scene: 'result'},
    ],
    scenes: [{id: 'result', start: 0, end: 4, cues: {}}], components: [], hooks: [],
  };
  await writeWorld(job, world, {width: 320, height: 180, duration: 4});
  assert.ok(!world.objects.some(object => object.id === 'hold-dismissed'));
  assert.ok(!world.objects.some(object => object.id === 'hold-no-hold'));
});

test('short capture ending on a white composition backdrop fails media evidence even though pixels are bright', {skip: !available}, async t => {
  const cache = path.join(ROOT, '.cache');
  await mkdir(cache, {recursive: true});
  const job = await mkdtemp(path.join(cache, 'world-media-white-end-'));
  t.after(() => rm(job, {recursive: true, force: true}));
  await mkdir(path.join(job, 'assets'), {recursive: true});
  const capture = path.join(job, 'assets/capture.mp4'), rendered = path.join(job, 'renders.mp4');
  await exec('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=0.8',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', capture]);
  await exec('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:r=30:d=2',
    '-f', 'lavfi', '-i', `movie=${capture},scale=320:180`, '-filter_complex', '[0:v][1:v]overlay=shortest=0:eof_action=pass',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', rendered]);
  const report = await pixelChecks(rendered, {scenes: [{id: 'browser', start: 0, end: 2}]}, {strictBlank: true});
  assert.deepEqual(report.errors, [], 'the white composition backdrop looks valid to pixel-only blank detection');
  await writeFile(path.join(job, 'assets/world.json'), JSON.stringify({objects: [{id: 'screen', type: 'video',
    src: 'assets/capture.mp4', clipDuration: 1.5, mediaDuration: 1.5}]}));
  await assert.rejects(verifyAppCaptureSources(job), /ends before its requested playback interval/);
});

test('rendered capture comparison detects a hidden layer on a bright backdrop', {skip: !available}, async t => {
  const cache = path.join(ROOT, '.cache'); await mkdir(cache, {recursive: true});
  const job = await mkdtemp(path.join(cache, 'capture-visibility-hidden-'));
  t.after(() => rm(job, {recursive: true, force: true}));
  await mkdir(path.join(job, 'assets/app-capture/task'), {recursive: true});
  const source = path.join(job, 'assets/app-capture/task/capture.mp4'), output = path.join(job, 'render.mp4');
  await exec('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source]);
  await exec('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', output]);
  const world = {width: 320, height: 180, scenes: [{id: 'screen', start: 0, end: 2}], objects: [
    {id: 'capture', type: 'video', src: 'assets/app-capture/task/capture.mp4', at: [160, 90], size: [320, 180], clipDuration: 2, mediaStart: 0, mediaDuration: 2, scene: 'screen'},
  ], actions: []};
  const report = await verifyCaptureVisibility(job, output, world);
  assert.equal(report.coverage.failed, 1); assert.equal(report.captures[0].status, 'failed');
});

test('rendered capture comparison accepts an actually recorded solid-black source state', {skip: !available}, async t => {
  const cache = path.join(ROOT, '.cache'); await mkdir(cache, {recursive: true});
  const job = await mkdtemp(path.join(cache, 'capture-visibility-black-'));
  t.after(() => rm(job, {recursive: true, force: true}));
  await mkdir(path.join(job, 'assets/app-capture/task'), {recursive: true});
  const source = path.join(job, 'assets/app-capture/task/capture.mp4'), output = path.join(job, 'render.mp4');
  for (const file of [source, output]) await exec('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
  const world = {width: 320, height: 180, scenes: [{id: 'screen', start: 0, end: 2}], objects: [
    {id: 'capture', type: 'video', src: 'assets/app-capture/task/capture.mp4', at: [160, 90], size: [320, 180], clipDuration: 2, mediaStart: 0, mediaDuration: 2, scene: 'screen'},
  ], actions: []};
  const report = await verifyCaptureVisibility(job, output, world);
  assert.equal(report.coverage.verified, 1); assert.equal(report.captures[0].status, 'verified');
});
