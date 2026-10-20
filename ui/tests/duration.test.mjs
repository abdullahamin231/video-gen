import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, durationFromPrompt } from '../shared/duration.mjs';

test('the target duration is read from the prompt', () => {
  for (const [text, seconds] of [
    ['A 3-minute explainer about batteries', 180], ['90 seconds on 80s synth music', 90], ['a 1 min 30 sec reel', 90],
    ['five minutes on tides', 300], ['2 minutes and 30 seconds', 150], ['a 1.5 minute short', 90],
    ['3 minutes and a half', 210], ['an explainer 2:30 long', 150], ['runtime 4:05', 245], ['half an hour', 1800],
    ['A 5-minute video with a 10-second hook', 300], ['10 MINUTES', 600],
  ]) assert.equal(parseDuration(text), seconds, text);
});

test('ordinary prose is not mistaken for a duration', () => {
  for (const text of ['make a second version', 'about the 1990s', '80s synth music', 'take a minute to explain it', 'at 2:30 pm', ''])
    assert.equal(parseDuration(text), null, text);
});

test('a missing or out-of-range duration gives an actionable error', () => {
  assert.match(durationFromPrompt('A video about grids').error, /how long/);
  assert.match(durationFromPrompt('a 5 second clip').error, /between 10 seconds and 60 minutes/);
  assert.match(durationFromPrompt('a 2 hour documentary').error, /between/);
  assert.deepEqual(durationFromPrompt('a 90-second reel'), { seconds: 90 });
});
