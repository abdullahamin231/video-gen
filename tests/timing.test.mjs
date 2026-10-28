import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractNarration, normalizeWords, reconcile, browserCues} from '../lib/timing.mjs';
const wordsFor = text => text.split(' ').map((text,i) => ({id:`w${i}`,text,start:i*.5,end:i*.5+.4}));
test('extracts only blockquote narration from rich script', () => {
  assert.equal(extractNarration('# Title\n> “Run locally.”\n* Visual: a tower\n> "Then compare."'), 'Run locally.\n\nThen compare.');
});
test('rejects bad measured intervals', () => {
  for (const input of [[], [{text:'a',start:1,end:1.1},{text:'b',start:0,end:.1}],
    [{text:'a',start:0,end:3}], [{text:'a',start:'invalid',end:1}]])
    assert.throws(() => normalizeWords(input, 2));
});
test('drops punctuation-only ASR tokens left where a recording is cut mid-word', () => {
  const words = normalizeWords([{text:'look',start:0,end:.5},{text:'-',start:.5,end:.5},{text:'at',start:.6,end:.9},{text:'-',start:1.98,end:1.98}], 2);
  assert.deepEqual(words.map(w => `${w.id}:${w.text}`), ['w0:look', 'w1:at']);
  assert.throws(() => normalizeWords([{text:'-',start:0,end:0}], 2), /nonempty/);
});
test('reconciles middle excerpt and preserves differences', () => {
  const a = reconcile(wordsFor('these old cards cost less'), 'intro words these old chips cost much less ending words');
  assert.equal(a.excerpt.scriptStart,2); assert.equal(a.excerpt.scriptEnd,8);
  assert.equal(a.words[2].scriptIndex,null);
  assert.ok(a.discrepancies.some(d=>d.kind==='changed' && d.observed==='cards'));
  assert.ok(a.discrepancies.some(d=>d.kind==='omitted' && d.expected==='much'));
});
test('numeric prices retain one script token', () => {
  const a = reconcile(wordsFor('costs $6,950 today'), 'costs $6,950 today');
  assert.equal(a.matchRatio, 1);
});
test('exports compiled film cues for browser scenes', () => {
  const timing = {duration: 2, scenes: [{id: 'opening', start: 0, duration: 2,
    beats: [{id: 'device', at: 0.5, localAt: 0.5, duration: 0.7, targets: ['subject']}]}]};
  assert.equal(browserCues(timing).scenes.opening.beats.device.localAt, 0.5);
});
