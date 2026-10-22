import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../backend/server.mjs';
import { Runner } from '../backend/runner.mjs';
import { diff, jobDelta } from '../backend/http.mjs';
import { applyPatch, applyJobDelta } from '../shared/delta.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const folders = [];
after(async () => { for (const folder of folders) await rm(folder, { recursive: true, force: true }); });
const fakeRunner = ({ store, root }) => new Runner({ root, store, statusCommand: async () => ({ stdout: '', stderr: 'no job', code: 1 }), codexRollouts: null,
  spawnProcess: (_command, _args, options) => spawn(process.execPath, [path.join(root, 'ui/tests/fake-cli.mjs')], options) });

test('deltas rebuild the next state exactly, including nulls, removed keys, nested objects and agent order', () => {
  const before = { status: 'running', gate: { id: 'g', decision: null }, progress: { done: 1, steps: [1, 2] }, error: '', old: 1,
    agents: [{ id: 'a', status: 'running', current: 'x' }, { id: 'b', status: 'done' }] };
  const after = { status: 'gate', gate: null, progress: { done: 2, steps: [1, 2, 3] }, error: '', fresh: { nested: true },
    agents: [{ id: 'b', status: 'done' }, { id: 'a', status: 'done', note: 'ok' }, { id: 'c', status: 'starting' }] };
  const delta = jobDelta(before, after);
  assert.deepEqual(applyJobDelta(before, delta), after);
  assert.equal(delta.agents.b, undefined, 'unchanged agents are not sent');
  assert.deepEqual(delta.agents.c, { $full: after.agents[2] });
  assert.equal(jobDelta(after, structuredClone(after)), null, 'no change, no delta');
  assert.deepEqual(applyPatch({ a: { b: 1, c: 2 } }, diff({ a: { b: 1, c: 2 } }, { a: { b: 1 } })), { a: { b: 1 } });
  // A sidebar card ignores fields it does not hold, and agent changes.
  const card = { status: 'running', progress: { done: 1 } };
  assert.deepEqual(applyJobDelta(card, { patch: { status: 'gate', pipeline: { checks: {} } }, agents: { a: { status: 'x' } } }, ['agents', 'pipeline']), { status: 'gate', progress: { done: 1 } });
});

async function readUntil(reader, state, predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate(state.text)) {
    if (Date.now() > deadline) throw new Error(`Stream did not deliver the expected data:\n${state.text.slice(-500)}`);
    const { value, done } = await reader.read(); if (done) break;
    state.text += new TextDecoder().decode(value);
  }
  return state.text;
}
const updates = text => [...text.matchAll(/^id: (\S+)\nevent: update\ndata: (.+)$/gm)].map(match => ({ id: match[1], ...JSON.parse(match[2]) }));

