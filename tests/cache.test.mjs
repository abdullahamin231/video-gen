import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cacheDir} from '../lib/cache.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('tool caches stay beneath the repository .cache', () => {
  assert.equal(cacheDir({}), path.join(root, '.cache/video-gen'));
  assert.equal(cacheDir({VG_CACHE: '.cache/custom'}), path.join(root, '.cache/custom'));
  for (const location of ['/home/administrator/.cache', '/tmp/models', '.cache/../../outside', '.cache-other'])
    assert.throws(() => cacheDir({VG_CACHE: location}), /inside the repository .cache/);
});
