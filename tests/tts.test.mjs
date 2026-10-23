import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geminiRequest, geminiSpeech, generateSpeech, readTtsStatus, GEMINI_TTS_MODEL, GEMINI_TTS_FALLBACK_MODEL, QUOTA_NOTICE } from '../lib/tts.mjs';
import http from 'node:http';
import { mingPlan } from '../lib/ming.mjs';

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
  const guide = await readFile(path.join(root, 'docs/tts.md'), 'utf8');
  const cues = [...guide.matchAll(/^\| `\[([^\]]+)\]` \|/gm)].map(match => match[1]);
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

test('Gemini transport uses IPv4 and preserves the request, audio response and provider errors', async t => {
  const audio = wav(), requests = [];
  const server = http.createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    requests.push({ key: request.headers['x-goog-api-key'], body: JSON.parse(body), length: request.headers['content-length'] });
    response.writeHead(request.url === '/error' ? 400 : 200, { 'Content-Type': 'application/json' });
    if (request.url === '/error') response.end(JSON.stringify({ error: { message: 'User location is not supported for the API use.' } }));
    else response.end(JSON.stringify({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: audio.toString('base64') }] }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  let route = '/';
  const fetchImpl = (_url, options) => geminiRequest(`http://localhost:${server.address().port}${route}`, options, (url, config, callback) => {
    assert.equal(config.family, 4, 'Gemini must not use the blocked IPv6 route');
    return http.request(url, config, callback);
  });
  assert.deepEqual(await geminiSpeech('Exact transcript.', { env: { GEMINI_API_KEY: 'fixture-private-key' }, fetchImpl }), audio);
  assert.equal(requests[0].key, 'fixture-private-key');
  assert.equal(requests[0].body.input[0].content[0].text, 'Exact transcript.');
  assert.equal(Number(requests[0].length), Buffer.byteLength(JSON.stringify(requests[0].body)));
  route = '/error';
  await assert.rejects(geminiSpeech('Exact transcript.', { env: { GEMINI_API_KEY: 'fixture-private-key' }, fetchImpl }), /HTTP 400: User location/);
});

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

test('only usage-limit errors trigger quota fallback; provider diagnostics redact API keys', async () => {
  for (const status of [429, 400, 401, 403, 500]) {
    const error = await geminiSpeech('test', { env: { GEMINI_API_KEY: 'fixture-private-key' }, fetchImpl: async () => ({ status, ok: false,
      json: async () => ({ error: { message: 'fixture-private-key' } }) }) }).catch(error => error);
    assert.equal(error.code, status === 429 ? 'TTS_QUOTA' : status === 500 ? 'TTS_UNAVAILABLE' : undefined);
    assert(!error.message.includes('fixture-private-key'));
  }
  await assert.rejects(geminiSpeech('test', { env: {}, fetchImpl: () => { throw new Error('Should not call API'); } }), /needs GEMINI_API_KEY/);
  await assert.rejects(geminiSpeech('test', { env: { GOOGLE_API_KEY: 'fixture' }, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ steps: [] }) }) }), /complete WAV/);
  await assert.rejects(geminiSpeech('test', { env: { GEMINI_API_KEY: 'fixture' }, fetchImpl: async () => ({ ok: false, status: 400,
    json: async () => ({ error: { message: 'User location is not supported for the API use.' } }) }) }),
  /HTTP 400: User location is not supported for the API use/);
});

