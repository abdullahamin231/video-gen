import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DEFAULT_CONFIG, loadConfig, resolveSettings, safeArea, frameGuide} from '../lib/format.mjs';
import {directorBrief, builderBrief} from '../lib/briefs.mjs';

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

test('assignments carry saved canvas dimensions without a layout recipe',()=>{
  const alignment={words:[{text:'hello',start:0,end:1}]};
  const brief=directorBrief('/job',vertical,alignment);
  const data=JSON.parse(/```json\n([\s\S]*?)\n```/.exec(brief)[1]);
  assert.equal(data.width,1080);assert.equal(data.height,1920);
  assert.equal(data.contract,'docs/composition.md');
});
