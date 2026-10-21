import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createApp } from '../backend/server.mjs';
import { Store } from '../backend/store.mjs';
import { Runner } from '../backend/runner.mjs';
import { orchestratorPrompt } from '../backend/prompt.mjs';
import { computeProgress } from '../backend/progress.mjs';
import { QUOTA_NOTICE, GEMINI_TTS_MODEL, GEMINI_TTS_FALLBACK_MODEL } from '../../lib/tts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaults = { title: 'Narration fixture', prompt: 'A video about batteries', provider: 'Codex', format: 'landscape', gateScript: false, gatePrototype: false };
async function fixture() {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const folder = await mkdtemp(path.join(root, '.cache/ui-tts-test-'));
  return folder;
}

test('new job API defaults to Kokoro, stores Gemini, rejects unknown voices and preserves selection when crew settings change', async t => {
  const directory = await fixture(t);
  const app = await createApp({ root, directory, runnerFactory: ({ store }) => ({
    initialize() {}, shutdown() { store.flush(); }, create: input => store.create(input), syncHumanReview() {},
  }) });
  const url = await app.start(0); t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const request = (method, route, data) => fetch(url + route, { method,
    headers: { 'Content-Type': 'application/json', 'X-Video-Client': '1' }, body: JSON.stringify(data) });
  const local = await request('POST', '/api/jobs', defaults);
  assert.equal(local.status, 201); assert.equal((await local.json()).ttsProvider, 'kokoro');
  const response = await request('POST', '/api/jobs', { ...defaults, ttsProvider: 'gemini' });
  assert.equal(response.status, 201); const gemini = await response.json();
  assert.equal(gemini.ttsProvider, 'gemini');
  const changed = await request('PATCH', `/api/jobs/${gemini.id}`, defaults);
  assert.equal(changed.status, 200); assert.equal((await changed.json()).ttsProvider, 'gemini');
  assert.equal((await request('POST', '/api/jobs', { ...defaults, ttsProvider: 'unknown' })).status, 400);
  const source = await (await fetch(url + '/app.mjs')).text();
  assert.match(source, /select name="ttsProvider"/); assert.match(source, /value="kokoro"/); assert.match(source, /value="gemini"/);
});

test('runner passes selected narration to the CLI and shows one durable fallback notice across restarts', async t => {
  const directory = await fixture(t), store = new Store(path.join(directory, 'state'));
  const job = store.create({ ...defaults, ttsProvider: 'gemini' });
  job.scriptPath = path.relative(root, path.join(directory, 'script')); job.status = 'running';
  await mkdir(path.join(root, job.scriptPath), { recursive: true });
  let childEnv;
  const runner = new Runner({ root, store, codexRollouts: null, spawnProcess: (_command, _args, options) => {
    childEnv = options.env;
    return spawn(process.execPath, [path.join(root, 'ui/tests/fake-cli.mjs')], options);
  } });
  t.after(async () => { await runner.shutdown(); await rm(directory, { recursive: true, force: true }); });
  await runner.runAgent(job, { role: 'orchestrator', prompt: 'Fixture only' });
  assert.equal(childEnv.VIDEO_TTS_PROVIDER, 'gemini');
  assert.equal(childEnv.VIDEO_TTS_STATUS, path.join(root, job.scriptPath, 'tts-status.json'));
  await writeFile(childEnv.VIDEO_TTS_STATUS, JSON.stringify({ requestedProvider: 'gemini', usedProvider: 'gemini', status: 'generating',
    model: GEMINI_TTS_FALLBACK_MODEL, modelFallback: { from: GEMINI_TTS_MODEL, to: GEMINI_TTS_FALLBACK_MODEL, reason: 'quota' } }));
  await runner.syncNarration(job); await runner.syncNarration(job);
  assert.equal(job.ttsStatus.model, GEMINI_TTS_FALLBACK_MODEL);
  assert.equal(job.messages.filter(m => m.role === 'narration').length, 1, 'the backup-model notice is shown once');
  assert.match(computeProgress(job).phases[0].steps.find(step => step.id === 'narration').detail, /gemini-3.8-flash-lite-tts/);
  await writeFile(childEnv.VIDEO_TTS_STATUS, JSON.stringify({ requestedProvider: 'gemini', usedProvider: 'kokoro', status: 'generating', fallback: { reason: 'quota' } }));
  await runner.syncNarration(job); await runner.syncNarration(job);
  assert.equal(job.ttsStatus.usedProvider, 'kokoro');
  assert.deepEqual(job.messages.filter(m => m.role === 'narration' && m.text === QUOTA_NOTICE).map(m => m.text), [QUOTA_NOTICE]);
  store.flush();
  const restored = new Store(store.directory), restoredJob = restored.get(job.id);
  const resumed = new Runner({ root, store: restored, codexRollouts: null });
  await resumed.syncNarration(restoredJob);
  assert.equal(restoredJob.messages.filter(m => m.role === 'narration').length, 2);
  restored.flush(); await resumed.shutdown();
  const progress = computeProgress(job, { files: [] });
  const narration = progress.phases[0].steps.find(step => step.id === 'narration');
  assert.equal(narration.label, 'Narration (Kokoro)'); assert.match(narration.detail, /Gemini usage limit reached/);
  job.audioPath = 'recording.wav'; job.ttsStatus = null;
  await runner.syncNarration(job); assert.equal(job.ttsStatus, null, 'a supplied recording bypasses generated narration state');
});

test('fresh and resumed prompts use a whole-script command and selected provider, while supplied recordings bypass TTS', () => {
  const job = { ...defaults, id: 'test', slug: 'test', scriptPath: 'jobs/scripts/test', jobPath: 'jobs/test', ttsProvider: 'gemini' };
  for (const resume of [false, true]) {
    const prompt = orchestratorPrompt(job, { resume });
    assert.match(prompt, /tts jobs\/scripts\/test\/SCRIPT.md --narration --provider gemini --status jobs\/scripts\/test\/tts-status.json/);
    assert.match(prompt, /Do not generate paragraphs separately/);
  }
  const supplied = orchestratorPrompt({ ...job, audioPath: 'inputs/recording.wav' });
  assert.match(supplied, /Keep it unchanged/);
  assert(!supplied.includes('--provider gemini'));
});
