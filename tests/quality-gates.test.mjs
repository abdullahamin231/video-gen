import test from 'node:test';
import assert from 'node:assert/strict';
import {qualityGates, DENSE_INK_PCT} from '../lib/review.mjs';

test('a soundtrack capped by the narration peaks is quiet unless accepted by name', () => {
  const mix = {limitedBy: 'peak ceiling', integratedLufs: -25.2};
  assert.equal(qualityGates({mix}).length, 1);
  assert.match(qualityGates({mix})[0], /-25\.2 LUFS.*--accept-quiet true/);
  assert.deepEqual(qualityGates({mix}, {acceptQuiet: true}), []);
});

test('a soundtrack that reaches the loudness target passes', () => {
  assert.deepEqual(qualityGates({mix: {limitedBy: 'loudness target', integratedLufs: -16.1}}), []);
});

test('a crowded frame blocks delivery unless accepted, and channel-range density passes', () => {
  assert.equal(DENSE_INK_PCT, 10);
  assert.equal(qualityGates({density: {inkMedian: 12.7}}).length, 1);
  assert.deepEqual(qualityGates({density: {inkMedian: 12.7}}, {acceptDense: true}), []);
  assert.deepEqual(qualityGates({density: {inkMedian: 6.9}}), []);
});

test('missing measurements do not block (films without a mix or frame check)', () => {
  assert.deepEqual(qualityGates({}), []);
});
