import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseReviewDepth, reviewPolicy, maxReviewRounds, MAX_REVIEW_ROUNDS, REVIEW_DEPTHS} from '../lib/review.mjs';

test('review depth defaults to standard and rejects unknown names', () => {
  assert.equal(parseReviewDepth(undefined), 'standard');
  assert.equal(parseReviewDepth(''), 'standard');
  assert.equal(parseReviewDepth(' deep '), 'deep');
  for (const depth of REVIEW_DEPTHS) assert.equal(parseReviewDepth(depth), depth);
  assert.throws(() => parseReviewDepth('thorough'), /--review-depth is fast, standard, deep/);
});

test('review depth changes the round budget and frame step, never reviewer independence', () => {
  assert.deepEqual(reviewPolicy({reviewDepth: 'fast'}), {depth: 'fast', maxRounds: 2, frameStep: 2});
  assert.deepEqual(reviewPolicy({}), {depth: 'standard', maxRounds: MAX_REVIEW_ROUNDS, frameStep: 1});
  assert.deepEqual(reviewPolicy({reviewDepth: 'deep'}), {depth: 'deep', maxRounds: 4, frameStep: 0.5});
  assert.equal(maxReviewRounds({reviewDepth: 'fast'}), 2);
  assert.equal(maxReviewRounds({reviewDepth: 'deep'}), 4);
});

test('jobs created before review depth existed resolve to standard', () => {
  assert.equal(reviewPolicy({version: 1}).depth, 'standard');
  assert.equal(reviewPolicy({reviewDepth: 'unknown'}).depth, 'standard');
});
