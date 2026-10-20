// The explainer vocabulary (composite objects), the frame checks that look for weak frames, and the channel theme.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {installKit, writeWorld} from '../lib/world.mjs';
import {inspectFilm, chromePath} from '../lib/inspect.mjs';
import {compileFilm} from '../lib/spec.mjs';
import {channelThemeWarnings, loadChannelTheme} from '../lib/channel.mjs';
import {loadConfig} from '../lib/format.mjs';
const THEME = {name: 'Test look', description: 'Near-black desk with cream paper cards, yellow highlighter for the number that matters, red stamps for verdicts and small mono labels.',
  bg: '#111214', colors: {white: '#f1efe8', grey: '#8b9099', dim: '#3b3f46', faint: '#1c1e22', blue: '#3d9bf0', yellow: '#ffd43b', red: '#f0524f', green: '#42c27d'}, meanings: {yellow: 'the number'}};

const landscape = {width: 1920, height: 1080, duration: 4, status: 'prepared'};
async function tempDir(t, prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(dir, {recursive: true, force: true}));
  return dir;
}
async function inspectObjects(t, objects, actions = []) {
  const job = await tempDir(t, 'frame-world-');
  for (const dir of ['review', 'assets']) await mkdir(path.join(job, dir));
  await installKit(job);
  const theme = {...THEME, colors: {...THEME.colors, paper: '#ede7d9', ink: '#16171a'}};
  await writeWorld(job, {...landscape, theme, scenes: [{id: 'f', start: 0, end: 4, cues: {}}], objects: objects.map(o => ({scene: 'f', visible: true, ...o})),
    actions: actions.map((a, i) => ({scene: 'f', order: i, source: `f.${i}`, dur: 0.5, ...a})), hooks: [], components: [], media: [], sounds: []}, landscape);
  return inspectFilm(job, landscape, {scenes: [{id: 'f', start: 0, end: 4, holds: []}]});
}

test('composite objects build in the browser and their text is measured', async t => {
  try { await chromePath(); } catch { return t.skip('Chrome unavailable'); }
  const result = await inspectObjects(t, [
    {id: 'big', type: 'hero', at: [380, 300], value: 94, unit: 'GB of memory'},
    {id: 'quote', type: 'card', at: [1400, 300], title: 'r/LocalLLaMA', text: 'It fits in memory at full context, barely.', highlight: 'full context', source: 'reddit'},
    {id: 'spec', type: 'sheet', at: [1400, 760], rows: [['layers', '78'], ['dtype', 'bf16']], highlight: 0},
    {id: 'price', type: 'tag', at: [380, 760], text: '$3,999'},
    {id: 'no', type: 'verdict', at: [900, 900], text: 'Too slow'},
    {id: 'mem', type: 'gauge', at: [900, 480], max: 512, step: 128, unit: 'GB', value: 0, fillLabel: ''},
    {id: 'src', type: 'chip', at: [900, 120], text: 'github'},
  ], [{do: 'fill', target: 'mem', to: 94, label: '94 GB', t: 1}]);
  assert.deepEqual(result.errors, []);
  const scene = result.report.scenes.f;
  assert.ok(scene.heroPx >= 170, `hero measured ${scene.heroPx}px`);
  assert.ok(!result.warnings.some(w => /nothing on screen dominates|spans only/.test(w)), result.warnings.join('\n'));
});

test('the frame checks flag a small centred cluster, an empty box and a washed-out frame', async t => {
  try { await chromePath(); } catch { return t.skip('Chrome unavailable'); }
  const result = await inspectObjects(t, [
    {id: 'slot', type: 'rect', at: [960, 540], size: [300, 200]},
    {id: 'note', type: 'text', at: [960, 700], text: 'Label', size: 40, opacity: 0.4},
  ]);
  const all = result.warnings.join('\n');
  assert.match(all, /content spans only/);
  assert.match(all, /nothing on screen dominates/);
  assert.match(all, /"slot" is an empty box/);
  const washed = await inspectObjects(t, [{id: 'ghost', type: 'text', at: [960, 540], text: 'Faded', size: 120, opacity: 0.3}]);
  assert.match(washed.warnings.join('\n'), /half-faded/);
});

test('composites are validated: highlights must be quoted words, numbers need a source, gauges fill to a number', async t => {
  const job = await tempDir(t, 'frame-spec-');
  await mkdir(path.join(job, 'shots')); await mkdir(path.join(job, 'inputs'));
  const words = 'the model needs ninety four gigabytes'.split(' ').map((text, i) => ({id: `w${i}`, text, start: i * 0.5, end: i * 0.5 + 0.4}));
  await writeFile(path.join(job, 'inputs/narration.txt'), words.map(w => w.text).join(' '));
  const film = {version: 2, title: 't', concept: 'c', theme: THEME, prototype: 'one', scenes: [{id: 'one', start: {boundary: 'start'}, idea: 'i'}]};
  const shot = objects => writeFile(path.join(job, 'shots/one.json'), JSON.stringify({scene: 'one', objects, actions: [{do: 'fill', target: 'mem', at: 'start', to: 'lots'}]}));
  await shot([
    {id: 'quote', type: 'card', at: [960, 540], text: 'It fits at 512 GB.', highlight: 'does not fit'},
    {id: 'mem', type: 'gauge', at: [400, 540]},
    {id: 'pic', type: 'image', at: [400, 540], src: 'assets/photo.jpg', size: [400, 300]},
  ]);
  await writeFile(path.join(job, 'assets/photo.jpg'), 'x').catch(async () => { await mkdir(path.join(job, 'assets')); await writeFile(path.join(job, 'assets/photo.jpg'), 'x'); });
  await assert.rejects(compileFilm(job, film, {matchRatio: 1, words}, {duration: 3, width: 1920, height: 1080}), e =>
    e.errors.some(m => /"highlight" must be words that occur/.test(m)) && e.errors.some(m => /displays 512/.test(m)) && e.errors.some(m => /fill needs numeric "to"/.test(m))
    && e.warnings.some(m => /raster image/.test(m)) && e.warnings.some(m => /no "source" chip/.test(m)));
});

test('the channel theme: configured in video.config.json, departures must say why', async t => {
  const root = await tempDir(t, 'frame-channel-');
  await mkdir(path.join(root, 'channel'));
  await writeFile(path.join(root, 'channel/theme.json'), JSON.stringify(THEME));
  await writeFile(path.join(root, 'video.config.json'), JSON.stringify({channelTheme: 'channel/theme.json'}));
  const config = await loadConfig(root);
  const channel = await loadChannelTheme(root, config);
  assert.equal(channel.theme.name, THEME.name);
  assert.equal(await loadChannelTheme(root, {channelTheme: null}), null);
  await assert.rejects(loadChannelTheme(root, {channelTheme: 'channel/missing.json'}), /file not found/);
  assert.deepEqual(channelThemeWarnings(THEME, THEME), []);
  const changed = {...THEME, colors: {...THEME.colors, yellow: '#00ff00'}};
  assert.match(channelThemeWarnings(changed, THEME)[0], /colors\.yellow/);
  assert.deepEqual(channelThemeWarnings({...changed, channelDepartures: 'green is the brand colour of the product reviewed'}, THEME), []);
});
