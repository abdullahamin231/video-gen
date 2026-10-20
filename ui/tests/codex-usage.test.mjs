import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodexRollouts, applyRolloutUsage } from '../backend/codex-usage.mjs';
import { normalize } from '../backend/events.mjs';

const line = value => JSON.stringify(value) + '\n';
const meta = (id, parent = '') => line({ type: 'session_meta', payload: { id, ...(parent ? { parent_thread_id: parent } : {}) } });
const count = (input, cached, output) => line({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: 1 } } } });

test('Codex usage comes from rollouts, including helper agents a session spawned', async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'codex-home-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const now = new Date();
  const folder = path.join(home, 'sessions', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'));
  await mkdir(folder, { recursive: true });
  // A cancelled turn: token_count events but no turn.completed. The last cumulative count wins.
  await writeFile(path.join(folder, 'rollout-a-root.jsonl'), meta('root') + count(100, 80, 5) + count(300, 250, 9));
  await writeFile(path.join(folder, 'rollout-b-child.jsonl'), meta('child', 'root') + count(50, 40, 2));
  await writeFile(path.join(folder, 'rollout-c-grandchild.jsonl'), meta('grandchild', 'child') + count(20, 10, 1));
  await writeFile(path.join(folder, 'rollout-d-other.jsonl'), meta('other') + count(999, 0, 9));
  const rollouts = new CodexRollouts(home);
  const total = await rollouts.sessionUsage('root', now.toISOString());
  assert.deepEqual(total, { input: 370, cached: 300, output: 12, reasoning: 3, helperAgents: 2, helperInput: 70 });
  assert.equal(await rollouts.sessionUsage('missing', now.toISOString()), null);
  const agent = { usage: { input: 10, output: 5, total: 15, reports: 1, reportedCostUSD: 0, costReported: false } };
  assert.equal(applyRolloutUsage(agent, total), true);
  assert.equal(agent.usage.total, 382); assert.equal(agent.usage.helperAgents, 2); assert.equal(agent.usage.source, 'codex-rollout');
  assert.equal(applyRolloutUsage(agent, total), false);
});

test('Codex built-in sub-agent calls are recognised in the stream', () => {
  const [event] = normalize('Codex', { type: 'item.started', item: { id: 'c1', type: 'collab_tool_call', tool: 'spawn_agent', status: 'in_progress' } });
  assert.equal(event.builtinAgent, true); assert.equal(event.tool, 'spawn_agent'); assert.equal(event.status, 'running');
});
