import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {compileFilm} from '../lib/spec.mjs';
import {installKit, writeWorld, writeRoot} from '../lib/world.mjs';
import {lintJob, parseLint} from '../lib/lint.mjs';

const put = (job, file, value) => writeFile(path.join(job, file), typeof value === 'string' ? value : JSON.stringify(value));

async function job(t, hook) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lint-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  for (const d of ['shots', 'assets']) await mkdir(path.join(dir, d));
  const words = ['opening', 'ending'].map((text, i) => ({id: `w${i}`, text, start: i * 4, end: i * 4 + 1}));
  const alignment = {matchRatio: 1, words}, manifest = {name: 'lint', duration: 8, width: 1920, height: 1080, fps: 30};
  const film = {version: 2, title: 'Lint', concept: 'c', alternatives: [{concept: 'A', rejected: 'B'}, {concept: 'C', rejected: 'D'}],
    theme: {name: 'Test look', description: 'Chunky white outlines on a near-black stage, flat saturated fills, hard offset shadows and heavy display type.', bg: '#101010', colors: {white: '#f0f0f0', yellow: '#ffd23f'}},
    scenes: words.map((w, i) => ({id: w.text, start: i ? {phrase: w.text} : {boundary: 'start'}, idea: 'Idea', mechanism: 'Operation', states: ['a', 'b', 'c'], payoff: 'Result', camera: 'Static', handoff: 'Same', why_not_basic: 'Meaning', alternatives: ['Other']}))};
  await put(dir, 'shots/opening.json', {scene: 'opening', objects: [{id: 'a', type: 'circle', at: [960, 540], r: 100}], actions: [{do: 'create', target: 'a', at: 'start+0.5', dur: 1}], ...(hook ? {hook: 'shots/opening.hook.js'} : {})});
  await put(dir, 'shots/ending.json', {scene: 'ending', objects: [], actions: []});
  if (hook) await put(dir, 'shots/opening.hook.js', hook);
  const {world, timing} = await compileFilm(dir, film, alignment, manifest);
  await installKit(dir); await writeWorld(dir, world, manifest); await writeRoot(dir, manifest, timing, film);
  await put(dir, 'assets/narration.wav', '');
  return {dir, film};
}

// Guards the pipeline's own generated code: a HyperFrames lint error here would stop every film at render.
test('the generated index.html and world.html pass HyperFrames lint', async t => {
  const {dir, film} = await job(t, `VG.hook('opening', k => { void k; });\n`);
  const lint = await lintJob(dir, film);
  assert.deepEqual(lint.pipeline, []);
  assert.deepEqual(lint.errors, []);
});

test('a lint error inside a builder hook goes to that scene, not to the pipeline', async t => {
  const {dir, film} = await job(t, `VG.hook('opening', k => {
  window.__timelines['x'] = gsap.timeline({paused: true});
  document.fonts.ready.then(function () { window.__timelines['x'].to('#a', {x: 1}); });
});\n`);
  const lint = await lintJob(dir, film);
  assert.deepEqual(lint.pipeline, []);
  assert.ok(lint.errors.some(e => e.startsWith('[opening]') && e.includes('shots/opening.hook.js') && e.includes('gsap_timeline_registered_before_async_build')), lint.errors.join('\n'));
});

test('lint output is parsed with file, line and fix', () => {
  const out = `  ✗ [compositions/world.html:12:3] some_rule [el]: Bad thing.\n    Fix: Do this.\n  ⚠ [index.html] other_rule: Meh.\n  ✗ root_rule: Root.\n`;
  assert.deepEqual(parseLint(out, '/job'), [
    {severity: 'error', file: 'compositions/world.html', line: 12, code: 'some_rule', message: 'Bad thing.', fix: 'Do this.'},
    {severity: 'warning', file: 'index.html', line: null, code: 'other_rule', message: 'Meh.'},
    {severity: 'error', file: 'index.html', line: null, code: 'root_rule', message: 'Root.'},
  ]);
});

test('an unlocated lint error the generated mount script causes is a pipeline error, even beside a builder hook', async t => {
  const {dir, film} = await job(t, `VG.hook('opening', k => { void k; });\n`);
  const file = path.join(dir, 'compositions/world.html');
  // The mount script as it was before the fix: registration written above document.fonts.ready.
  const html = (await readFile(file, 'utf8')).replace('  // Faces load only when first used', "  function early() { window.__timelines['world'] = null; }\n  // Faces load only when first used");
  await writeFile(file, html);
  const lint = await lintJob(dir, film);
  assert.ok(lint.pipeline.some(e => e.includes('gsap_timeline_registered_before_async_build')), JSON.stringify(lint));
  assert.ok(!lint.errors.some(e => e.includes('gsap_timeline_registered_before_async_build')), lint.errors.join('\n'));
});
