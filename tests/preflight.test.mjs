import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preflightReviewPack} from '../lib/preflight.mjs';

const base = (overrides = {}) => ({
  version: 1, stage: 'final', source: 'render', duration: 12, interval: {start: 0, end: 12},
  scenes: [{id: 'one', start: 0, end: 6}, {id: 'two', start: 6, end: 12}],
  evidence: [
    {kind: 'frames', path: 'f1.png', start: 1, end: 1}, {kind: 'frames', path: 'f2.png', start: 7, end: 7},
    {kind: 'audio', path: 'a.wav', start: 0, end: 12},
    {kind: 'clip', path: 'c1.mp4', start: 0, end: 6, sceneId: 'one'},
    {kind: 'clip', path: 'c2.mp4', start: 6, end: 12, sceneId: 'two'},
    {kind: 'motion', path: 'motion.md'}, {kind: 'checks', path: 'checks.json'}, {kind: 'verification', path: 'verification.json'},
  ],
  ...overrides,
});

test('evidence preflight accepts a pack a reviewer can inspect scene by scene', () => {
  const report = preflightReviewPack(base());
  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.scenes.map(scene => scene.frames), [1, 1]);
});

test('evidence preflight refuses a scene with no image evidence', () => {
  const pack = base();
  pack.evidence = pack.evidence.filter(item => item.path !== 'f2.png');
  assert.throws(() => preflightReviewPack(pack), /scene "two".*no image evidence/);
});

test('evidence preflight refuses audio that stops before the film ends', () => {
  const pack = base();
  pack.evidence.find(item => item.kind === 'audio').end = 8;
  assert.throws(() => preflightReviewPack(pack), /audio evidence does not span/);
});

test('evidence preflight refuses encoded clips that leave a scene uncovered', () => {
  const pack = base();
  pack.evidence.find(item => item.kind === 'clip' && item.sceneId === 'two').start = 8;
  assert.throws(() => preflightReviewPack(pack), /clips do not cover scene "two"/);
});

test('evidence preflight reports missing supporting diagnostics as warnings, not blockers', () => {
  const pack = base();
  pack.evidence = pack.evidence.filter(item => !['motion', 'checks', 'verification'].includes(item.kind));
  const report = preflightReviewPack(pack);
  assert.equal(report.ok, true);
  assert.equal(report.warnings.length, 3);
});

test('HTML packs do not require encoded clips', () => {
  const pack = base({source: 'html'});
  pack.evidence = pack.evidence.filter(item => item.kind !== 'clip');
  assert.equal(preflightReviewPack(pack).ok, true);
});
