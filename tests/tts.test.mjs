import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSpeech, readTtsStatus } from '../lib/narration.mjs';
import { mingPlan } from '../lib/narration.mjs';

test('Ming IP plans preserve text and pacing and reject free-form instructions', () => {
  const plan = mingPlan('First thought. Second thought.', {
    segments: [
      { text: 'First thought.', speed: 1.04, pauseAfter: 0.45 },
      { text: 'Second thought.', speed: 0.96, pauseAfter: 0 },
    ],
  }, 1.1);
  assert.deepEqual(plan.segments, [
    { text: 'First thought.', speed: 1.04 * 1.1, pauseAfter: 0.45 },
    { text: 'Second thought.', speed: 0.96 * 1.1, pauseAfter: 0 },
  ]);
  assert.throws(() => mingPlan('Changed words.', { segments: [{ text: 'Original words.' }] }), /exact reviewed narration/);
  const expressiveText = '[Surprise-oh] Wait... why is the server still running? [Breathing] Disconnect the network first. [Sigh] There. [Laughter] We caught it in time.';
  const spokenText = 'Wait... why is the server still running? Disconnect the network first. There. We caught it in time.';
  assert.equal(mingPlan(spokenText, { segments: [{ text: expressiveText }] }).segments[0].text, expressiveText,
    'supported inline cues reach synthesis while matching the clean reviewed script');
  for (const value of ['Free-form direction.', '', null]) {
    assert.throws(() => mingPlan('Words.', { voiceInstruction: value, segments: [{ text: 'Words.' }] }), /Remove voiceInstruction/);
    assert.throws(() => mingPlan('Words.', { segments: [{ text: 'Words.', instruction: value }] }), /Remove instruction from segment 1/);
  }
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('Ming accepts the complete documented inline cue catalog', async () => {
  const guide = await readFile(path.join(root, 'docs/audio.md'), 'utf8');
  const cues = [...guide.matchAll(/`\[([^\]]+)\]`/g)].map(match => match[1]);
  assert.equal(cues.length, 14, 'the complete pinned upstream catalog is documented');
  for (const cue of cues) {
    const text = `[${cue}] These are the reviewed words.`;
    assert.equal(mingPlan('These are the reviewed words.', { segments: [{ text }] }).segments[0].text, text);
  }
  assert.throws(() => mingPlan('Words.', { segments: [{ text: '[Gasp] Words.' }] }), /Unsupported Ming cue/);
});

async function fixture(t) {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const dir = await mkdtemp(path.join(root, '.cache/tts-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, output: path.join(dir, 'narration.wav'), statusFile: path.join(dir, 'tts-status.json') };
}
function wav(sample = 1000) {
  const pcm = Buffer.alloc(4800);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(sample, i);
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

test('Ming receives the complete plan once, records continuity and preserves existing audio on failure', async t => {
  const files = await fixture(t), calls = [];
  const performance = { segments: [{ text: 'First paragraph.' }, { text: 'Second paragraph.' }] };
  const options = { ...files, text: 'First paragraph.\n\nSecond paragraph.', narration: true, provider: 'ming', performance };
  const engines = {
    ming: async (text, output, opts) => { calls.push({ text, opts }); await writeFile(output, wav()); },
  };
  await generateSpeech(options, engines);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, options.text);
  assert.deepEqual(calls[0].opts.performance, performance);
  const status = await readTtsStatus(files.statusFile);
  assert.equal(status.voice, 'US_James');
  assert.equal(status.continuityMode, 'fixed-acoustic-reference-v2');
  const previous = await readFile(files.output);
  await assert.rejects(generateSpeech(options, { ...engines, ming: async () => { throw new Error('reference encoding failed'); } }), /reference encoding failed/);
  assert.deepEqual(await readFile(files.output), previous);
  assert.equal((await readTtsStatus(files.statusFile)).status, 'failed');
});


test('removed narration providers are rejected before generation',async t=>{
  const files=await fixture(t);
  for(const provider of ['kokoro','gemini']) await assert.rejects(generateSpeech({...files,text:'Words.',provider}),/only narration provider/);
});

test('a short take fails its duration target without replacing existing narration', async t => {
  const files = await fixture(t);
  await writeFile(files.output, 'preserve prior take');
  const options = {...files, text: 'Complete reviewed narration.', targetSeconds: 60};
  const ming = async (text, output) => writeFile(output, wav());
  await assert.rejects(generateSpeech(options, {ming}), /Narration is 0.10s; target is 60s/);
  assert.equal(await readFile(files.output, 'utf8'), 'preserve prior take');
  const status = await readTtsStatus(files.statusFile);
  assert.equal(status.status, 'failed');
  assert.equal(status.durationSeconds, 0.1);
  assert.equal(status.targetSeconds, 60);
  assert.equal((await readFile(status.rejectedOutput)).toString('ascii', 0, 4), 'RIFF');
  await generateSpeech({...options, targetSeconds: 0.1, durationTolerance: 0.01}, {ming});
  assert.equal((await readTtsStatus(files.statusFile)).status, 'complete');
});

test('a model failure keeps partial audio for diagnosis without approving or replacing a take', async t => {
  const files = await fixture(t);
  await writeFile(files.output, 'prior take');
  await assert.rejects(generateSpeech({...files, text: 'Opening and ending.'}, {
    ming: async (text, output) => {await writeFile(output, wav()); throw new Error('Silent ending fragment');},
  }), /Silent ending fragment/);
  const status = await readTtsStatus(files.statusFile);
  assert.equal(status.status, 'failed');
  assert.deepEqual(await readFile(status.rejectedOutput), wav());
  assert.equal(await readFile(files.output, 'utf8'), 'prior take');
});
