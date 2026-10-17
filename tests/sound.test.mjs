import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {compileFilm} from '../lib/spec.mjs';
import {decodeWav, soundInfo, placeSound} from '../lib/sfx.mjs';
import {mixBuses, loudness, speechMask} from '../lib/mix.mjs';
import {pickListening} from '../lib/sound-check.mjs';

const SR = 48000;
const THEME = {name: 'Test look', description: 'Chunky white outlines on a near-black stage, flat saturated fills, hard offset shadows and heavy display type for prices.', bg: '#101010', colors: {white: '#f0f0f0', grey: '#888888', dim: '#444444', faint: '#222222', blue: '#1488dd', yellow: '#ffd23f', red: '#e0342f', green: '#3fbf6f'}, meanings: {yellow: 'money'}};
/** 16-bit mono WAV from a function of time. */
function wav(seconds, fn, sr = SR) {
  const n = Math.round(seconds * sr), data = Buffer.alloc(n * 2), h = Buffer.alloc(44);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(fn(i / sr) * 32767))), i * 2);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
// a "voice": 300 Hz tone bursts while speaking (0.5–3.5 s and 6.5–9.5 s), silence between
const speaking = t => (t > 0.5 && t < 3.5) || (t > 6.5 && t < 9.5);
const voice = t => speaking(t) ? 0.3 * Math.sin(2 * Math.PI * 300 * t) : 0;
// a "whoosh": noise-ish swell peaking at 0.2 s, 0.6 s long
const whoosh = t => Math.sin(2 * Math.PI * 1200 * t + 40 * Math.sin(2 * Math.PI * 7 * t)) * Math.exp(-(((t - 0.2) / 0.08) ** 2)) * 0.9;

const words = 'one two three four five six seven eight nine ten eleven twelve'.split(' ')
  .map((text, i) => ({id: `w${i}`, text, start: 0.5 + i * 0.75, end: 0.5 + i * 0.75 + 0.5, scriptText: text}));
const alignment = {matchRatio: 1, words};
const scene = (id, start) => ({id, start, idea: 'i', mechanism: 'm', states: ['a', 'b', 'c'], payoff: 'p', camera: 'c', handoff: 'h', why_not_basic: 'w', alternatives: ['x']});
const film = {version: 2, title: 't', concept: 'c', theme: THEME, alternatives: [{concept: 'a', rejected: 'b'}, {concept: 'c', rejected: 'd'}], subjects: [], prototype: 'one',
  scenes: [scene('one', {boundary: 'start'}), scene('two', {phrase: 'seven'})]};
const manifest = {duration: 10, width: 1920, height: 1080, fps: 30};

async function job() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vg-sound-'));
  for (const d of ['shots', 'inputs', 'assets/sfx', 'assets/music']) await mkdir(path.join(dir, d), {recursive: true});
  await writeFile(path.join(dir, 'inputs/narration.txt'), words.map(w => w.text).join(' '));
  await writeFile(path.join(dir, 'assets/narration.wav'), wav(10, voice));
  await writeFile(path.join(dir, 'assets/sfx/whoosh.wav'), wav(0.6, whoosh));
  await writeFile(path.join(dir, 'shots/one.json'), JSON.stringify({scene: 'one', cues: {two: {phrase: 'two'}},
    objects: [{id: 'card', type: 'rect', at: [960, 540], size: [400, 300]}], actions: [{do: 'drop', target: 'card', at: 'two'}]}));
  return dir;
}
const shot = (dir, sounds, extra = {}) => writeFile(path.join(dir, 'shots/two.json'), JSON.stringify({scene: 'two', cues: {seven: {phrase: 'seven'}, nine: {phrase: 'nine'}},
  objects: [{id: 'title', type: 'text', at: [960, 300], text: 'Hello', size: 80}], actions: [{do: 'pop', target: 'title', at: 'seven'}, {do: 'camera', zoom: 1.2, at: 'nine', dur: 1}], sounds, ...extra}));

