import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {prototypeCut, holdToLength} from '../lib/film.mjs';
import {writeRoot} from '../lib/world.mjs';
import {sourceFingerprint} from '../lib/review.mjs';

const manifest = {name: 'cut', duration: 30, fps: 30, width: 64, height: 36};
const timing = {scenes: [
  {id: 'intro', start: 0, end: 6, duration: 6, kind: 'shot'},
  {id: 'proto', start: 6, end: 14, duration: 8, kind: 'html'},
  {id: 'later', start: 14, end: 30, duration: 16, kind: 'html'},
], missing: ['later']};
const film = {prototype: 'proto', theme: {bg: '#000000'}, scenes: [{id: 'intro'}, {id: 'proto', file: 'compositions/proto.html'}, {id: 'later', file: 'compositions/later.html'}]};

async function job(t, overrides = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'video-cut-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await mkdir(path.join(dir, 'renders'));
  await writeFile(path.join(dir, 'timing.json'), JSON.stringify({...timing, ...overrides}));
  await writeFile(path.join(dir, 'film.json'), JSON.stringify(film));
  return dir;
}

test('a prototype render captures only to the end of the prototype and its review interval', async t => {
  const dir = await job(t);
  // The prototype runs 6–14 s; its review interval is at least 10 s long, so it runs to 16 s. One frame is added.
  assert.equal(await prototypeCut(dir, manifest), Number((Math.ceil(16 * 30 + 1) / 30).toFixed(3)));
  // Every scene built (or the prototype accepted): the whole film is rendered.
  assert.equal(await prototypeCut(await job(t, {missing: []}), manifest), null);
});

test('the short composition stops at the cut and is not a production source', async t => {
  const dir = await job(t);
  const before = await sourceFingerprint(dir);
  await writeRoot(dir, manifest, timing, film, {file: 'index.cut.html', end: 16.033});
  const html = await readFile(path.join(dir, 'index.cut.html'), 'utf8');
  assert.match(html, /id="root" data-composition-id="main" data-start="0" data-duration="16.033"/);
  assert.match(html, /host-proto"[^>]*data-duration="8"/);
  // A scene that starts before the cut is kept, trimmed to it; one that starts after it is left out.
  assert.match(html, /host-later"[^>]*data-start="14" data-duration="2.033"/);
  await writeRoot(dir, manifest, timing, film, {file: 'index.cut.html', end: 12});
  assert.doesNotMatch(await readFile(path.join(dir, 'index.cut.html'), 'utf8'), /host-later/);
  assert.equal(await sourceFingerprint(dir), before);
});

test('the captured part is held to the film\'s full length', {skip: spawnSync('ffmpeg', ['-version']).status !== 0 && 'ffmpeg is not installed'}, async t => {
  const dir = await job(t);
  const made = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=64x36:rate=30:duration=2', '-pix_fmt', 'yuv420p', path.join(dir, 'renders/picture.mp4')]);
  assert.equal(made.status, 0);
  await holdToLength(dir, {...manifest, duration: 5}, 2);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=r_frame_rate,width', '-of', 'json', path.join(dir, 'renders/picture.mp4')], {encoding: 'utf8'});
  const info = JSON.parse(probe.stdout);
  assert(Math.abs(Number(info.format.duration) - 5) < 0.05, info.format.duration);
  assert.equal(info.streams[0].r_frame_rate, '30/1'); assert.equal(info.streams[0].width, 64);
});
