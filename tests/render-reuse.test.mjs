import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderFilm} from '../lib/film.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('render rejects invalid worker counts before touching the job', async () => {
  for (const workers of [0, -1, 1.5, 'invalid'])
    await assert.rejects(renderFilm('/nonexistent-render-job', {workers}), /positive integer or auto/);
});

test('render refuses to reuse failed, partial, uninspected, or stale builds', async t => {
  await mkdir(path.join(root, 'jobs'), {recursive: true});
  const job = await mkdtemp(path.join(root, 'jobs/.render-reuse-'));
  t.after(() => rm(job, {recursive: true, force: true}));
  await mkdir(path.join(job, 'review'));
  const save = (file, value) => writeFile(path.join(job, file), JSON.stringify(value));
  await save('job.json', {duration: 1, fps: 30});
  await save('timing.json', {scenes: [{id: 'one'}], missing: []});
  const base = {ok: true, scope: 'all', missing: [], errors: [], sourceHash: 'stale', report: {scenes: {one: {}}}};
  for (const change of [
    {ok: false, errors: ['broken']},
    {scope: 'one'},
    {missing: ['two']},
    {report: null},
    {report: {scenes: {other: {}}}},
    {}, // All inspection fields present, but the source fingerprint is stale.
  ]) {
    await save('review/build.json', {...base, ...change});
    await assert.rejects(renderFilm(job, {
      reuseBuild: true,
      workers: 3,
      hf: () => assert.fail('A rejected build must never launch the renderer'),
    }), /requires a current successful browser build of every scene/);
  }
});