test('slow-link API: slim cards, revisioned deltas over a compressed stream, resume, trimmed outputs, paging, and cache validators', async t => {
  await mkdir(path.join(root, '.video'), { recursive: true });
  const folder = await mkdtemp(path.join(root, '.video/ui-test-')); folders.push(folder);
  const app = await createApp({ root, directory: path.join(folder, 'state'), runnerFactory: fakeRunner });
  const url = await app.start(0); t.after(() => app.close());
  const store = app.store;
  const job = store.create({ title: 'Slow link fixture', prompt: 'A fixture about slow links. '.repeat(80), provider: 'Codex', main: '', models: {}, format: 'landscape', duration: 60 });
  t.after(() => rm(path.join(root, job.jobPath), { recursive: true, force: true }));
  store.message(job, 'You', 'A fixture');
  job.agents.push({ id: 'a1', role: 'builder', status: 'running', result: 'R'.repeat(5000), promptPreview: 'The brief', lastMessage: 'M'.repeat(3000), usageLedger: { x: 1 } });
  store.save(job);

  // Thread cards and details are compressed and carry no heavy agent fields.
  const listResponse = await fetch(url + '/api/jobs', { headers: { 'Accept-Encoding': 'br' } });
  assert.equal(listResponse.headers.get('content-encoding'), 'br');
  const [listed] = await listResponse.json();
  assert.equal(listed.agents, undefined); assert.equal(typeof listed.rev, 'number');
  let detail = await (await fetch(url + `/api/jobs/${job.id}`)).json();
  assert.equal(detail.agents[0].result, undefined); assert.equal(detail.agents[0].promptPreview, undefined); assert.equal(detail.agents[0].usageLedger, undefined);
  assert.equal(detail.firstMessageId, job.messages[0].id);
  assert.equal((await (await fetch(url + `/api/jobs/${job.id}/agents/a1`)).json()).promptPreview, 'The brief');

  const sse = await fetch(url + '/api/stream', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(sse.headers.get('content-encoding'), 'gzip');
  const reader = sse.body.getReader(), state = { text: '' };
  await readUntil(reader, state, text => text.includes('event: connected'));

  // A change sends only the changed fields, on top of the revision the client holds.
  job.status = 'running'; job.agents[0].current = 'compositions/a.html'; job.agents[0].result = 'S'.repeat(5000); store.save(job);
  store.event(job, { type: 'tool', text: 'cat big', output: 'y'.repeat(5000), agentId: 'a1' });
  store.message(job, 'builder', 'Sub-agent note', 'a1');
  await readUntil(reader, state, text => updates(text).some(update => update.jobs.length && update.events.length));
  const update = updates(state.text).find(item => item.jobs.length);
  const [change] = update.jobs;
  assert.equal(change.base, detail.rev); assert.equal(change.rev, detail.rev + 1);
  assert.equal(change.patch.status, 'running'); assert.deepEqual(change.agents.a1, { current: 'compositions/a.html' }, 'a new result is not streamed');
  assert(JSON.stringify(update).length < 3000, 'a delta stays small');
  const event = update.events.find(item => item.text === 'cat big');
  assert.equal(event.output.length, 400); assert.equal(event.truncated, true); assert.equal(event.outputSize, 5000);
  const { messages, events, messagesMore, eventsFrom, ...base } = detail;
  const rebuilt = { ...applyJobDelta(base, change), rev: change.rev };
  const current = await (await fetch(url + `/api/jobs/${job.id}`)).json();
  for (const key of ['messages', 'events', 'messagesMore', 'eventsFrom']) delete current[key];
  assert.deepEqual(rebuilt, current, 'applying the delta reproduces the server state');
  detail = await (await fetch(url + `/api/jobs/${job.id}`)).json();
  assert(!detail.messages.some(message => message.agentId === 'a1'), 'sub-agent messages stay out of the thread payload');
  assert.equal((await (await fetch(url + `/api/jobs/${job.id}/messages?agent=a1`)).json()).length, 1);
  assert.equal((await (await fetch(url + `/api/jobs/${job.id}/events?agent=a1`)).json())[0].output.length, 400);
  const lastId = updates(state.text).at(-1).id;
  await reader.cancel();

  // Reconnecting with Last-Event-ID replays the missed batches instead of requiring a reload.
  job.title = 'Renamed while away'; store.save(job);
  await new Promise(resolve => setTimeout(resolve, 350));
  const again = await fetch(url + '/api/stream', { headers: { 'Last-Event-ID': lastId } });
  const replay = again.body.getReader(), replayed = { text: '' };
  await readUntil(replay, replayed, text => /"resumed":true/.test(text) && text.includes('Renamed while away'));
  await replay.cancel();
  const unknown = await fetch(url + '/api/stream', { headers: { 'Last-Event-ID': 'deadbeef-1' } });
  const fresh = unknown.body.getReader();
  assert.match(await readUntil(fresh, { text: '' }, text => text.includes('connected')), /"resumed":false/);
  await fresh.cancel();

  // Static files: compressed, validated, and fonts cached for good.
  const app1 = await fetch(url + '/app.mjs', { headers: { 'Accept-Encoding': 'br' } });
  assert.equal(app1.headers.get('content-encoding'), 'br'); await app1.arrayBuffer();
  assert.equal((await fetch(url + '/app.mjs', { headers: { 'If-None-Match': app1.headers.get('etag') } })).status, 304);
  assert.match((await fetch(url + '/fonts/inter-400.woff2')).headers.get('cache-control'), /immutable/);

  // Artifacts: validators, 304, and a stale If-Range falls back to the whole file.
  await mkdir(path.join(root, job.jobPath, 'renders'), { recursive: true });
  await writeFile(path.join(root, job.jobPath, 'renders/video.mp4'), '0123456789');
  const artifact = `${url}/api/jobs/${job.id}/artifact?path=${encodeURIComponent(job.jobPath + '/renders/video.mp4')}`;
  const media = await fetch(artifact); const tag = media.headers.get('etag'); await media.arrayBuffer();
  assert(tag); assert.match(media.headers.get('cache-control'), /no-cache/);
  assert.equal((await fetch(artifact, { headers: { 'If-None-Match': tag } })).status, 304);
  const resumedPart = await fetch(artifact, { headers: { Range: 'bytes=4-', 'If-Range': tag } });
  assert.equal(resumedPart.status, 206); assert.equal(await resumedPart.text(), '456789');
  const stale = await fetch(artifact, { headers: { Range: 'bytes=4-', 'If-Range': 'W/"other"' } });
  assert.equal(stale.status, 200); assert.equal(await stale.text(), '0123456789');
});