test('WAV decoding, loudest moment and alignment', () => {
  const d = decodeWav(wav(0.6, whoosh), 'w.wav'), info = soundInfo(d);
  assert.equal(d.sampleRate, SR); assert.equal(d.channels, 1); assert.ok(Math.abs(d.duration - 0.6) < 1e-3);
  assert.ok(Math.abs(info.peakTime - 0.2) <= 0.05, `peak ${info.peakTime}`);
  assert.equal(placeSound(5, 'start', info), 5);
  assert.equal(placeSound(5, 'end', info), Number((5 - info.duration).toFixed(3)));
  assert.equal(placeSound(5, 'peak', info), Number((5 - info.peakTime).toFixed(3)));
  assert.throws(() => decodeWav(Buffer.from('not a wav file at all, definitely not one'), 'x.wav'), /not a WAV/);
});

test('shot sounds: errors for broken sounds, placement and warnings for the voice', async () => {
  const dir = await job();
  await shot(dir, [{src: 'assets/sfx/missing.wav', at: 'seven'}, {src: 'assets/sfx/whoosh.wav', at: 'nope'},
    {src: 'assets/sfx/whoosh.wav', at: 'seven', volume: 2}, {src: 'assets/sfx/whoosh.wav', at: 'seven', align: 'middle'}, {src: 'sfx/whoosh.mp3', at: 'seven'}]);
  await assert.rejects(compileFilm(dir, film, alignment, manifest), e =>
    e.errors.some(m => /missing\.wav does not exist/.test(m)) && e.errors.some(m => /unknown cue "nope"/.test(m)) &&
    e.errors.some(m => /"volume" must be/.test(m)) && e.errors.some(m => /"align" must be/.test(m)) && e.errors.some(m => /\.wav file under assets/.test(m)));
  // loud whoosh while the voice speaks (seven = 5.0 s? no: speaking 6.5–9.5; nine = 6.5 s) → masking warning with a fix
  await shot(dir, [{src: 'assets/sfx/whoosh.wav', at: 'nine', align: 'peak', volume: 1}]);
  const loud = await compileFilm(dir, film, alignment, manifest);
  const s = loud.world.sounds[0];
  assert.equal(s.start, Number((6.5 - s.peakTime).toFixed(3)));
  assert.ok(s.masking && s.masking.maxVolume < 1, 'masking measured');
  assert.ok(loud.warnings.some(w => /Lower "volume" to/.test(w)));
  assert.ok(loud.warnings.some(w => /add "why"/.test(w)));
  // big moves without a sound are listed: the drop in scene one, the title pop at seven
  assert.ok(loud.warnings.some(w => /cuts and big moves have no sound effect/.test(w) && /drop card/.test(w) && /pop title/.test(w)));
  // quiet, in a pause, with a reason → no voice warning
  await shot(dir, [{src: 'assets/sfx/whoosh.wav', at: 'seven', volume: 0.05, why: 'the title pops in'}]);
  const quiet = await compileFilm(dir, film, alignment, manifest);
  assert.ok(!quiet.warnings.some(w => /sounds\[0\].*narration/.test(w)), quiet.warnings.join('\n'));
});

