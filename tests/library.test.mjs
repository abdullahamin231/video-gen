import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {inspectBundle, itemPath, publishBundle, searchLibrary, useBundle, verifyLibraryCopies, unsavedFiles, saveToLibrary, saveAll} from '../lib/assets.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'video-library-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const source = path.join(root, 'candidate'), library = path.join(root, 'library'), job = path.join(root, 'job');
  await mkdir(source); await mkdir(job);
  await writeFile(path.join(job, 'job.json'), '{}');
  const manifest = {schemaVersion: 1, id: 'packet-router', version: '1.0.0', kind: 'component',
    title: 'Packet router', description: 'Split a signal into branching paths', tags: ['network', 'transport'],
    entry: 'router.js', files: ['router.js'], usage: 'Supply timeline, targets and resolved cue slots.',
    origin: {source: 'jobs/example', license: 'project-owned'}, review: {status: 'draft', evidence: []}};
  const save = () => writeFile(path.join(source, 'artifact.json'), JSON.stringify(manifest));
  await save(); await writeFile(path.join(source, 'router.js'), '/* caller-owned timeline */');
  return {root, source, library, job, manifest, save};
}

test('search discovers actions and limits results without reading code files', async t => {
  const f = await fixture(t);
  await publishBundle(f.library, f.source);
  // Discovery uses metadata even if a code file is unavailable; inspection catches missing files.
  await rm(path.join(f.library, 'packet-router/1.0.0/router.js'));
  const found = await searchLibrary(f.library, 'branching network');
  assert.equal(found.total, 1);
  assert.equal(found.matches[0].item, 'packet-router@1.0.0');
  assert.equal(found.matches[0].status, 'draft');
  assert.equal((await searchLibrary(f.library, 'unrelated')).total, 0);
  await assert.rejects(searchLibrary(f.library, '', 0), /Limit/);
});

test('published versions cannot overwrite existing artifacts', async t => {
  const f = await fixture(t);
  await publishBundle(f.library, f.source);
  await writeFile(path.join(f.source, 'router.js'), 'changed');
  await assert.rejects(publishBundle(f.library, f.source), {code: 'EEXIST'});
  assert.equal(await readFile(path.join(f.library, 'packet-router/1.0.0/router.js'), 'utf8'), '/* caller-owned timeline */');
  f.manifest.version = '1.1.0'; await f.save();
  await publishBundle(f.library, f.source);
  assert.equal((await searchLibrary(f.library)).total, 2);
});

test('job copies are independent of shared revisions and detect edited or missing files', async t => {
  const f = await fixture(t);
  await publishBundle(f.library, f.source);
  const installed = await useBundle(f.library, 'packet-router@1.0.0', f.job);
  assert.equal(installed.entry, 'router.js');
  assert.deepEqual(await verifyLibraryCopies(f.job), []);
  await writeFile(path.join(f.library, 'packet-router/1.0.0/router.js'), 'shared edit');
  assert.deepEqual(await verifyLibraryCopies(f.job), []);
  await assert.rejects(useBundle(f.library, 'packet-router@1.0.0', f.job), /Already installed/);
  await writeFile(path.join(f.job, installed.path, 'router.js'), 'local edit');
  assert.match((await verifyLibraryCopies(f.job))[0], /frozen file changed/);
  await rm(path.join(f.job, installed.path, 'router.js'));
  assert.match((await verifyLibraryCopies(f.job))[0], /frozen file missing/);
});

test('bundle inspection rejects traversal and symlinks escaping the bundle', async t => {
  const f = await fixture(t);
  f.manifest.files = ['../job/job.json']; f.manifest.entry = '../job/job.json'; await f.save();
  await assert.rejects(inspectBundle(f.source), /Unsafe artifact path/);
  f.manifest.files = ['escape.js']; f.manifest.entry = 'escape.js'; await f.save();
  await symlink(path.join(f.job, 'job.json'), path.join(f.source, 'escape.js'));
  await assert.rejects(inspectBundle(f.source), /stay inside/);
  assert.throws(() => itemPath(f.library, '../escape@1.0.0'), /explicit library item/);
  assert.throws(() => itemPath(f.library, 'packet-router@latest'), /explicit library item/);
});

test('reviewed status requires frozen local evidence', async t => {
  const f = await fixture(t);
  f.manifest.review.status = 'reviewed'; await f.save();
  await assert.rejects(inspectBundle(f.source), /local review evidence/);
  f.manifest.review.evidence = ['review.md']; await f.save();
  await assert.rejects(inspectBundle(f.source), /frozen in the bundle/);
  f.manifest.files.push('review.md'); await f.save();
  await writeFile(path.join(f.source, 'review.md'), 'Motion inspected; cue-driven routing works.');
  assert.equal((await inspectBundle(f.source)).manifest.review.status, 'reviewed');
});

test('everything a film brings in or makes is saved once, searchable, and reusable', async t => {
  const {library, job} = await fixture(t);
  for (const dir of ['assets/kit', 'assets/fonts', 'components', 'manim']) await mkdir(path.join(job, dir), {recursive: true});
  await writeFile(path.join(job, 'assets/kit/kit.js'), 'pipeline file');
  await writeFile(path.join(job, 'assets/cues.js'), 'pipeline file');
  await writeFile(path.join(job, 'assets/gpu.png'), 'png bytes');
  await writeFile(path.join(job, 'assets/fonts/display.woff2'), 'font bytes');
  await writeFile(path.join(job, 'assets/SOURCES.json'), JSON.stringify([{name: 'gpu.png', src: 'https://example.com/gpu.png', note: 'a graphics card seen from the front', tags: ['gpu', 'hardware']}]));
  await writeFile(path.join(job, 'components/shelf.js'), "// A store shelf with price-tag slots\nVG.component('shelf', {build() { return {}; }});");
  await writeFile(path.join(job, 'film.json'), JSON.stringify({title: 'GPU prices'}));
  assert.deepEqual((await unsavedFiles(library, job)).sort(), ['assets/fonts/display.woff2', 'assets/gpu.png', 'components/shelf.js']);
  const saved = await saveAll(library, job);
  assert.equal(saved.length, 3);
  assert.deepEqual(await unsavedFiles(library, job), []);
  const gpu = (await searchLibrary(library, 'graphics card')).matches[0];
  assert.equal(gpu.item, 'gpu@1.0.0'); assert.deepEqual(gpu.tags, ['gpu', 'hardware']);
  const shelf = await inspectBundle(itemPath(library, 'shelf@1.0.0'));
  assert.match(shelf.manifest.description, /store shelf/); assert.equal(shelf.manifest.kind, 'component');
  // identical content is not saved twice; changed content becomes a new version
  assert.deepEqual(await saveToLibrary(library, job, {file: 'components/shelf.js', title: 'Shelf', tags: 'shelf'}), {item: 'shelf@1.0.0', saved: false});
  await writeFile(path.join(job, 'components/shelf.js'), "// A store shelf, now with two levels\nVG.component('shelf', {build() { return {}; }});");
  assert.deepEqual(await unsavedFiles(library, job), ['components/shelf.js']);
  assert.deepEqual(await saveToLibrary(library, job, {file: 'components/shelf.js', title: 'Shelf', tags: 'shelf'}), {item: 'shelf@1.0.1', saved: true});
  // a library copy installed into a job does not count as new work
  await useBundle(library, 'gpu@1.0.0', job);
  assert.deepEqual(await unsavedFiles(library, job), []);
  await assert.rejects(saveToLibrary(library, job, {file: '../outside.js', title: 'x', tags: 'x'}), /inside the job/);
});
