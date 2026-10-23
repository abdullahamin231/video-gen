// N thumbnail variants: made from different angles, reviewed, picked (by the person or the reviewer's ranking),
// any one regenerated with feedback, and archived.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

const library = await mkdtemp(path.join(os.tmpdir(), 'thumb-library-'));
process.env.VG_LIBRARY = library;
const {thumbnailStep, thumbnailStatus, recordVerdict, recordRanking, addThumbnailFeedback, chooseThumbnail, exportThumbnail} = await import('../lib/thumbnails.mjs');
const {chromePath} = await import('../lib/inspect.mjs');

async function fixture(t, manifest = {}) {
  const job = await mkdtemp(path.join(os.tmpdir(), 'thumbs-'));
  t.after(() => rm(job, {recursive: true, force: true}));
  await mkdir(path.join(job, 'inputs'), {recursive: true});
  await writeFile(path.join(job, 'job.json'), JSON.stringify({duration: 10, thumbnails: 2, ...manifest}));
  await writeFile(path.join(job, 'inputs/visuals.md'), '# Plan\n\n## Thumbnail\n- Title: Why your Mac is slow\n- Headline: IT\'S NOT THE CHIP\n\n## Scenes\n');
  return job;
}
async function make(job, id, {headline = `HEADLINE ${id}`, colour = '#112233'} = {}) {
  const dir = path.join(job, 'thumbnail/variants', id); await mkdir(dir, {recursive: true});
  await writeFile(path.join(dir, 'BRIEF.md'), `Title: Why your Mac is slow\nHeadline: ${headline}\n`);
  await writeFile(path.join(dir, 'thumbnail.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="${colour}"/></svg>`);
  await sharp({create: {width: 1280, height: 720, channels: 3, background: colour}}).png().toFile(path.join(dir, 'thumbnail.png'));
  await sharp({create: {width: 320, height: 180, channels: 3, background: colour}}).png().toFile(path.join(dir, 'preview-320x180.png'));
}
const verdict = (job, variant, status, findings = []) => recordVerdict(job, {variant, status, findings, reviewer: 'reviewer-1',
  inspected: [`thumbnail/variants/${variant}/thumbnail.png`]});

test('variants are made from different angles, reviewed, and a blocked one goes back alone with the findings', async t => {
  const job = await fixture(t);
  const first = await thumbnailStep(job);
  assert.equal(first.state, 'thumbnail variants');
  assert.match(first.text, /thumbnail-maker: "Read .*thumbnail-v1\.md/); assert.match(first.text, /thumbnail-v2\.md/);
  const brief1 = await readFile(path.join(job, 'briefs/thumbnail-v1.md'), 'utf8'), brief2 = await readFile(path.join(job, 'briefs/thumbnail-v2.md'), 'utf8');
  assert.match(brief1, /IT'S NOT THE CHIP/); assert.match(brief1, /as written/); assert.match(brief2, /A useful outcome or an evidenced problem/);
  assert.match(brief1, /thumbnail-export/);
  await make(job, 'v1'); await make(job, 'v2');
  const review = await thumbnailStep(job);
  assert.equal(review.state, 'thumbnail review'); assert.match(review.text, /thumbnail-reviewer: "Read .*thumbnail-review\.md/);
  await assert.rejects(verdict(job, 'v2', 'blocked'), /at least one --finding/);
  await verdict(job, 'v1', 'pass'); await verdict(job, 'v2', 'blocked', ['The number on it is not in the research.']);
  const again = await thumbnailStep(job);
  assert.equal(again.state, 'thumbnail variants'); assert.match(again.text, /thumbnail v2 again/); assert.doesNotMatch(again.text, /thumbnail-v1\.md/);
  assert.match(await readFile(path.join(job, 'briefs/thumbnail-v2.md'), 'utf8'), /not in the research/);
  await make(job, 'v2', {colour: '#445566'});
  const second = await thumbnailStep(job);
  assert.equal(second.state, 'thumbnail review'); assert.match(await readFile(path.join(job, 'briefs/thumbnail-review.md'), 'utf8'), /- v2:/);
  assert.doesNotMatch(await readFile(path.join(job, 'briefs/thumbnail-review.md'), 'utf8'), /- v1:/);
  await verdict(job, 'v2', 'pass'); await recordRanking(job, ['v2', 'v1']);
  const pick = await thumbnailStep(job);
  assert.equal(pick.state, 'pick thumbnail'); assert.match(pick.text, /--variant v2/);
  await chooseThumbnail(job, {variant: 'v2'});
  assert.equal((await thumbnailStep(job)).state, 'done');
  // The chosen copy, its review and the archive.
  const review2 = JSON.parse(await readFile(path.join(job, 'thumbnail/REVIEW.json'), 'utf8'));
  assert.equal(review2.status, 'pass'); assert.equal(review2.reviewerAgentId, 'reviewer-1');
  const archived = await readdir(path.join(library, 'thumbnails', path.basename(job)));
  assert.ok(archived.includes('thumbnail.png') && archived.includes('variants') && archived.includes('CHOSEN.json'));
});

test('when the person picks, the reviewer ranking is not enough; their feedback regenerates only that variant', async t => {
  const job = await fixture(t, {pickThumbnail: true});
  await make(job, 'v1'); await make(job, 'v2');
  await verdict(job, 'v1', 'pass'); await verdict(job, 'v2', 'pass'); await recordRanking(job, ['v1', 'v2']);
  const ask = await thumbnailStep(job);
  assert.equal(ask.state, 'choose thumbnail'); assert.match(ask.text, /checkpoint \{kind: "thumbnail"/); assert.match(ask.text, /never reword/i);
  await chooseThumbnail(job, {variant: 'v1', by: 'you'});
  assert.equal((await thumbnailStep(job)).state, 'done');
  // Feedback on the picked one undoes the pick until it is remade and passes again.
  await addThumbnailFeedback(job, {variant: 'v1', text: 'Make the headline red and bigger'});
  const status = await thumbnailStatus(job);
  assert.equal(status.chosen, null);
  const redo = await thumbnailStep(job);
  assert.match(redo.text, /thumbnail v1 again/);
  const brief = await readFile(path.join(job, 'briefs/thumbnail-v1.md'), 'utf8');
  assert.match(brief, /their words; do exactly this\): Make the headline red and bigger/);
  await assert.rejects(chooseThumbnail(job, {variant: 'v1', by: 'you'}), /not passed|feedback/);
  await make(job, 'v1', {colour: '#990000'});
  assert.equal((await thumbnailStep(job)).state, 'thumbnail review');
  await verdict(job, 'v1', 'pass');
  assert.equal((await thumbnailStep(job)).state, 'choose thumbnail');
  await chooseThumbnail(job, {variant: 'v1', by: 'you'});
  assert.equal((await thumbnailStep(job)).state, 'done');
  // The first archive is kept as history.
  assert.ok((await readdir(path.join(library, 'thumbnails', path.basename(job)))).includes('history'));
});

test('a variant blocked three times is dropped; with none left the step is blocked', async t => {
  const job = await fixture(t, {thumbnails: 1});
  for (let round = 0; round < 3; round++) {
    await make(job, 'v1', {colour: `#00000${round}`});
    await verdict(job, 'v1', 'blocked', [`Round ${round}: unreadable at feed size.`]);
    await thumbnailStep(job);
  }
  await make(job, 'v1', {colour: '#000009'}); await verdict(job, 'v1', 'blocked', ['Still unreadable.']);
  assert.equal((await thumbnailStep(job)).state, 'blocked');
});

test('thumbnail-export renders the SVG to a 1280×720 PNG and a feed preview', async t => {
  const chrome = await chromePath().catch(() => null);
  if (!chrome) return t.skip('no Chrome');
  const job = await fixture(t);
  const dir = path.join(job, 'thumbnail/variants/v1'); await mkdir(dir, {recursive: true});
  await writeFile(path.join(dir, 'thumbnail.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#ff0000"/><text x="80" y="400" font-size="160" fill="#fff">DON\'T</text></svg>');
  const result = await exportThumbnail(job, 'v1');
  assert.deepEqual(result.size, {width: 1280, height: 720});
  const preview = await sharp(path.join(dir, 'preview-320x180.png')).metadata();
  assert.equal(preview.width, 320); assert.equal(preview.height, 180);
  const {data} = await sharp(path.join(dir, 'thumbnail.png')).extract({left: 5, top: 5, width: 1, height: 1}).raw().toBuffer({resolveWithObject: true});
  assert.ok(data[0] > 200 && data[1] < 50, 'the SVG itself was drawn');
});