test('music needs a licence and a beat grid; the build suggests the trackStart that lands the cuts', async () => {
  const dir = await job();
  await shot(dir, []);
  await writeFile(path.join(dir, 'assets/music/track.wav'), wav(12, t => 0.2 * Math.sin(2 * Math.PI * 60 * t)));
  await assert.rejects(compileFilm(dir, {...film, music: {src: 'assets/music/track.wav'}}, alignment, manifest), e =>
    e.errors.some(m => /music\.source: required/.test(m)) && e.errors.some(m => /music\.license: required/.test(m)));
  await assert.rejects(compileFilm(dir, {...film, music: {src: 'assets/music/track.wav', source: 'x', license: 'CC BY-NC 4.0'}}, alignment, manifest), e => e.errors.some(m => /does not allow/.test(m)));
  const ok = {src: 'assets/music/track.wav', source: 'https://example.com/track', license: 'CC0'};
  await assert.rejects(compileFilm(dir, {...film, music: ok}, alignment, manifest), e => e.errors.some(m => /no beat grid/.test(m)));
  // beats every 0.5 s starting at 0.2 s: the cut at 5.0 s (phrase "seven") is 0.2 s off; trackStart 0.2 puts it on
  await writeFile(path.join(dir, 'assets/music/track.beats.json'), JSON.stringify({tempo: 120, period: 0.5, beats: Array.from({length: 24}, (_, i) => 0.2 + i * 0.5)}));
  const r = await compileFilm(dir, {...film, music: ok}, alignment, manifest);
  assert.equal(r.world.music.tempo, 120);
  assert.ok(r.warnings.some(w => /Setting "trackStart" to 0\.2/.test(w)), r.warnings.filter(w => /music/.test(w)).join('\n'));
});

test('the mix keeps the narration untouched and ducks the music under speech', async () => {
  const dir = await job();
  await shot(dir, [{src: 'assets/sfx/whoosh.wav', at: 'seven', volume: 0.1, why: 'pop'}]);
  await writeFile(path.join(dir, 'assets/music/track.wav'), wav(12, t => 0.2 * Math.sin(2 * Math.PI * 220 * t)));
  await writeFile(path.join(dir, 'assets/music/track.beats.json'), JSON.stringify({tempo: 120, period: 0.5, beats: Array.from({length: 24}, (_, i) => i * 0.5)}));
  const f = {...film, music: {src: 'assets/music/track.wav', source: 'https://example.com', license: 'CC0', fadeIn: 0, fadeOut: 0}};
  const {world} = await compileFilm(dir, f, alignment, manifest);
  // without sounds or music the mix is the narration itself
  const plain = await mixBuses(dir, {world: {sounds: []}, film: {}, duration: 10});
  const v = decodeWav(wav(10, voice), 'v').mono;
  let worst = 0;
  for (let i = Math.round(0.6 * SR); i < Math.round(3.4 * SR); i++) worst = Math.max(worst, Math.abs(plain.mix[2 * i] - v[i]), Math.abs(plain.mix[2 * i + 1] - v[i]));
  assert.ok(worst < 1e-4, `narration changed by up to ${worst}`);
  // with music: louder between sentences (5 s) than under speech (2 s)
  const m = await mixBuses(dir, {world, film: f, duration: 10});
  const rms = (a, b) => { let e = 0; for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) { const x = m.mix[2 * i] - (i < v.length ? v[i] : 0); e += x * x; } return Math.sqrt(e / ((b - a) * SR)); };
  const under = rms(1.5, 2.5), between = rms(4.6, 4.9);
  assert.ok(between > under * 2, `music ducks under speech (between ${between}, under ${under})`);
  assert.ok(m.music && m.music.duckDb === -12);
  const {mask} = speechMask(Float32Array.from({length: 1000}, (_, k) => speaking(k * 0.01) ? -12 : -90));
  assert.ok(mask[200] && !mask[500]);
});

test('ebur128 loudness is read from a file, and headphone checks are spread out by risk', async () => {
  const dir = await job();
  const l = await loudness(path.join(dir, 'assets/narration.wav'));
  assert.ok(Number.isFinite(l.integrated) && l.integrated < -5 && l.integrated > -40, `integrated ${l.integrated}`);
  assert.ok(l.truePeak <= 0 && Number.isFinite(l.mono.truePeak));
  const picks = pickListening([{t: 1, priority: 3, check: 'a'}, {t: 1.5, priority: 1, check: 'b'}, {t: 9, priority: 2, check: 'c'},
    {t: 5, priority: 4, check: 'd'}, {t: 20, priority: 0, check: 'outside'}], 10);
  assert.deepEqual(picks.map(p => p.check), ['b', 'd', 'c']);
});
