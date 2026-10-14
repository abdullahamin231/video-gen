import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractNarration, normalizeWords, reconcile, resolveCue, compilePlan, browserCues} from '../lib/timing.mjs';
const wordsFor = text => text.split(' ').map((text,i) => ({id:`w${i}`,text,start:i*.5,end:i*.5+.4}));
test('extracts only blockquote narration from rich script', () => {
  assert.equal(extractNarration('# Title\n> “Run locally.”\n* Visual: a tower\n> "Then compare."'), 'Run locally.\n\nThen compare.');
});
test('rejects bad measured intervals', () => {
  for (const input of [[], [{text:'a',start:1,end:1.1},{text:'b',start:0,end:.1}],
    [{text:'a',start:0,end:3}], [{text:'a',start:'invalid',end:1}]])
    assert.throws(() => normalizeWords(input, 2));
});
test('reconciles middle excerpt and preserves differences', () => {
  const a = reconcile(wordsFor('these old cards cost less'), 'intro words these old chips cost much less ending words');
  assert.equal(a.excerpt.scriptStart,2); assert.equal(a.excerpt.scriptEnd,8);
  assert.equal(a.words[2].scriptIndex,null);
  assert.ok(a.discrepancies.some(d=>d.kind==='changed' && d.observed==='cards'));
  assert.ok(a.discrepancies.some(d=>d.kind==='omitted' && d.expected==='much'));
});
test('resolves punctuation-insensitive cues and rejects ambiguity', () => {
  const a = reconcile(wordsFor('One model then one model'), 'One model then one model');
  assert.throws(()=>resolveCue({phrase:'one model'},a,3),/Ambiguous/);
  assert.equal(resolveCue({phrase:'ONE model!',occurrence:2,edge:'end'},a,3),2.4);
  assert.equal(resolveCue({wordId:'w2',offset:.1},a,3),1.1);
  assert.throws(()=>resolveCue({phrase:'unspoken words'},a,3),/not found/);
  assert.throws(()=>resolveCue({wordId:'w0',offset:-1},a,3),/outside/);
  assert.throws(()=>resolveCue({phrase:'one model',occurrence:0},a,3),/occurrence/);
});
test('numeric prices retain one cue token', () => {
  const a = reconcile(wordsFor('costs $6,950 today'), 'costs $6,950 today');
  assert.equal(a.matchRatio,1);
  assert.equal(resolveCue({phrase:'6,950'},a,2),.5);
});
const plan = () => ({version:1,scenes:[{id:'opening',file:'compositions/opening.html',purpose:'Show the machine',
  start:{boundary:'start'},end:{boundary:'end'},beats:[{id:'build',cue:{wordId:'w1'},duration:.5,
  targets:['#opening-tower'],purpose:'Make hardware tangible',visual:'Assemble a tower',action:'assemble'}]}]});
test('resolves local cues with advisory pacing checks', () => {
  const a = reconcile(wordsFor('a local machine'),'a local machine');
  const t = compilePlan(plan(),a,12);
  assert.equal(t.scenes[0].beats[0].localAt,.5);
  assert.ok(t.warnings.some(w=>w.includes('front-loaded')));
  assert.equal(browserCues(t).scenes.opening.beats.build.at,.5);
});
test('permits custom creative actions', () => {
  const p = plan(); p.scenes[0].beats[0].action='metaphorical-collapse';
  assert.equal(compilePlan(p,reconcile(wordsFor('a local machine'),'a local machine'),2).scenes[0].beats[0].action,'metaphorical-collapse');
});
test('rejects gaps, duplicate beats, unsafe paths, and overruns', () => {
  const a = reconcile(wordsFor('a local machine'),'a local machine');
  const gap=plan();gap.scenes[0].start={wordId:'w1'};assert.throws(()=>compilePlan(gap,a,2),/gap/);
  const dup=plan();dup.scenes[0].beats.push({...dup.scenes[0].beats[0]});assert.throws(()=>compilePlan(dup,a,2),/duplicate beat/);
  const unsafe=plan();unsafe.scenes[0].file='compositions/../index.html';assert.throws(()=>compilePlan(unsafe,a,2),/Invalid scene file/);
  const over=plan();over.scenes[0].beats[0].duration=3;assert.throws(()=>compilePlan(over,a,2),/outside/);
});
test('low match needs recorded review, not silent speech correction', () => {
  const a = reconcile(wordsFor('a different machine'),'a local machine');
  assert.throws(()=>compilePlan(plan(),a,2),/Low script match/);
  a.review={approved:true,note:'Listened: speaker says different; preserve actual speech.'};
  assert.equal(compilePlan(plan(),a,2).scenes.length,1);
});
