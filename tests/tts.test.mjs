import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geminiSpeech, generateSpeech, readTtsStatus, GEMINI_TTS_MODEL, QUOTA_NOTICE } from '../lib/tts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

test('Gemini sends the transcript and delivery separately, and reads WAV audio from model output', async () => {
  const audio = wav(); let request;
  const result = await geminiSpeech('Only these words.', { speed: 1.1, env: { GEMINI_API_KEY: 'fixture-private-key' },
    fetchImpl: async (url, options) => {
      request = { url, ...options, body: JSON.parse(options.body) };
      return { ok: true, status: 200, json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: audio.toString('base64') }] }] }) };
    } });
  assert.deepEqual(result, audio);
  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(request.headers['x-goog-api-key'], 'fixture-private-key');
  assert.equal(request.body.model, GEMINI_TTS_MODEL);
  assert.equal(request.body.store, false);
  assert.equal(request.body.input[0].content[0].text, 'Only these words.');
  assert.match(request.body.input[0].content[0].annotations[0].style, /187 words per minute/);
  assert.equal(request.body.generation_config.speech_config[0].voice, 'Charon');
});

test('only usage-limit errors trigger quota fallback; keys and provider error bodies are not exposed', async () => {
  for (const status of [429, 400, 401, 403, 500]) {
    const error = await geminiSpeech('test', { env: { GEMINI_API_KEY: 'fixture-private-key' }, fetchImpl: async () => ({ status, ok: false,
      json: async () => ({ error: { message: 'fixture-private-key' } }) }) }).catch(error => error);
    assert.equal(error.code, status === 429 ? 'TTS_QUOTA' : undefined);
    assert(!error.message.includes('fixture-private-key'));
  }
  await assert.rejects(geminiSpeech('test', { env: {}, fetchImpl: () => { throw new Error('Should not call API'); } }), /needs GEMINI_API_KEY/);
  await assert.rejects(geminiSpeech('test', { env: { GOOGLE_API_KEY: 'fixture' }, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ steps: [] }) }) }), /complete WAV/);
});

test('a quota failure after one Gemini paragraph regenerates everything with Kokoro, joins real WAVs and persists fallback', async t => {
  const files = await fixture(t), kokoroTexts = [], notices = [];
  let geminiCalls = 0;
  const options = { ...files, provider: 'gemini', narration: true, text: '> First paragraph.\n\n> Second paragraph.', env: {} };
  const engines = {
    gemini: async () => { if (++geminiCalls === 2) throw Object.assign(new Error('quota'), { code: 'TTS_QUOTA' }); return wav(-1000); },
    kokoro: async (text, output) => {
      assert.equal((await readTtsStatus(files.statusFile)).usedProvider, 'kokoro', 'UI can show fallback before local synthesis finishes');
      kokoroTexts.push(text); await writeFile(output, wav(2000));
    },
    notify: message => notices.push(message),
  };
  const status = await generateSpeech(options, engines);
  assert.equal(status.status, 'complete'); assert.equal(status.usedProvider, 'kokoro');
  assert.deepEqual(kokoroTexts, ['First paragraph.', 'Second paragraph.']);
  assert.deepEqual(notices, [QUOTA_NOTICE]);
  const bytes = await readFile(files.output), data = bytes.indexOf(Buffer.from('data')) + 8;
  assert.equal(bytes.readInt16LE(data), 2000, 'first paragraph was replaced, not left as Gemini');
  assert.equal(bytes.readInt16LE(data + 24000 * 2 * 0.7), 2000, 'second paragraph is also Kokoro');
  assert.equal(bytes.readUInt32LE(data - 4) / 48000, 2.3, '0.1 + 0.6 + 0.1 seconds, plus 1.5 seconds trailing silence');
  assert.equal((await readTtsStatus(files.statusFile)).fallback.reason, 'quota');
  const resumed = await generateSpeech(options, engines);
  assert.equal(resumed.usedProvider, 'kokoro'); assert.equal(geminiCalls, 2, 'a resumed job does not spend more quota');
  assert.equal(notices.length, 1);
});

test('successful Gemini narration stays Gemini; authentication and local fallback failures preserve the old output', async t => {
  const files = await fixture(t);
  const options = { ...files, provider: 'gemini', text: 'Narration.', narration: true, env: {} };
  let localCalls = 0;
  const status = await generateSpeech(options, { gemini: async () => wav(), kokoro: async () => { localCalls++; } });
  assert.equal(status.usedProvider, 'gemini'); assert.equal(status.fallback, null);
  const original = await readFile(files.output);
  await assert.rejects(generateSpeech(options, { gemini: async () => { throw new Error('HTTP 403'); }, kokoro: async () => { localCalls++; } }), /HTTP 403/);
  assert.equal(localCalls, 0);
  assert.deepEqual(await readFile(files.output), original);
  assert.equal((await readTtsStatus(files.statusFile)).status, 'failed');
  await assert.rejects(generateSpeech(options, { gemini: async () => { throw Object.assign(new Error('quota'), { code: 'TTS_QUOTA' }); },
    kokoro: async () => { throw new Error('Kokoro unavailable'); }, notify() {} }), /Kokoro unavailable/);
  assert.deepEqual(await readFile(files.output), original);
  const failed = await readTtsStatus(files.statusFile);
  assert.equal(failed.status, 'failed'); assert.equal(failed.usedProvider, 'kokoro'); assert.equal(failed.fallback.reason, 'quota');
});
