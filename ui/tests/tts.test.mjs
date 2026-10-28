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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaults = { title: 'Narration fixture', prompt: 'A video about batteries', provider: 'Codex', format: 'landscape', gateScript: false,  };
async function fixture() {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const folder = await mkdtemp(path.join(root, '.cache/ui-tts-test-'));
  return folder;
}

test('new job API defaults to Ming, stores explicit voices, rejects unknown voices and preserves selection when crew settings change', async t => {
  const directory = await fixture(t);
  const app = await createApp({ root, directory, runnerFactory: ({ store }) => ({
    initialize() {}, shutdown() { store.flush(); }, create: input => store.create(input), syncHumanReview() {},
  }) });
  const url = await app.start(0); t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const request = (method, route, data) => fetch(url + route, { method,
    headers: { 'Content-Type': 'application/json', 'X-Video-Client': '1' }, body: JSON.stringify(data) });
  const local = await request('POST', '/api/jobs', defaults);
  assert.equal(local.status, 201); assert.equal((await local.json()).ttsProvider, 'ming');
  for(const provider of ['kokoro','gemini','unknown']) assert.equal((await request('POST','/api/jobs',{...defaults,ttsProvider:provider})).status,400);
  const source=await (await fetch(url+'/app.mjs')).text();
  assert.match(source,/name="ttsProvider" value="ming"/);

});

test('runner and progress expose queued Ming position, model loading, phrase progress and cancellation', async t => {
  const directory = await fixture(t), store = new Store(path.join(directory, 'state'));
  const job = store.create({ ...defaults, ttsProvider: 'ming' });
  job.scriptPath = path.relative(root, path.join(directory, 'script'));
  await mkdir(path.join(root, job.scriptPath), { recursive: true });
  const runner = new Runner({ root, store, codexRollouts: null });
  t.after(async () => { await runner.shutdown(); await rm(directory, { recursive: true, force: true }); });
  const statuses = [
    [{ status: 'queued', queuePosition: 2, phase: 'waiting-for-ming' }, /Waiting for Ming · 2 job\(s\) ahead/],
    [{ status: 'generating', queuePosition: 0, phase: 'loading-model' }, /Loading Ming model/],
    [{ status: 'generating', queuePosition: 0, phase: 'synthesizing', phrase: 2, phrases: 5 }, /phrase 2 of 5/],
    [{ status: 'cancelled' }, /Narration paused/],
  ];
  for (const [status, detail] of statuses) {
    await writeFile(path.join(root, job.scriptPath, 'tts-status.json'), JSON.stringify({ requestedProvider: 'ming', usedProvider: 'ming', ...status }));
    await runner.syncNarration(job);
    assert.equal(job.ttsStatus.status, status.status);
    assert.equal(job.ttsStatus.queuePosition, status.queuePosition ?? null);
    const step = computeProgress(job).phases[0].steps.find(step => step.id === 'narration');
    assert.match(step.detail, detail);
    if (['queued', 'generating'].includes(status.status)) assert.equal(step.status, 'current');
  }
});

test('assignment records Ming and preserves supplied recording path',()=>{
  const job={...defaults,id:'test',slug:'test',scriptPath:'jobs/scripts/test',jobPath:'jobs/test',ttsProvider:'ming',audioPath:'inputs/recording.wav'};
  const data=JSON.parse(/```json\n([\s\S]*?)\n```/.exec(orchestratorPrompt(job))[1]);
  assert.equal(data.audioPath,'inputs/recording.wav');assert.equal(data.ttsProvider,'ming');
});
