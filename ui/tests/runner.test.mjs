import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, stat, access } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../backend/store.mjs';
import { Runner } from '../backend/runner.mjs';
import { invocation } from '../backend/providers.mjs';
import { normalize, redact, parseNext, pipelineCommand, describeTask, fileFromCommand } from '../backend/events.mjs';
import { jobFile, parseRange } from '../backend/files.mjs';
import { createApp } from '../backend/server.mjs';
import { tokens, applyUsage, totalUsage, codexWindows } from '../backend/usage.mjs';
import { computeProgress, computeHealth, scriptDisposition } from '../backend/progress.mjs';
import { routeModel } from '../shared/routing.mjs';
import { orchestratorPrompt } from '../backend/prompt.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaults = { title: 'Runner integration', prompt: 'A one-minute test fixture only', provider: 'Codex', main: '', models: {}, format: 'landscape', duration: 60, gateScript: false, gatePrototype: false };
const testFolders = [];
after(async () => { for (const folder of testFolders) await rm(folder, { recursive: true, force: true }); });
async function workspace() {
  await mkdir(path.join(root, '.video'), { recursive: true });
  const folder = await mkdtemp(path.join(root, '.video/ui-test-'));
  testFolders.push(folder); return folder;
}
async function until(fn, message = 'condition') {
  const deadline = Date.now() + 10000;
  while (!fn()) { if (Date.now() > deadline) throw new Error(`Timed out waiting for ${message}`); await new Promise(resolve => setTimeout(resolve, 20)); }
}
const noStatus = async () => ({ stdout: '', stderr: 'no job', code: 1 });
function fakeRunner({ store, root }, env = {}, statusCommand = noStatus) {
  return new Runner({ root, store, statusCommand, codexRollouts: null, spawnProcess: (_command, _args, options) => spawn(process.execPath, [path.join(root, 'ui/tests/fake-cli.mjs')], { ...options, env: { ...options.env, ...env } }) });
}
const post = (url, pathname, data, headers = {}) => fetch(url + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Video-Client': '1', ...headers }, body: JSON.stringify(data) });

test('normalizers keep file paths; a failed tool call is recoverable, a provider failure is fatal', () => {
  const code = normalize('Codex', { type: 'item.completed', item: { id: 'a', type: 'file_change', changes: [{ kind: 'update', path: 'jobs/test/shots/a.json' }] } });
  assert.equal(code[0].file, 'jobs/test/shots/a.json');
  assert.equal(normalize('Codex', { type: 'turn.failed', error: { message: 'bad login' } })[0].fatal, true);
  const grep = normalize('Codex', { type: 'item.completed', item: { id: 'g', type: 'command_execution', command: 'grep x y', exit_code: 1, aggregated_output: '' } });
  assert.equal(grep[0].type, 'tool'); assert.equal(grep[0].status, 'failed');
  const claude = normalize('Claude', { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-a', name: 'Edit', input: { file_path: 'shots/1.json' } }] } });
  assert.equal(claude[0].operation, 'editing');
  const result = normalize('Claude', { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-a', is_error: true, content: 'retry' }] } });
  assert.equal(result[0].type, 'tool'); assert.equal(result[0].status, 'failed'); assert.equal(result[0].fatal, undefined);
  const open = normalize('OpenCode', { type: 'tool_use', sessionID: 'session', part: { tool: 'write', callID: 'call', state: { status: 'completed', input: { filePath: 'a.md' }, output: 'saved' } } });
  assert.equal(open[1].file, 'a.md'); assert.equal(open[1].status, 'completed');
  assert.equal(redact('api_key=secret-key-here'), 'api_key=[redacted]');
});

test('pipeline commands, next output, shell file reads and brief tasks are recognised', () => {
  assert.deepEqual(pipelineCommand("bash -lc 'npm run video -- render --job jobs/x-1/'"), { command: 'render', job: 'jobs/x-1' });
  assert.deepEqual(pipelineCommand('node scripts/video.mjs status --json --job jobs/y'), { command: 'status', job: 'jobs/y' });
  assert.equal(pipelineCommand('npx hyperframes tts "Hello" --voice am_michael').command, 'tts');
  assert.equal(pipelineCommand('ls jobs'), null);
  const told = parseNext('STATE: independent final review (a, b)\nDO: spawn 2 fresh sub-agents\n      video-reviewer: "Read /r/jobs/x/briefs/review-final-a.md and follow it exactly."\nTHEN: npm run video -- next --job jobs/x');
  assert.equal(told.state, 'independent final review (a, b)'); assert.deepEqual(told.spawns, [{ role: 'reviewer', brief: 'jobs/x/briefs/review-final-a.md' }]);
  assert.equal(fileFromCommand('sed -n 1,40p jobs/x/film.json'), 'jobs/x/film.json');
  assert.deepEqual(describeTask('builder', 'Read jobs/x/briefs/build-spam.md and follow it exactly.'), { brief: 'jobs/x/briefs/build-spam.md', scene: 'spam', task: 'Build scene “spam”', stage: '' });
  assert.equal(describeTask('reviewer', 'Read jobs/x/briefs/review-prototype-visual-mechanism.md and follow it exactly.').stage, 'prototype');
});

test('job token accounting reconciles Claude placeholders and resumed costs without double counting', () => {
  assert.deepEqual(tokens('Codex', { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20 }), { input: 100, output: 20, cached: 40, cacheWrite: 0, reasoning: 0, total: 120 });
  assert.equal(tokens('Claude', { input_tokens: 10, cache_read_input_tokens: 80, cache_creation_input_tokens: 10, output_tokens: 5 }).total, 105);
  const agent = {};
  const partial = { usage: { input_tokens: 10, cache_read_input_tokens: 80, output_tokens: 1 }, usageKey: 'message:1', fromAssistant: true };
  applyUsage(agent, 'Claude', partial, 'run1', 1, false); applyUsage(agent, 'Claude', partial, 'run1', 2, true);
  assert.equal(agent.usage.total, 91);
  applyUsage(agent, 'Claude', { usage: { input_tokens: 10, cache_read_input_tokens: 80, output_tokens: 20 }, fallbackOnly: true, cost: .1 }, 'run1', 3, true);
  assert.equal(agent.usage.total, 110); assert.equal(agent.usage.reportedCostUSD, .1);
  applyUsage(agent, 'Claude', { usage: { input_tokens: 20, output_tokens: 30 }, fallbackOnly: true, cost: .15 }, 'run2', 1, false);
  assert.equal(agent.usage.total, 160); assert(Math.abs(agent.usage.reportedCostUSD - .15) < .00001);
  const open = {}; const step = { usage: { input: 100, output: 10, cache: { read: 30 } }, usageKey: 'step:1', cost: .02 };
  applyUsage(open, 'OpenCode', step, 'o', 1, false); applyUsage(open, 'OpenCode', step, 'o', 2, false);
  assert.equal(open.usage.total, 140); assert.equal(open.usage.reportedCostUSD, .02);
  assert.equal(totalUsage([agent, open]).total, 300);
  const windows = codexWindows({ rateLimitsByLimitId: { codex: { limitId: 'codex', primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1800000000 } } } });
  assert.equal(windows[0].remainingPercent, 75); assert.equal(windows[0].windowMinutes, 300);
});

test('CLI arguments disable built-in sub-agents, use repo agent types, and route models by role', () => {
  const options = { model: 'model; touch /not-a-shell', session: 'session-1', root, bridge: '/repo/bridge.mjs', env: { VIDEO_RUNNER_TOKEN: 'private' } };
  const codex = invocation('Codex', options);
  assert(codex.args.includes(options.model)); assert(codex.args.includes('resume')); assert(codex.args.includes('session-1'));
  assert.equal(codex.args[codex.args.indexOf('--disable') + 1], 'multi_agent');
  // Codex still offers spawn_agent with multi_agent off; one thread per session makes every spawn fail.
  assert(codex.args.includes('features.multi_agent_v2.max_concurrent_threads_per_session=1'));
  assert.equal(codex.env.NODE_NO_WARNINGS, '1');
  assert(!codex.args.join(' ').includes('private')); assert(!codex.args.includes('--dangerously-bypass-approvals-and-sandbox'));
  const claude = invocation('Claude', { ...options, agentType: 'video-builder' });
  // Long renders finish in one Bash call instead of being backgrounded and polled.
  assert.equal(claude.env.BASH_DEFAULT_TIMEOUT_MS, '3600000'); assert.equal(claude.env.BASH_MAX_TIMEOUT_MS, '3600000');
  assert.equal(claude.args[claude.args.indexOf('--disallowedTools') + 1], 'Agent,Task'); assert.equal(claude.args[claude.args.indexOf('--agent') + 1], 'video-builder');
  const open = invocation('OpenCode', options); const config = JSON.parse(open.env.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.permission.task, 'deny'); assert.equal(config.mcp.video_runner.command[1], options.bridge);
  const pins = { 'video-builder': 'haiku', 'video-director': 'opus', 'video-reviewer': 'opus' };
  assert.deepEqual(routeModel({ provider: 'Claude', main: '' }, 'builder', pins), { model: 'haiku', source: 'repo pin (.claude/agents/video-builder.md)' });
  assert.deepEqual(routeModel({ provider: 'Claude', main: 'sonnet', models: { builder: 'x' } }, 'builder', pins), { model: 'x', source: 'your choice' });
  // Each role is set on its own: choosing the director's model leaves the thumbnail maker on its pin.
  const split = { provider: 'Claude', main: '', models: { director: 'sonnet', reviewer: 'haiku' } };
  assert.equal(routeModel(split, 'director', pins).model, 'sonnet'); assert.equal(routeModel(split, 'thumbnail-maker', pins).model, 'opus');
  assert.equal(routeModel(split, 'reviewer', pins).model, 'haiku'); assert.equal(routeModel(split, 'thumbnail-reviewer', pins).model, 'opus');
  // Threads saved before per-role models keep routing through their shared fields.
  assert.equal(routeModel({ provider: 'Claude', main: 'sonnet', sub: 'x' }, 'builder', pins).model, 'x');
  assert.equal(routeModel({ provider: 'Claude', directorModel: 'y' }, 'thumbnail-maker', pins).model, 'y');
  assert.equal(routeModel({ provider: 'Claude', main: 'sonnet', models: { director: 'z' } }, 'orchestrator', pins).model, 'sonnet');
  // Blank roles take the provider's default for their tier, not the orchestrator's model.
  assert.deepEqual(routeModel({ provider: 'Codex', main: 'gpt' }, 'reviewer', pins), { model: 'gpt-6-luna', source: 'Codex weak default' });
  assert.deepEqual(routeModel({ provider: 'Codex', main: 'gpt' }, 'script-writer', pins), { model: 'gpt-6.1-sol', source: 'Codex strong default' });
  assert.equal(routeModel({ provider: 'Codex', main: 'gpt' }, 'orchestrator', pins).model, 'gpt');
  assert.equal(routeModel({ provider: 'Codex', main: '' }, 'orchestrator', pins).model, 'gpt-6-luna');
  assert.equal(routeModel({ provider: 'OpenCode', main: '' }, 'director', pins).model, 'opencode/glm-5.3-flash');
  assert.equal(routeModel({ provider: 'OpenCode', main: '' }, 'script-writer', pins).model, 'opencode/deepseek-v4.1-flash-free');
  assert.equal(routeModel({ provider: 'OpenCode', main: '' }, 'builder', pins).model, 'opencode/glm-5.3-flash');
  assert.equal(routeModel({ provider: 'Claude', main: '' }, 'orchestrator', pins).model, 'claude-haiku-5-5');
  assert.equal(routeModel({ provider: 'Pi', main: '' }, 'orchestrator', pins).model, 'anthropic/claude-haiku-5-5');
});

test('the orchestrator prompt names the job explicitly and a resume prompt is short', () => {
  const job = { id: 'abc', slug: 'my-video-abc123', jobPath: 'jobs/my-video-abc123', scriptPath: 'jobs/scripts/my-video-abc123', prompt: 'x', duration: 60, format: 'landscape' };
  assert.match(orchestratorPrompt(job), /start --name my-video-abc123 /);
  assert.match(orchestratorPrompt(job), /Requested target duration: 60 seconds/);
  assert(orchestratorPrompt(job, { resume: true }).length < 800);
});

test('store keeps events out of snapshots, batches writes, and restores recent events from the log', async () => {
  const folder = await workspace(); const store = new Store(folder); const job = store.create(defaults);
  store.message(job, 'You', 'My brief');
  const output = 'x'.repeat(8000), started = performance.now();
  for (let i = 0; i < 1000; i++) store.event(job, { type: 'tool', text: 'npm run video -- build', output, status: 'completed' });
  const perEvent = (performance.now() - started) / 1000;
  store.flush();
  const snapshot = await stat(path.join(folder, `${job.id}.json`));
  assert(snapshot.size < 50000, `snapshot is ${snapshot.size} bytes`);
  assert(perEvent < 5, `${perEvent.toFixed(2)} ms per event`);
  assert.equal(store.events(job.id).at(-1).output.length, 4000); assert.equal(store.events(job.id).at(-1).truncated, true);
  const restored = new Store(folder);
  assert.equal(restored.get(job.id).messages[0].text, 'My brief'); assert.equal(restored.events(job.id).length, 600); assert.equal(restored.get(job.id).eventSeq, 1000);
  const full = await restored.fullEvent(job.id, restored.events(job.id).at(-1).id); assert.equal(full.output.length, 8000);
  assert.equal((await restored.page(job.id, { before: 401, limit: 50 })).at(-1).seq, 400);
});

test('artifact access rejects traversal and symlink escapes; video ranges are correct', async () => {
  const folder = await workspace(); const job = { jobPath: 'jobs/one', scriptPath: 'jobs/scripts/one', slug: 'one' };
  await mkdir(path.join(folder, 'jobs/one'), { recursive: true }); await writeFile(path.join(folder, 'jobs/one/video.mp4'), '0123456789');
  await writeFile(path.join(folder, 'outside.md'), 'private'); await symlink(path.join(folder, 'outside.md'), path.join(folder, 'jobs/one/escape.md'));
  assert.equal((await jobFile(folder, job, 'jobs/one/video.mp4')).info.size, 10);
  await assert.rejects(jobFile(folder, job, 'jobs/one/../../outside.md'), /outside/);
  await assert.rejects(jobFile(folder, job, 'jobs/one/escape.md'), /symlink/);
  assert.deepEqual(parseRange('bytes=3-6', 10), { start: 3, end: 6 }); assert.deepEqual(parseRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.throws(() => parseRange('bytes=10-', 10), /range/); assert.throws(() => parseRange('bytes=1-2,4-5', 10), /range/);
});

test('sub-agents are tracked as a tree with briefs, scenes and files, and cannot read user feedback', async () => {
  const folder = await workspace();
  const app = await createApp({ root, directory: path.join(folder, 'state'), runnerFactory: options => fakeRunner(options, { FAKE_CALLBACK: '1', FAKE_DELEGATE: '1' }) });
  await app.start(0);
  try {
    const job = await app.runner.create(defaults);
    app.store.message(job, 'You', 'Secret direction for the orchestrator only');
    await until(() => job.status === 'needs_attention', 'run end');
    const orchestrator = job.agents.find(agent => agent.role === 'orchestrator');
    const builders = job.agents.filter(agent => agent.role === 'builder');
    assert.equal(builders.length, 2);
    for (const builder of builders) {
      assert.equal(builder.parentId, orchestrator.id); assert.equal(builder.status, 'finished');
      assert.match(builder.task, /^Build scene “[ab]”$/); assert.equal(builder.brief, `jobs/fixture/briefs/build-${builder.scene}.md`);
      assert.equal(builder.current, `jobs/fixture/shots/${builder.scene}.json`); assert.equal(builder.note, 'Working on builder');
    }
    assert(!job.messages.some(message => message.text === 'FEEDBACK LEAKED'));
    assert(job.messages.some(message => message.text === 'feedback refused'));
    // The user's message reaches the orchestrator inside the delegate result, never a builder.
    assert(job.messages.find(message => message.text.startsWith('Secret')).deliveredAt);
    const delegated = JSON.parse(job.messages.find(message => message.text.startsWith('DELEGATED ')).text.slice(10));
    assert.deepEqual(delegated.userMessages, ['Secret direction for the orchestrator only']);
    // Only each agent's final reply goes back to the orchestrator.
    assert.deepEqual(delegated.replies, Array(2).fill('Fixture agent says done, but did not qualify any outputs.'));
    assert.equal(job.messages.filter(message => message.text === 'role note received').length, 2);
    for (const builder of builders) assert.equal(builder.builtinAgentCalls, 1);
    assert(app.store.events(job.id).some(event => event.type === 'error' && event.fatal === false && /built-in sub-agent/.test(event.text)));
    assert.equal(job.lastNext.state, 'build scene "a"'); assert.equal(job.lastNext.spawns.length, 2);
    assert(app.store.events(job.id).some(event => event.type === 'tool' && event.status === 'failed'));
    // Health is recomputed right after the run ends; a failed grep never makes it an error.
    await until(() => job.health?.level === 'attention', 'health after the run');
    assert(!job.health.items.some(item => item.level === 'error'));
    assert.equal(job.usage.total, 45);
  } finally { await app.close(); for (const job of app.store.all()) await rm(path.join(root, job.scriptPath), { force: true, recursive: true }); }
});

test('provider failure is surfaced, cancellation stops a process, and queued work starts afterward', async t => {
  const folder = await workspace(); const store = new Store(folder); const runner = fakeRunner({ store, root }, { FAKE_BEHAVIOR: 'hold' }); t.after(() => runner.shutdown()); await runner.initialize('http://127.0.0.1:1');
  const first = store.create(defaults); const second = store.create({ ...defaults, title: 'Second' }); runner.pump();
  await until(() => runner.processes.size === 1); assert.equal(second.status, 'queued');
  await runner.control(first, 'pause'); assert.equal(first.status, 'paused'); await runner.control(first, 'resume'); assert.equal(first.status, 'running');
  await runner.control(first, 'cancel'); await until(() => second.status === 'running' && [...runner.processes.values()].some(p => p.job.id === second.id), 'next queued job');
  assert.equal(first.status, 'cancelled'); await runner.control(second, 'cancel'); await until(() => runner.processes.size === 0, 'cancelled processes exit');
  const errorStore = new Store(path.join(folder, 'errors')); const errors = fakeRunner({ store: errorStore, root }, { FAKE_BEHAVIOR: 'error' }); t.after(() => errors.shutdown()); await errors.initialize('http://127.0.0.1:1'); const failed = errorStore.create(defaults); errors.pump(); await until(() => failed.status === 'failed'); assert.match(failed.error, /authentication/);
});

test('checkpoints and questions hold the agent until you decide; pause holds runner calls', async t => {
  const folder = await workspace(); const store = new Store(folder); const runner = new Runner({ root, store, statusCommand: noStatus });
  t.after(() => runner.shutdown());
  const job = store.create({ ...defaults, gateScript: true }); job.status = 'running';
  const agent = { id: 'orchestrator', role: 'orchestrator', status: 'running' }; job.agents.push(agent); job.orchestratorId = agent.id;
  const waiting = runner.tool(job, agent.id, 'checkpoint', { kind: 'script', summary: 'Review script' });
  await until(() => job.status === 'gate', 'gate'); assert.equal(agent.status, 'waiting');
  await assert.rejects(runner.control(job, 'revise', {}), /Describe/);
  await runner.control(job, 'revise', { feedback: 'Shorter opening' });
  assert.deepEqual((await waiting).decision, 'revise'); assert.equal(job.status, 'running');
  const again = runner.tool(job, agent.id, 'checkpoint', { kind: 'script', summary: 'Revised' });
  await until(() => job.status === 'gate'); await runner.control(job, 'approve', {});
  assert.equal((await again).decision, 'approve'); assert.equal((await runner.tool(job, agent.id, 'checkpoint', { kind: 'script', summary: 'x' })).decision, 'continue');
  const asked = runner.tool(job, agent.id, 'ask', { question: 'Which city?', options: ['Paris', 'Lyon'] });
  await until(() => job.gate?.kind === 'question' && job.status === 'gate');
  await runner.control(job, 'answer', { answer: 'Lyon' }); assert.deepEqual(await asked, { answer: 'Lyon' });
  await runner.control(job, 'pause');
  let released = false; const held = runner.tool(job, agent.id, 'feedback', {}).then(() => { released = true; });
  await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(released, false);
  await runner.control(job, 'resume'); job.status = 'running'; runner.wake(); await held; assert.equal(released, true);
  const builder = { id: 'b', role: 'builder', status: 'running' }; job.agents.push(builder);
  await assert.rejects(runner.tool(job, 'b', 'feedback', {}), /only available to the orchestrator/);
  await assert.rejects(runner.tool(job, agent.id, 'complete', {}), /not qualified delivery/);
});

test('a checkpoint survives a restart and the decision reaches the resumed orchestrator', async t => {
  const folder = await workspace(); const store = new Store(folder);
  const job = store.create({ ...defaults, gateScript: true }); job.status = 'gate'; job.gate = { id: 'g', kind: 'script', summary: 'Look', decision: null }; store.save(job); store.flush();
  const restoredStore = new Store(folder); const runner = new Runner({ root, store: restoredStore, statusCommand: noStatus }); runner.closed = false;
  t.after(() => runner.shutdown());
  await runner.initialize('http://127.0.0.1:1'); runner.closed = true; // keep pump from launching a real CLI
  const restored = restoredStore.get(job.id); assert.equal(restored.status, 'gate'); assert.equal(restored.gate.detached, true);
  await runner.control(restored, 'approve', {}); assert.equal(restored.status, 'queued');
  const orchestrator = { id: 'o', role: 'orchestrator', status: 'running' }; restored.agents.push(orchestrator); restored.status = 'running';
  assert.equal((await runner.tool(restored, 'o', 'checkpoint', { kind: 'script', summary: 'again' })).decision, 'approve');
});

test('film checkpoints are recorded by the pipeline, never approved once for every later build', async t => {
  const folder = await workspace(); const store = new Store(folder);
  const runner = new Runner({ root, store, statusCommand: noStatus }); runner.closed = true; t.after(() => runner.shutdown());
  const job = store.create({ ...defaults, gatePrototype: true, gateFinal: false });
  const orchestrator = { id: 'o', role: 'orchestrator', status: 'running' }; job.agents.push(orchestrator); job.status = 'running';
  // Switched off: the runner says so and continues.
  assert.equal((await runner.tool(job, 'o', 'checkpoint', { kind: 'final', summary: 'Watch it' })).decision, 'continue');
  // On: the decision needs the job's current review pack; without one nothing is recorded or approved.
  const waiting = runner.tool(job, 'o', 'checkpoint', { kind: 'prototype', summary: 'Watch it' });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(job.status, 'gate'); assert.equal(job.gate.kind, 'prototype');
  await assert.rejects(runner.control(job, 'approve', { notes: [] }), /ENOENT|review pack|no such file/i);
  assert.equal(job.gate.decision, null); assert.ok(!job.approvedGates?.includes('prototype'));
  runner.gates.get(job.id)?.reject(new Error('test over')); await waiting.catch(() => {});
});

test('progress joins script, pipeline, thumbnail and delivery; health reads facts, not agent claims', () => {
  const job = { status: 'running', scriptPath: 'jobs/scripts/v', jobPath: 'jobs/v', slug: 'v', scriptReview: { status: 'pass', stale: false }, agents: [{ id: 'b1', role: 'builder', status: 'running', step: 'scenes', scene: 'b' }], gatePrototype: true, activeCommands: [],
    pipeline: { state: 'build final', current: 'scenes', steps: [{ id: 'prepare', label: 'P', status: 'done' }, { id: 'prototype-review', label: 'R', status: 'done' }, { id: 'scenes', label: 'S', status: 'current', detail: '1/2 built' }, { id: 'deliver', label: 'D', status: 'pending' }], scenes: [] } };
  const files = [{ path: 'jobs/scripts/v/SCRIPT.md' }, { path: 'jobs/scripts/v/review.md' }, { path: 'jobs/scripts/v/narration.wav' }];
  const progress = computeProgress(job, { files });
  assert.deepEqual(progress.phases.map(phase => phase.id), ['script', 'film', 'thumbnail', 'delivery']);
  assert.deepEqual(progress.phases[0].steps.map(step => step.status), ['done', 'done', 'done']);
  assert.deepEqual(progress.phases[1].steps.map(step => step.id), ['prepare', 'prototype-review', 'prototype-gate', 'scenes', 'deliver']);
  assert.deepEqual(progress.phases[1].steps.find(step => step.id === 'scenes').agents, ['b1']);
  assert.equal(progress.current.id, 'scenes'); assert.equal(progress.phases[1].steps[2].status, 'pending');
  const events = [{ type: 'tool', status: 'failed', at: new Date().toISOString() }];
  assert.equal(computeHealth(job, events).level, 'ok');
  const stalled = computeHealth(job, [{ type: 'tool', at: new Date(Date.now() - 20 * 60000).toISOString() }]);
  assert.equal(stalled.level, 'warning'); assert.match(stalled.headline, /No activity/);
});

test('progress never passes a missing verdict, rejected or outdated script review, or missing thumbnail preview', async () => {
  assert.equal(scriptDisposition('A pass requires checking every claim.\n## Disposition\n\n**PASS.**\n\nBlockers: none.'), 'pass');
  assert.equal(scriptDisposition('Previously PASS\nVerdict: **revise** — central claim is unsupported'), 'revise');
  assert.equal(scriptDisposition('The word pass occurs in this finding.'), '');
  assert.equal(scriptDisposition('## Final verdict: incomplete'), 'incomplete');
  assert.equal(scriptDisposition('**Verdict: PASS. 0 blockers, 4 advisory findings.**\n\n## Outcome\n**PASS.** The full script was checked.'), 'pass');
  assert.equal(scriptDisposition('Verdict: revise. One blocker remains.'), 'revise');
  assert.equal(scriptDisposition('Pass the script back to the writer.\nRevise the second paragraph.'), '');
  const folder = await workspace(), store = new Store(path.join(folder, 'state'));
  const runner = new Runner({ root: folder, store, statusCommand: noStatus });
  const job = store.create(defaults); job.status = 'needs_attention';
  const directory = path.join(folder, job.scriptPath); await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'SCRIPT.md'), 'A script.');
  await writeFile(path.join(directory, 'review.md'), 'The script still needs checking.');
  const reviewStep = () => job.progress.phases[0].steps.find(step => step.id === 'script-review');
  await runner.recompute(job); assert.notEqual(reviewStep().status, 'done');
  await writeFile(path.join(directory, 'review.md'), '## Disposition\n\n**REVISE.**');
  await runner.recompute(job); assert.equal(reviewStep().status, 'repair');
  await writeFile(path.join(directory, 'review.md'), '## Disposition\n\n**PASS.**');
  await runner.recompute(job); assert.equal(reviewStep().status, 'done');
  const files = [{ path: `${job.scriptPath}/SCRIPT.md`, modified: 20 }, { path: `${job.scriptPath}/review.md`, modified: 10 }];
  await runner.recompute(job, files); assert.equal(reviewStep().status, 'repair'); assert.match(reviewStep().detail, /changed after review/);
  job.pipelineError = 'status timed out';
  assert(computeHealth(job, []).items.some(item => item.text.includes('status timed out')));
  const thumbnail = `${job.jobPath}/thumbnail`;
  const art = names => computeProgress(job, { files: names.map(name => ({ path: `${thumbnail}/${name}` })) }).phases[2].steps[1];
  assert.notEqual(art(['BRIEF.md', 'thumbnail.png']).status, 'done');
  // The PNG and its editable source are enough; a feed-size preview is optional.
  assert.equal(art(['BRIEF.md', 'thumbnail.png', 'source.svg']).status, 'done');
  assert.match(art(['BRIEF.md', 'thumbnail.png', 'source.svg', 'preview-320x180.png']).detail, /feed preview/);
  store.flush();
});

test('API streams deltas, authorizes bridge tools, rejects cross-origin writes, deletes threads, and serves byte ranges', async t => {
  const folder = await workspace();
  const app = await createApp({ root, directory: path.join(folder, 'state'), runnerFactory: options => fakeRunner(options, { FAKE_CALLBACK: '1' }) });
  const url = await app.start(0); t.after(() => app.close());
  assert.equal((await post(url, '/api/jobs', defaults, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await fetch(url + '/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(defaults) })).status, 403);
  const sse = await fetch(url + '/api/stream'); const reader = sse.body.getReader(); assert.match(new TextDecoder().decode((await reader.read()).value), /connected/);
  // A length is optional and read only from the prompt; a separate duration field is ignored.
  const tooLong = await post(url, '/api/jobs', { ...defaults, prompt: 'A two-hour fixture' }); assert.equal(tooLong.status, 400); assert.match((await tooLong.json()).error, /between/);
  const open = await post(url, '/api/jobs', { ...defaults, prompt: 'A test fixture with no length', duration: 60 }); assert.equal(open.status, 201);
  const openJob = app.store.get((await open.json()).id); assert.equal(openJob.duration, null);
  assert.match(orchestratorPrompt(openJob), /No target duration was requested: the length is the script writer's call/);
  await until(() => !['queued', 'running'].includes(openJob.status), 'the open-length job to settle'); await app.runner.remove(openJob);
  const response = await post(url, '/api/jobs', defaults); assert.equal(response.status, 201); const created = await response.json(); const job = app.store.get(created.id);
  assert.equal(job.duration, 60);
  let streamed = '';
  while (!streamed.includes('"events":[{')) streamed += new TextDecoder().decode((await reader.read()).value);
  await reader.cancel();
  await until(() => job.status === 'needs_attention');
  const forbidden = await post(url, '/api/internal/tool', { thread: job.id, agentId: job.orchestratorId, name: 'complete' }); assert.equal(forbidden.status, 403);
  await mkdir(path.join(root, job.jobPath), { recursive: true }); t.after(() => rm(path.join(root, job.jobPath), { recursive: true, force: true })); t.after(() => rm(path.join(root, job.scriptPath), { recursive: true, force: true }));
  await writeFile(path.join(root, job.jobPath, 'test.mp4'), '0123456789');
  const media = await fetch(url + `/api/jobs/${job.id}/artifact?path=${encodeURIComponent(job.jobPath + '/test.mp4')}`, { headers: { Range: 'bytes=2-5' } }); assert.equal(media.status, 206); assert.equal(media.headers.get('content-range'), 'bytes 2-5/10'); assert.equal(await media.text(), '2345');
  const detail = await (await fetch(url + `/api/jobs/${job.id}`)).json(); assert(Array.isArray(detail.events)); assert(!('usageLedger' in detail.agents[0]));
  assert.equal((await post(url, `/api/jobs/${job.id}/messages`, { text: 'Make it shorter' })).status, 201);
  assert.equal((await fetch(url + `/api/jobs/${job.id}`, { method: 'DELETE', headers: { 'X-Video-Client': '1' } })).status, 200);
  assert.equal((await fetch(url + `/api/jobs/${job.id}`)).status, 404);
});

test('deleting a thread removes its artifacts, uploads and thumbnail archive, and keeps the library', async t => {
  const folder = await workspace();
  const app = await createApp({ root, directory: path.join(folder, 'state'), runnerFactory: options => fakeRunner(options) });
  const url = await app.start(0); t.after(() => app.close());
  const upload = '.video/ui/uploads/11111111-1111-1111-1111-111111111111';
  const latest = path.join(root, '.video/latest.json'), previousLatest = await readFile(latest, 'utf8').catch(() => null);
  const write = async (file, text = 'x') => { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), text); };
  const present = async file => access(path.join(root, file)).then(() => true, () => false);
  const mine = app.store.create({ ...defaults, audioPath: `${upload}/take.wav` });
  mine.status = 'complete'; app.store.save(mine); app.store.flush();
  const sharer = app.store.create({ ...defaults, title: 'Shares the upload', audioPath: `${upload}/take.wav` });
  sharer.status = 'complete'; app.store.save(sharer); app.store.flush();
  await write(`${mine.jobPath}/renders/video.mp4`, 'video'); await write(`${mine.jobPath}/shots/a.json`, '{}');
  await write(`${mine.scriptPath}/SCRIPT.md`, 'script'); await write(`library/thumbnails/${mine.slug}/thumbnail.png`, 'png');
  await write(`${upload}/take.wav`, 'wav'); await write('library/keep-me-bundle.json', 'shared'); await writeFile(latest, JSON.stringify({ job: mine.jobPath }));
  const del = async id => assert.equal((await fetch(`${url}/api/jobs/${id}`, { method: 'DELETE', headers: { 'X-Video-Client': '1' } })).status, 200);
  let running = null;
  try {
    await del(mine.id);
    for (const gone of [mine.jobPath, mine.scriptPath, `library/thumbnails/${mine.slug}`, '.video/latest.json']) assert.equal(await present(gone), false, `${gone} should be deleted`);
    assert.equal(await present(`${upload}/take.wav`), true, 'an upload another thread still uses is kept');
    assert.equal(await present('library/keep-me-bundle.json'), true, 'reusable library work is kept');
    assert.throws(() => app.store.get(mine.id), /Thread not found/);
    await del(sharer.id);
    assert.equal(await present(upload), false, 'the upload goes with its last thread');
    assert.equal(await present('library/keep-me-bundle.json'), true);
    running = app.store.create(defaults); running.status = 'running'; app.store.save(running);
    await assert.rejects(app.runner.remove(running), /Cancel the run/);
  } finally {
    if (previousLatest === null) await rm(latest, { force: true }); else await writeFile(latest, previousLatest);
    for (const item of [mine, sharer, running]) { if (!item) continue; await rm(path.join(root, item.jobPath), { recursive: true, force: true }); await rm(path.join(root, item.scriptPath), { recursive: true, force: true }); await rm(path.join(root, 'library/thumbnails', item.slug), { recursive: true, force: true }); }
    await rm(path.join(root, 'library/keep-me-bundle.json'), { force: true }); await rm(path.join(root, upload), { recursive: true, force: true });
  }
});

test('a thread deleted while its status is being read does not come back', async () => {
  const folder = await workspace();
  let release; const blocked = new Promise(resolve => { release = resolve; });
  const status = { version: 1, job: 'jobs/x', state: 'plan', current: 'plan', steps: [{ id: 'plan', label: 'Plan', status: 'current', detail: 'x' }], scenes: [], reviews: {}, checks: {}, next: null };
  const store = new Store(path.join(folder, 'state'));
  const runner = new Runner({ root, store, statusCommand: async () => { await blocked; return { stdout: JSON.stringify(status), stderr: '', code: 0 }; } });
  const job = store.create(defaults); job.status = 'complete'; store.save(job); store.flush();
  // A real job on disk, so the runner really does call the (blocked) status command.
  await mkdir(path.join(root, job.jobPath), { recursive: true }); await writeFile(path.join(root, job.jobPath, 'job.json'), '{}');
  const reading = runner.refresh(job, { force: true });
  await new Promise(resolve => setImmediate(resolve));
  await runner.remove(job);
  release(); await reading;
  assert.throws(() => store.get(job.id), /Thread not found/);
  assert.equal(new Store(folder).all().length, 0, 'the snapshot stayed deleted');
  await rm(path.join(root, job.jobPath), { recursive: true, force: true });
});

test('pipeline status is read-only and matches the state machine for an unprepared job', async () => {
  const folder = await workspace(); const jobDir = path.join(folder, 'empty-job'); await mkdir(jobDir);
  const output = execFileSync(process.execPath, [path.join(root, 'scripts/video.mjs'), 'status', '--json', '--job', jobDir], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const status = JSON.parse(output.trim().split('\n').at(-1));
  assert.equal(status.state, 'not prepared'); assert.equal(status.current, 'prepare'); assert.equal(status.steps.length, 11);
  assert.equal((await readFile(path.join(root, 'scripts/video.mjs'), 'utf8')).includes("command === 'status'"), true);
});

test('Pi runs in JSON mode with the runner bridge registered by its extension', () => {
  const pi = invocation('Pi', { model: 'anthropic/claude-haiku-4-5', session: 'session-1', root, bridge: '/repo/bridge.mjs', node: '/bin/node', agentType: 'video-builder' });
  assert.equal(pi.args[pi.args.indexOf('--mode') + 1], 'json'); assert(pi.args.includes('--approve'));
  assert.match(pi.args[pi.args.indexOf('-e') + 1], /pi-extension\.mjs$/);
  assert.equal(pi.args[pi.args.indexOf('--session') + 1], 'session-1'); assert.equal(pi.args[pi.args.indexOf('--model') + 1], 'anthropic/claude-haiku-4-5');
  assert.equal(pi.args[pi.args.indexOf('--append-system-prompt') + 1], path.join(root, '.claude/agents/video-builder.md'));
  assert.equal(pi.env.VIDEO_RUNNER_BRIDGE, '/repo/bridge.mjs'); assert.equal(pi.env.VIDEO_RUNNER_NODE, '/bin/node');
});

test('Pi events become sessions, tools, messages, usage and only final errors', () => {
  assert.deepEqual(normalize('Pi', { type: 'session', version: 3, id: 'abc' }), [{ type: 'session', sessionId: 'abc' }]);
  const start = normalize('Pi', { type: 'tool_execution_start', toolCallId: 't1', toolName: 'write', args: { path: 'jobs/x/a.md' } })[0];
  assert.equal(start.status, 'running'); assert.equal(start.file, 'jobs/x/a.md'); assert.equal(start.operation, 'editing');
  const end = normalize('Pi', { type: 'tool_execution_end', toolCallId: 't2', toolName: 'bash', args: { command: 'npm run video -- next --job jobs/x' }, result: { content: [{ type: 'text', text: 'STATE: done' }] }, isError: true })[0];
  assert.equal(end.status, 'failed'); assert.equal(end.output, 'STATE: done'); assert.deepEqual(end.pipeline, { command: 'next', job: 'jobs/x' });
  const usage = { input: 10, output: 5, cacheRead: 100, cacheWrite: 20, cost: { total: 0.5 } };
  const reply = normalize('Pi', { type: 'message_end', message: { role: 'assistant', responseId: 'r1', model: 'm', content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'Hello' }], usage, stopReason: 'stop' } });
  assert.deepEqual(reply.map(item => item.type), ['message', 'usage']); assert.equal(reply[0].text, 'Hello'); assert.equal(reply[1].cost, 0.5);
  assert.deepEqual(tokens('Pi', usage), { input: 130, output: 5, cached: 100, cacheWrite: 20, reasoning: 0, total: 135 });
  const failed = { role: 'assistant', stopReason: 'error', errorMessage: 'No API key' };
  assert.deepEqual(normalize('Pi', { type: 'agent_end', willRetry: true, messages: [failed] }), []);
  assert.equal(normalize('Pi', { type: 'agent_end', willRetry: false, messages: [failed] })[0].fatal, true);
});

test('Pi roles use the repository pins as Anthropic models', () => {
  const pins = { 'video-builder': 'haiku', 'video-director': 'opus' };
  assert.deepEqual(routeModel({ provider: 'Pi', main: '' }, 'builder', pins), { model: 'anthropic/haiku', source: 'repo pin (.claude/agents/video-builder.md)' });
  assert.equal(routeModel({ provider: 'Pi', main: '' }, 'director', { 'video-director': 'openrouter/x' }).model, 'openrouter/x');
  assert.equal(routeModel({ provider: 'Pi', main: 'anthropic/sonnet', models: { builder: 'b' } }, 'builder', pins).model, 'b');
  assert.equal(routeModel({ provider: 'Pi', main: 'anthropic/sonnet' }, 'orchestrator', pins).model, 'anthropic/sonnet');
});

test('the same work asked for twice while it runs waits for the running agent instead of starting another', async t => {
  const folder = await workspace(); const store = new Store(folder);
  const app = await createApp({ root, directory: path.join(folder, 'state'), runnerFactory: options => fakeRunner(options, { FAKE_DELAY_MS: '600' }) });
  await app.start(0);
  t.after(() => app.close());
  const runner = app.runner, job = app.store.create(defaults); job.status = 'running';
  const agent = { id: 'orchestrator', role: 'orchestrator', status: 'running' }; job.agents.push(agent); job.orchestratorId = agent.id;
  const first = runner.tool(job, agent.id, 'delegate', { role: 'script-writer', prompt: 'Write the script.' });
  await until(() => job.agents.some(item => item.role === 'script-writer' && item.status === 'running'), 'first writer');
  const second = await runner.tool(job, agent.id, 'delegate', { role: 'script-writer', prompt: 'Write the script, resumed.' });
  assert.equal(second.attached, true);
  assert.equal((await first).agentId, second.agentId);
  assert.equal(job.agents.filter(item => item.role === 'script-writer').length, 1);
  // Different briefs are different work and run side by side.
  await runner.tool(job, agent.id, 'delegate_parallel', { tasks: ['a', 'b'].map(scene => ({ role: 'builder', prompt: `Read jobs/fixture/briefs/build-${scene}.md and follow it exactly.` })) });
  assert.equal(job.agents.filter(item => item.role === 'builder').length, 2);
  // A director revision never resumes the earlier director session.
  const plan = await runner.tool(job, agent.id, 'delegate', { role: 'director', prompt: 'Read jobs/fixture/briefs/director.md and follow it exactly.' });
  const revision = await runner.tool(job, agent.id, 'delegate', { role: 'director', prompt: 'Read jobs/fixture/briefs/director-revision.md and follow it exactly.', agentId: plan.agentId });
  assert.notEqual(revision.agentId, plan.agentId); assert.match(revision.note, /fresh director/);
  assert.equal(job.agents.filter(item => item.role === 'director').length, 2);
  void store;
});


test('ideas API: finds new ideas, refuses a second search while one runs, and records status changes', async t => {
  const folder = await workspace(), ideasRoot = path.join(folder, 'ideas-root');
  await mkdir(ideasRoot, { recursive: true });
  await writeFile(path.join(ideasRoot, 'ideas.config.json'), JSON.stringify({ niche: 'Test niche', sources: { reddit: { subreddits: ['LocalLLaMA'] } } }));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const feed = `<feed>${['Which GPU should I buy for local LLM?', 'Is 8GB VRAM enough for Qwen?'].map((title, i) => `<entry><id>t3_${i}</id><link href="https://www.reddit.com/r/LocalLLaMA/comments/${i}/x/" /><published>${new Date().toISOString()}</published><title>${title}</title><content>x</content></entry>`).join('')}</feed>`;
  const app = await createApp({ root, ideasRoot, directory: path.join(folder, 'state'), runnerFactory: options => fakeRunner(options), ideaOptions: { fetchText: async () => { await gate; return feed; } } });
  const url = await app.start(0); t.after(() => app.close());
  const empty = await (await fetch(url + '/api/ideas')).json();
  assert.deepEqual([empty.niche, empty.cards.length, empty.running], ['Test niche', 0, false]);
  assert.equal((await fetch(url + '/api/ideas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403, 'writes need the local client header');
  const first = post(url, '/api/ideas', { focus: 'gpu' });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal((await post(url, '/api/ideas', {})).status, 409);
  assert.equal((await (await fetch(url + '/api/ideas')).json()).running, true);
  release();
  const result = await (await first).json();
  assert.equal(result.found.length, 1, 'the focus keeps only the GPU question');
  assert.equal(result.cards[0].title, 'Which GPU should I buy for local LLM?');
  assert.equal(result.lastRun.focus, 'gpu');
  const id = result.cards[0].id;
  const patched = await fetch(url + `/api/ideas/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Video-Client': '1' }, body: JSON.stringify({ status: 'rejected', reason: 'Already covered' }) });
  assert.equal(patched.status, 200); assert.equal((await patched.json()).reason, 'Already covered');
  assert.equal((await fetch(url + '/api/ideas/deadbeef', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Video-Client': '1' }, body: JSON.stringify({ status: 'saved' }) })).status, 404);
  assert.equal((await fetch(url + `/api/ideas/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Video-Client': '1' }, body: JSON.stringify({ status: 'bogus' }) })).status, 400);
  const more = await (await post(url, '/api/ideas', {})).json();
  assert.equal(more.found.length, 1, 'asking for more brings the idea not yet shown');
  assert.equal(more.cards[0].title, 'Is 8GB VRAM enough for Qwen?');
});
