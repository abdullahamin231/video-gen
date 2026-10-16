import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DEFAULT_CONFIG, loadConfig, resolveSettings, safeArea, frameGuide} from '../lib/format.mjs';
import {directorBrief, builderBrief} from '../lib/briefs.mjs';
import {installKit, writeWorld} from '../lib/world.mjs';
import {inspectFilm, chromePath} from '../lib/inspect.mjs';

const config = {...DEFAULT_CONFIG};
const vertical = {width: 1080, height: 1920, duration: 4, status: 'prepared'};
async function tempDir(t, prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(dir, {recursive: true, force: true}));
  return dir;
}

test('defaults keep today\'s behaviour: landscape, whole recording, 30 fps', () => {
  const s = resolveSettings({}, config, 42);
  assert.deepEqual([s.format, s.width, s.height, s.start, s.duration, s.fps, s.warnings], ['landscape', 1920, 1080, 0, 42, 30, []]);
});

test('--format vertical gives a 1080×1920 frame; the old --resolution names still work', () => {
  assert.deepEqual(['width', 'height'].map(k => resolveSettings({format: 'vertical'}, config, 10)[k]), [1080, 1920]);
  assert.equal(resolveSettings({resolution: 'portrait'}, config, 10).format, 'vertical');
  assert.equal(resolveSettings({resolution: 'landscape'}, config, 10).format, 'landscape');
  assert.throws(() => resolveSettings({format: 'widescreen'}, config, 10), /Unknown format "widescreen"/);
  assert.throws(() => resolveSettings({format: 'vertical', resolution: 'portrait'}, config, 10), /pass one/);
});

test('--length trims, --duration is the same setting, and a flag must fit the recording', () => {
  assert.equal(resolveSettings({length: '20'}, config, 60).duration, 20);
  assert.equal(resolveSettings({duration: '20'}, config, 60).duration, 20);
  assert.equal(resolveSettings({length: '20', duration: '20'}, config, 60).duration, 20);
  assert.throws(() => resolveSettings({length: '20', duration: '30'}, config, 60), /same setting/);
  assert.throws(() => resolveSettings({length: '90'}, config, 60), /outside the source recording/);
  assert.throws(() => resolveSettings({length: 'abc'}, config, 60), /must be a number/);
  assert.equal(resolveSettings({start: '10', length: '20'}, config, 60).start, 10);
});

test('a config length trims only longer recordings; a config format can be overridden', () => {
  const c = {...config, length: 30, format: 'vertical'};
  assert.equal(resolveSettings({}, c, 60).duration, 30);
  assert.equal(resolveSettings({}, c, 12).duration, 12);
  assert.equal(resolveSettings({}, c, 60).format, 'vertical');
  assert.equal(resolveSettings({format: 'landscape'}, c, 60).format, 'landscape');
});

test('a vertical job over the cap warns but still runs; landscape never warns', () => {
  const long = resolveSettings({format: 'vertical'}, config, 120);
  assert.equal(long.duration, 120);
  assert.match(long.warnings[0], /longer than the 90 s vertical cap/);
  assert.deepEqual(resolveSettings({format: 'vertical'}, config, 60).warnings, []);
  assert.deepEqual(resolveSettings({format: 'landscape'}, config, 600).warnings, []);
});

test('video.config.json: missing file gives defaults, typos and bad values fail clearly', async t => {
  const dir = await tempDir(t, 'video-config-'), file = path.join(dir, 'video.config.json');
  assert.deepEqual(await loadConfig(dir), DEFAULT_CONFIG);
  await writeFile(file, JSON.stringify({_help: 'notes are ignored', format: 'portrait', length: 45}));
  assert.deepEqual(await loadConfig(dir), {...DEFAULT_CONFIG, format: 'vertical', length: 45});
  await writeFile(file, JSON.stringify({formatt: 'vertical'}));
  await assert.rejects(loadConfig(dir), /unknown setting formatt/);
  await writeFile(file, JSON.stringify({length: -5}));
  await assert.rejects(loadConfig(dir), /"length" must be/);
  await writeFile(file, '{not json');
  await assert.rejects(loadConfig(dir), /not valid JSON/);
});

test('briefs state the job\'s frame; vertical briefs add the safe area and phone guidance', () => {
  const alignment = {words: [{id: 'w0', text: 'hello', start: 0, end: 1}]};
  const v = directorBrief('/job', {...vertical, duration: 4}, alignment);
  assert.match(v, /1080×1920 \(vertical 9:16/);
  assert.match(v, /default view centre is \[540,960\]/);
  assert.match(v, /x 65–940, y 211–1536/);
  assert.match(v, /"center": \[540, 960\]/);
  assert.doesNotMatch(v, /960, 540|\[960,540\]/);
  const l = directorBrief('/job', {width: 1920, height: 1080, duration: 4}, alignment);
  assert.match(l, /1920×1080 \(landscape 16:9\)/);
  assert.doesNotMatch(l, /safe area|phone apps/i);
  const film = {concept: 'c', theme: {}, scenes: [{id: 'a', idea: 'i'}]};
  const b = builderBrief('/job', vertical, film, {id: 'a', start: 0, end: 4}, alignment);
  assert.match(b, /default view centre \[540,960\]/);
  assert.match(b, /Stack, do not spread/);
  assert.equal(safeArea({width: 1920, height: 1080}), null);
  assert.match(frameGuide({width: 1080, height: 1080}), /square/);
});

test('real browser: a vertical world renders in a 1080×1920 frame; landscape positions and app chrome are flagged', async t => {
  try { await chromePath(); } catch { return t.skip('Chrome unavailable'); }
  const job = await tempDir(t, 'vertical-world-');
  for (const dir of ['review', 'assets']) await mkdir(path.join(job, dir));
  await installKit(job);
  const text = (id, at, value) => ({id, type: 'text', at, text: value, size: 64, visible: true, scene: 'v'});
  const world = {...vertical, theme: {}, scenes: [{id: 'v', start: 0, end: 4, cues: {}}],
    objects: [text('inside', [540, 900], 'Inside'), text('landscape', [1700, 540], 'Landscape x'), text('caption', [540, 1800], 'Under the caption'),
      {id: 'subject', type: 'circle', at: [540, 900], r: 300, scene: 'v'}],
    actions: [{do: 'create', target: 'subject', t: 0, dur: 3.5, scene: 'v', order: 0}], hooks: [], componentSrc: [], media: []};
  await writeWorld(job, world, vertical);
  const result = await inspectFilm(job, vertical, {scenes: [{id: 'v', start: 0, end: 4, holds: []}]});
  const about = id => result.warnings.filter(w => w.includes(`(${id})`));
  assert.deepEqual(about('inside'), [], result.warnings.join('\n'));
  assert.ok(about('landscape').some(w => /cut off by the frame edge/.test(w)), result.warnings.join('\n'));
  assert.ok(about('caption').some(w => /leaves the vertical safe area/.test(w)), result.warnings.join('\n'));
  assert.match(result.transcript, /1080×1920 frame/);
  assert.deepEqual(result.errors, []);
});