test('temporary Gemini overload is retried on the same provider, with a bounded attempt count', async () => {
  let calls = 0; const delays = [], audio = wav();
  const options = { env: { GEMINI_API_KEY: 'fixture' }, retryDelay: async ms => { delays.push(ms); },
    fetchImpl: async () => ++calls < 3 ? { ok: false, status: 503 } : { ok: true, status: 200,
      json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: audio.toString('base64') }] }] }) } };
  assert.deepEqual(await geminiSpeech('test', options), audio);
  assert.equal(calls, 3); assert.deepEqual(delays, [1000, 2000]);
  calls = 0;
  await assert.rejects(geminiSpeech('test', { ...options, fetchImpl: async () => { calls++; return { ok: false, status: 503,
    json: async () => ({ error: { message: 'Model overloaded' } }) }; } }), /HTTP 503: Model overloaded/);
  assert.equal(calls, 3, 'persistent service errors stop instead of silently using another voice');
  calls = 0;
  await assert.rejects(geminiSpeech('test', { ...options, fetchImpl: async () => { calls++; return { ok: false, status: 429 }; } }), { code: 'TTS_QUOTA' });
  assert.equal(calls, 1, 'quota failures still switch to Kokoro immediately');
});

test('a whole-script Gemini quota failure uses Kokoro paragraphs, joins real WAVs and persists fallback', async t => {
  const files = await fixture(t), kokoroTexts = [], notices = [];
  let geminiCalls = 0;
  const options = { ...files, provider: 'gemini', narration: true, text: '> First paragraph.\n\n> Second paragraph.', env: { GEMINI_TTS_FALLBACK_MODEL: GEMINI_TTS_MODEL } };
  const engines = {
    gemini: async text => { geminiCalls++; assert.equal(text, 'First paragraph.\n\nSecond paragraph.'); throw Object.assign(new Error('quota'), { code: 'TTS_QUOTA' }); },
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
  assert.equal(bytes.readInt16LE(data), 2000, 'first paragraph is Kokoro');
  assert.equal(bytes.readInt16LE(data + 24000 * 2 * 0.7), 2000, 'second paragraph is also Kokoro');
  assert.equal(bytes.readUInt32LE(data - 4) / 48000, 2.3, '0.1 + 0.6 + 0.1 seconds, plus 1.5 seconds trailing silence');
  assert.equal((await readTtsStatus(files.statusFile)).fallback.reason, 'quota');
  const resumed = await generateSpeech(options, engines);
  assert.equal(resumed.usedProvider, 'kokoro'); assert.equal(geminiCalls, 1, 'a resumed job does not spend more quota');
  assert.equal(notices.length, 1);
});

test('successful Gemini narration stays Gemini; authentication and local fallback failures preserve the old output', async t => {
  const files = await fixture(t);
  const options = { ...files, provider: 'gemini', text: 'Narration.', narration: true, env: { GEMINI_TTS_FALLBACK_MODEL: GEMINI_TTS_MODEL } };
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

test('each Gemini model receives one request for the full script, and resumes stay on the backup', async t => {
  const files = await fixture(t), calls = [], notices = [];
  const options = { ...files, provider: 'gemini', narration: true, text: 'First paragraph.\n\nSecond paragraph.', env: {} };
  const engines = {
    gemini: async (text, { model }) => {
      calls.push({ text, model });
      if (model === GEMINI_TTS_MODEL) throw Object.assign(new Error('quota'), { code: 'TTS_QUOTA' });
      return wav(model === GEMINI_TTS_MODEL ? -1000 : 3000);
    },
    kokoro: async () => assert.fail('The backup Gemini model succeeded; do not use Kokoro'),
    notify: message => notices.push(message),
  };
  const status = await generateSpeech(options, engines);
  assert.equal(status.usedProvider, 'gemini'); assert.equal(status.model, GEMINI_TTS_FALLBACK_MODEL);
  assert.equal(status.requestedModel, GEMINI_TTS_MODEL); assert.equal(status.modelFallback.reason, 'quota'); assert.equal(status.fallback, null);
  assert.deepEqual(calls.map(c => c.model), [GEMINI_TTS_MODEL, GEMINI_TTS_FALLBACK_MODEL]);
  assert(calls.every(call => call.text === 'First paragraph.\n\nSecond paragraph.'), 'both models receive the entire script, with paragraph breaks');
  const bytes = await readFile(files.output), data = bytes.indexOf(Buffer.from('data')) + 8;
  assert.equal(bytes.readInt16LE(data), 3000, 'the entire recording uses the backup model');
  assert.equal(bytes.readUInt32LE(data - 4) / 48000, 1.6, 'one Gemini clip plus trailing silence, without artificial inter-paragraph gaps');
  const saved = await readTtsStatus(files.statusFile);
  assert.equal(saved.model, GEMINI_TTS_FALLBACK_MODEL); assert.equal(notices.length, 1);
  calls.length = 0;
  await generateSpeech(options, engines);
  assert.deepEqual(calls.map(c => c.model), [GEMINI_TTS_FALLBACK_MODEL]);
  assert.equal(notices.length, 1, 'resumes do not repeat the model-switch notification');
});

test('successful Gemini narration combines all paragraph text into exactly one request', async t => {
  const files = await fixture(t), calls = [];
  const paragraphs = Array.from({ length: 7 }, (_, index) => `Paragraph ${index + 1}.`);
  await generateSpeech({ ...files, provider: 'gemini', narration: true, text: paragraphs.join('\n\n'), env: {} }, {
    gemini: async text => { calls.push(text); return wav(); },
    kokoro: async () => assert.fail('Gemini succeeded'),
  });
  assert.deepEqual(calls, [paragraphs.join('\n\n')]);
});

test('both Gemini quotas exhausted use Kokoro, and subsequent retries skip both exhausted models', async t => {
  const files = await fixture(t), calls = [], notices = [];
  const options = { ...files, provider: 'gemini', narration: true, text: 'A complete recording.', env: {} };
  const engines = { gemini: async (_text, { model }) => { calls.push(model); throw Object.assign(new Error('quota'), { code: 'TTS_QUOTA' }); },
    kokoro: async (_text, file) => writeFile(file, wav()), notify: message => notices.push(message) };
  const status = await generateSpeech(options, engines);
  assert.deepEqual(calls, [GEMINI_TTS_MODEL, GEMINI_TTS_FALLBACK_MODEL]);
  assert.equal(status.usedProvider, 'kokoro'); assert.equal(status.fallback.reason, 'quota');
  assert.equal(notices.length, 2); assert.equal(notices[1], QUOTA_NOTICE);
  await generateSpeech(options, engines);
  assert.equal(calls.length, 2);
});

test('persistent service overload tries the backup; invalid requests stop, and backup overload does not masquerade as quota', async t => {
  const files = await fixture(t), calls = [];
  const options = { ...files, provider: 'gemini', text: 'A recording.', env: {} };
  const engines = { gemini: async (_text, { model }) => {
    calls.push(model); if (model === GEMINI_TTS_MODEL) throw Object.assign(new Error('overload'), { code: 'TTS_UNAVAILABLE' }); return wav();
  }, kokoro: async () => assert.fail('Service overload is not quota exhaustion'), notify() {} };
  const status = await generateSpeech(options, engines);
  assert.deepEqual(calls, [GEMINI_TTS_MODEL, GEMINI_TTS_FALLBACK_MODEL]);
  assert.equal(status.modelFallback.reason, 'unavailable');
  // A new requested primary starts a new chain, independent of the saved fallback.
  const custom = { ...options, env: { GEMINI_TTS_MODEL: 'custom-primary', GEMINI_TTS_FALLBACK_MODEL: 'custom-backup' } };
  calls.length = 0;
  await assert.rejects(generateSpeech(custom, { ...engines, gemini: async (_text, { model }) => { calls.push(model); throw new Error('HTTP 400: Invalid request'); } }), /HTTP 400/);
  assert.deepEqual(calls, ['custom-primary']);
  calls.length = 0;
  await assert.rejects(generateSpeech(custom, { ...engines, gemini: async (_text, { model }) => {
    calls.push(model); throw Object.assign(new Error('HTTP 503: overloaded'), { code: 'TTS_UNAVAILABLE' });
  } }), /HTTP 503/);
  assert.deepEqual(calls, ['custom-primary', 'custom-backup']);
});
