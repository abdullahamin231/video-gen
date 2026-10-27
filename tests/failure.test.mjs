import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyFailure} from '../lib/failure.mjs';

test('tooling and environment failures are infrastructure, not film defects', () => {
  for (const error of [
    "Cannot find module 'sharp'",
    'spawn ffmpeg ENOENT',
    'ffmpeg: command not found',
    'browserType.launch: Failed to launch chromium',
    'EACCES: permission denied, open /usr/local/bin/ffmpeg',
    'ENOSPC: no space left on device',
    'ModuleNotFoundError: No module named librosa',
  ]) {
    const result = classifyFailure([error]);
    assert.equal(result.isInfrastructure, true, error);
    assert.deepEqual(result.film, [], error);
  }
});

test('film and asset defects stay on the creative repair path', () => {
  for (const error of [
    'film.json: "theme" is required',
    'ENOENT: no such file or directory, open assets/missing.png',
    'shots/opening.json: cue word "growth" is not spoken',
    'scene "ending" has no evidence',
  ]) {
    const result = classifyFailure([error]);
    assert.equal(result.isInfrastructure, false, error);
    assert.deepEqual(result.film, [error], error);
  }
});

test('a mixed failure keeps both lists so the environment is fixed first without hiding film errors', () => {
  const result = classifyFailure(['spawn ffmpeg ENOENT', 'film.json: "theme" is required']);
  assert.equal(result.isInfrastructure, true);
  assert.deepEqual(result.infrastructure, ['spawn ffmpeg ENOENT']);
  assert.deepEqual(result.film, ['film.json: "theme" is required']);
});

test('an ordinary missing asset path is never mistaken for a missing tool', () => {
  const result = classifyFailure(['ENOENT: no such file or directory, open assets/logo.png']);
  assert.equal(result.isInfrastructure, false);
  assert.equal(result.film.length, 1);
});
