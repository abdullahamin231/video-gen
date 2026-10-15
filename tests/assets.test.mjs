import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {importAsset, webImagesAllowed} from '../lib/assets.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'video-assets-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const job = path.join(root, 'job');
  await mkdir(job);
  return {root, job};
}

test('web images are off unless VG_ALLOW_WEB_IMAGES is set', () => {
  assert.equal(webImagesAllowed({}), false);
  assert.equal(webImagesAllowed({VG_ALLOW_WEB_IMAGES: '0'}), false);
  assert.equal(webImagesAllowed({VG_ALLOW_WEB_IMAGES: '1'}), true);
  assert.equal(webImagesAllowed({VG_ALLOW_WEB_IMAGES: 'true'}), true);
});

test('a raster image from a web URL is refused before anything is downloaded', async t => {
  const {root, job} = await fixture(t);
  for (const name of ['gpu.png', 'gpu.jpg', 'gpu.jpeg', 'gpu.webp', 'gpu.gif']) {
    await assert.rejects(
      importAsset(job, root, {src: 'https://example.com/gpu', name, note: 'a card'}),
      /Downloading raster images from the web is turned off/);
  }
  await assert.rejects(readFile(path.join(job, 'assets/gpu.png')), {code: 'ENOENT'});
});

test('a local raster image is accepted regardless of the web setting', async t => {
  const {root, job} = await fixture(t);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  await writeFile(path.join(root, 'gpu.png'), png);
  const entry = await importAsset(job, root, {src: 'gpu.png', name: 'gpu.png', note: 'a card'});
  assert.equal(entry.name, 'gpu.png');
  assert.deepEqual(await readFile(path.join(job, 'assets/gpu.png')), png);
});

test('a web SVG is not blocked by the raster rule', async t => {
  const {root, job} = await fixture(t);
  // Unreachable host: the failure must come from the download, not from the raster check.
  await assert.rejects(
    importAsset(job, root, {src: 'http://127.0.0.1:9/logo.svg', name: 'logo.svg', note: 'a logo'}),
    error => !/turned off/.test(error.message));
});

test('a web raster image is allowed once raster downloads are enabled', async t => {
  const {root, job} = await fixture(t);
  await assert.rejects(
    importAsset(job, root, {src: 'http://127.0.0.1:9/gpu.png', name: 'gpu.png', note: 'a card', allowWebImages: true}),
    error => !/turned off/.test(error.message));
});
