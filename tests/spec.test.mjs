import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateFilm, resolveSceneCue, sourceNumbers, compileFilm, SpecError} from '../lib/spec.mjs';

const words = 'so you go look up gpus and then you see the prices the rtx 5090 is over 2 grand and you see the prices again'.split(' ')
  .map((text, i) => ({id: `w${i}`, text, start: i * 0.5, end: i * 0.5 + 0.4, scriptText: text}));
const alignment = {matchRatio: 1, words};
const scene = (id, start) => ({id, start, idea: 'i', mechanism: 'm', states: ['a', 'b', 'c'], payoff: 'p', camera: 'c', handoff: 'h', why_not_basic: 'w', alternatives: ['x']});
export const THEME = {name: 'Test look', description: 'Chunky white outlines on a near-black stage, flat saturated fills, hard offset shadows and heavy display type for prices.', bg: '#101010', colors: {white: '#f0f0f0', grey: '#888888', dim: '#444444', faint: '#222222', blue: '#1488dd', yellow: '#ffd23f', red: '#e0342f', green: '#3fbf6f'}, meanings: {yellow: 'money'}};
const film = {version: 2, title: 't', concept: 'c', theme: THEME, alternatives: [{concept: 'a', rejected: 'b'}, {concept: 'c', rejected: 'd'}], subjects: [],
  scenes: [scene('one', {boundary: 'start'}), scene('two', {phrase: 'the rtx'})]};

test('film plan resolves scene starts from spoken phrases', () => {
  const {scenes} = validateFilm(film, alignment, 12);
  assert.equal(scenes[1].start, 6);
  assert.equal(scenes[0].end, 6);
});

test('film plan errors are specific', () => {
  assert.throws(() => validateFilm({...film, scenes: [scene('one', {}), scene('two', {phrase: 'not spoken'})]}, alignment, 12),
    e => e instanceof SpecError && e.errors.some(m => /not in the recording/.test(m)));
});

test('a film must declare one design theme, and the theme is checked', () => {
  const {theme: _t, ...noTheme} = film; void _t;
  assert.throws(() => validateFilm(noTheme, alignment, 12), e => e.errors.some(m => /"theme" is required/.test(m)));
  assert.throws(() => validateFilm({...film, theme: {...THEME, description: 'dark', fonts: {sans: 'Comic Sans'}}}, alignment, 12),
    e => e.errors.some(m => /description/.test(m)) && e.errors.some(m => /Comic Sans" is not bundled/.test(m)));
  assert.doesNotThrow(() => validateFilm({...film, theme: {...THEME, fonts: {sans: 'Archivo', display: 'Bebas Neue'}}}, alignment, 12));
});

test('cues are searched inside the scene window and suggest near matches', () => {
  const warnings = [];
  assert.equal(resolveSceneCue({phrase: 'see the prices'}, alignment, 12, 6, 12, 'x', warnings), 10.5);
  assert.equal(resolveSceneCue({phrase: 'see the prices'}, alignment, 12, 0, 6, 'x', warnings), 4.5);
  assert.throws(() => resolveSceneCue({phrase: 'see the price'}, alignment, 12, 5.5, 12, 'x', []), /Closest spoken words/);
});

test('spoken numbers are recognised', () => {
  const n = sourceNumbers('it costs $6,950 or two grand, about one hundred twenty thousand and 2.5k');
  for (const v of [6950, 2, 120000, 2500]) assert.ok(n.has(v), `missing ${v}`);
});

test('compile rejects literal times, unknown targets and unsourced numbers', async () => {
  const job = await mkdtemp(path.join(os.tmpdir(), 'vg-spec-'));
  await mkdir(path.join(job, 'shots')); await mkdir(path.join(job, 'inputs'));
  await writeFile(path.join(job, 'inputs/narration.txt'), words.map(w => w.text).join(' '));
  await writeFile(path.join(job, 'shots/one.json'), JSON.stringify({scene: 'one', cues: {look: {phrase: 'look up'}}, objects: [
    {id: 'price', type: 'text', at: [960, 540], text: '$999'}],
  actions: [{do: 'write', target: 'price', at: 2}, {do: 'move', target: 'ghost', to: [0, 0], at: 'look'}]}));
  const manifest = {duration: 12, width: 1920, height: 1080};
  await assert.rejects(compileFilm(job, film, alignment, manifest, {allowMissing: true}), e =>
    e.errors.some(m => /not a literal time/.test(m)) && e.errors.some(m => /"ghost" is not defined/.test(m)) && e.errors.some(m => /displays 999/.test(m)));
  await writeFile(path.join(job, 'shots/one.json'), JSON.stringify({scene: 'one', cues: {look: {phrase: 'look up'}}, objects: [
    {id: 'price', type: 'text', at: [960, 540], text: '$5,090'}, {id: 'ring', type: 'circle', at: [960, 540], r: 200}],
  actions: [{do: 'write', target: 'price', at: 'look+.0'}, {do: 'create', target: 'ring', at: '@after+.2'}]}));
  const {world, missing} = await compileFilm(job, film, alignment, manifest, {allowMissing: true});
  assert.deepEqual(missing, ['two']);
  assert.equal(world.actions[1].t, Number((1.5 + 1 + 0.2).toFixed(3)));
});
