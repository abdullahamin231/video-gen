import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {referenceStudy} from '../scripts/reference-study.mjs';

const run = promisify(execFile), root = path.resolve('.');

test('reference sampling uses the labelled source time, including t=0, and creates analysis-only output', async t => {
  const base = path.join(root, '.cache/tests');
  await mkdir(base, {recursive: true});
  const dir = await mkdtemp(path.join(base, 'reference-study-'));
  const name = `reference-unit-${process.pid}`;
  const out = path.join(root, '.cache/video-gen/reference-studies', name);
  t.after(async () => { await rm(dir, {recursive: true, force: true}); await rm(out, {recursive: true, force: true}); });
  const source = path.join(dir, 'colours.mp4');
  await run('ffmpeg', ['-nostdin', '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=red:s=96x54:r=10:d=1',
    '-f', 'lavfi', '-i', 'color=blue:s=96x54:r=10:d=1',
    '-f', 'lavfi', '-i', 'color=lime:s=96x54:r=10:d=1',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', source]);
  await referenceStudy(root, {video: source, name, every: '1', tag: ['sample']});
  const manifest = JSON.parse(await readFile(path.join(out, 'sample.json'), 'utf8'));
  assert.deepEqual(manifest.samples.map(s => s.time), [0, 1, 2]);
  assert.equal(manifest.sampleCount, 3);
  assert.equal(manifest.usage, 'Reference analysis only');
  assert.match(manifest.sourceSha256, /^[a-f0-9]{64}$/);
  for (const [i, dominant] of [0, 2, 1].entries()) {
    const {stdout} = await run('ffmpeg', ['-nostdin', '-v', 'error', '-i', path.join(out, manifest.samples[i].file),
      '-vf', 'scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {encoding: 'buffer'});
    assert(stdout[dominant] > 180 && [...stdout].filter((_, k) => k !== dominant).every(v => v < 80), `sample ${i} must depict its source second`);
  }
  assert((await readFile(path.join(out, manifest.contactSheet))).length > 100);
});
