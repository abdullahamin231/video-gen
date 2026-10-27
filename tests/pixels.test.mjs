import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pixelChecks} from '../lib/pixels.mjs';

const exec = promisify(execFile);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let available = true;
try { await exec('ffmpeg', ['-version']); } catch { available = false; }

test('pixel checks detect black gaps after a bright scene and can block them for app reviews', {skip: !available}, async t => {
  const cache = path.join(ROOT, '.cache');
  await mkdir(cache, {recursive: true});
  const dir = await mkdtemp(path.join(cache, 'pixel-check-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const video = path.join(dir, 'white-then-black.mp4');
  await exec('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:r=30:d=1',
    '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=2', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  const timing = {scenes: [{id: 'browser', start: 0, end: 3}]};
  const advisory = await pixelChecks(video, timing);
  assert.ok(advisory.warnings.some(message => /empty frame/.test(message)));
  assert.equal(advisory.errors.length, 0);
  const strict = await pixelChecks(video, timing, {strictBlank: true});
  assert.ok(strict.errors.some(message => /sustained empty playback/.test(message)));
  assert.ok(strict.scenes.browser.blankShare > 0.5);
});

test('app-review accepts sustained solid-color browser footage as recorded content', {skip: !available}, async t => {
  const cache = path.join(ROOT, '.cache');
  await mkdir(cache, {recursive: true});
  const dir = await mkdtemp(path.join(cache, 'pixel-flat-browser-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const video = path.join(dir, 'flat-loading-page.mp4');
  await exec('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x4a90e2:s=320x180:r=30:d=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  const result = await pixelChecks(video, {scenes: [{id: 'browser-loading', start: 0, end: 3}]}, {strictBlank: true});
  assert.deepEqual(result.errors, []);
  assert.equal(result.scenes['browser-loading'].blankShare, 0);
  assert.match(result.method, /near-black coverage/);
});

test('a scene-wide rationale cannot exempt a sustained black app state', {skip: !available}, async t => {
  const cache = path.join(ROOT, '.cache');
  await mkdir(cache, {recursive: true});
  const dir = await mkdtemp(path.join(cache, 'pixel-justified-black-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const video = path.join(dir, 'black-app-state.mp4');
  await exec('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  const result = await pixelChecks(video, {scenes: [{id: 'sign-in-redirect', start: 0, end: 2,
    blackScreenReason: 'The recorded browser session shows the app redirecting through its documented black transition.'}]}, {strictBlank: true});
  assert.ok(result.errors.some(message => /sustained empty playback/.test(message)));
  assert.equal(result.sceneBlankExceptions, undefined);
});

test('only a time-scoped source match can exempt a genuine recorded black interval', {skip: !available}, async t => {
  const cache = path.join(ROOT, '.cache'); await mkdir(cache, {recursive: true});
  const dir = await mkdtemp(path.join(cache, 'pixel-source-black-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const video = path.join(dir, 'black-app-state.mp4');
  await exec('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  const timing = {scenes: [{id: 'recorded-redirect', start: 0, end: 2}]};
  assert.ok((await pixelChecks(video, timing, {strictBlank: true})).errors.length);
  const matched = await pixelChecks(video, timing, {strictBlank: true, verifiedBlackIntervals: [{start: 0, end: 2}]});
  assert.deepEqual(matched.errors, []);
});

test('app-review blocks a sustained minority blackout across scene boundaries and accepts sparse UI', {skip: !available}, async t => {
  const cache = path.join(ROOT, '.cache');
  await mkdir(cache, {recursive: true});
  const dir = await mkdtemp(path.join(cache, 'pixel-blackout-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const video = path.join(dir, 'sparse-blackout.mp4');
  await exec('ffmpeg', ['-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=white:s=320x180:r=30:d=5.5,drawbox=x=40:y=40:w=30:h=30:color=black:t=fill',
    '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=1.2',
    '-f', 'lavfi', '-i', 'color=c=white:s=320x180:r=30:d=5.3,drawbox=x=40:y=40:w=30:h=30:color=black:t=fill',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  const result = await pixelChecks(video, {scenes: [
    {id: 'first', start: 0, end: 6}, {id: 'second', start: 6, end: 12},
  ]}, {strictBlank: true});
  assert.ok(result.errors.some(message => /sustained empty playback.*1\.2s/.test(message)), result.errors.join('\n'));
  assert.ok(result.errors.some(message => /\[first\].*\[second\].*across scene boundary/.test(message)), result.errors.join('\n'));
  assert.ok(result.scenes.first.blankShare < 0.25 && result.scenes.second.blankShare < 0.25,
    'each scene has a low blank share, so per-scene percentages would miss the cross-cut blackout');
});
