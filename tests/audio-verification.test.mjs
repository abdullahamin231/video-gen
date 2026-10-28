import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {compareNarration} from '../lib/audio.mjs';

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-threads', '1', '-y', ...args], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.error?.message || result.stderr);
}

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'video-audio-review-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const source = path.join(dir, 'narration.wav');
  // Time-varying chirps plus a modulated second voice make an identity test
  // meaningful; this is a speech surrogate, not an intelligibility benchmark.
  ffmpeg(['-f', 'lavfi', '-i',
    'aevalsrc=0.23*sin(2*PI*(180*t+130*t*t))*(0.6+0.4*sin(2*PI*3*t))+0.11*sin(2*PI*(730*t+17*t*t)):s=48000:d=3',
    '-c:a', 'pcm_s16le', source]);
  return {dir, source};
}

test('same narration survives a lossy AAC delivery roundtrip', async t => {
  const {dir, source} = await fixture(t), delivery = path.join(dir, 'delivery.m4a');
  ffmpeg(['-i', source, '-c:a', 'aac', '-b:a', '192k', delivery]);
  const report = await compareNarration(delivery, source);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.ok(report.correlation >= .995);
  assert.match(report.limitation, /not listening/);
});

test('changed content, missing tail, delayed audio, and substantial mix fail', async t => {
  const {dir, source} = await fixture(t);
  for (const [name, filter] of [
    ['wrong-content-same-duration', 'areverse'],
    ['changed', 'aselect=not(between(t\\,1\\,1.3)),asetpts=N/SR/TB'],
    ['trimmed', 'atrim=end=2.6'],
    ['delayed', 'adelay=30|30'],
    ['mix', 'aeval=val(0)+0.15*sin(2*PI*620*t)']
  ]) {
    const modified = path.join(dir, `${name}.wav`);
    ffmpeg(['-i', source, '-af', filter, modified]);
    const report = await compareNarration(modified, source);
    assert.equal(report.ok, false, `${name}: ${JSON.stringify(report)}`);
  }
});

test('silence and decode errors fail safely', async t => {
  const {dir, source} = await fixture(t), silence = path.join(dir, 'silence.wav');
  ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '3', silence]);
  const silent = await compareNarration(silence, silence);
  assert.equal(silent.ok, false);
  assert.match(silent.limitation, /Silent/);
  const missing = await compareNarration(path.join(dir, 'missing.mp4'), source);
  assert.equal(missing.ok, false);
  assert.match(missing.limitation, /decode failed/);
});
