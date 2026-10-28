// Only used by runner integration tests. No provider requests are made. Speaks the Codex JSON stream.
const write = value => process.stdout.write(JSON.stringify(value) + '\n');
const role = process.env.VIDEO_AGENT_ROLE || 'orchestrator';
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
async function call(name, args = {}) {
  const response = await fetch(`${process.env.VIDEO_RUNNER_URL}/api/internal/tool`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.VIDEO_RUNNER_TOKEN}` }, body: JSON.stringify({ thread: process.env.VIDEO_THREAD_ID, agentId: process.env.VIDEO_AGENT_ID, name, arguments: args }) });
  const body = await response.json();
  return { ok: response.ok, body };
}
write({ type: 'thread.started', thread_id: 'fixture-session-' + process.env.VIDEO_AGENT_ID });
write({ type: 'item.started', item: { id: 'tool-1', type: 'command_execution', command: 'fixture check', status: 'in_progress' } });
write({ type: 'item.completed', item: { id: 'tool-1', type: 'command_execution', command: 'fixture check', status: 'completed', exit_code: 0, aggregated_output: 'Fixture check passed' } });
if (process.env.FAKE_BEHAVIOR === 'error') write({ type: 'turn.failed', error: { message: 'Fixture authentication error' } });
else {
  if (process.env.FAKE_CALLBACK === '1' && role === 'orchestrator') {
    const progress = await call('progress', { summary: 'Fixture orchestration' });
    if (!progress.ok) throw new Error(JSON.stringify(progress.body));
    // What `next` printed, as the orchestrator would run it.
    write({ type: 'item.started', item: { id: 'next-1', type: 'command_execution', command: "bash -lc 'npm run video -- next --job jobs/fixture'", status: 'in_progress' } });
    write({ type: 'item.completed', item: { id: 'next-1', type: 'command_execution', command: "bash -lc 'npm run video -- next --job jobs/fixture'", status: 'completed', exit_code: 0, aggregated_output: 'STATE: build scene "a"\nDO: spawn 2 fresh sub-agents\n      video-builder: "Read /repo/jobs/fixture/briefs/build-a.md and follow it exactly."\n      video-builder: "Read /repo/jobs/fixture/briefs/build-b.md and follow it exactly."\nTHEN: npm run video -- next --job jobs/fixture' } });
    write({ type: 'item.completed', item: { id: 'grep-1', type: 'command_execution', command: 'grep missing nothing', status: 'failed', exit_code: 1, aggregated_output: '' } });
    if (process.env.FAKE_DELEGATE === '1') {
      const result = await call('delegate_parallel', { tasks: ['a', 'b'].map(scene => ({ role: 'builder', prompt: `Read jobs/fixture/briefs/build-${scene}.md and follow it exactly.` })) });
      if (!result.ok) throw new Error(JSON.stringify(result.body));
      // Report what came back, so tests can see the short replies and the user's messages riding along.
      const replies = result.body.results.map(item => item.result);
      write({ type: 'item.completed', item: { id: 'text-delegated', type: 'agent_message', text: `DELEGATED ${JSON.stringify({ replies, userMessages: (result.body.userMessages || []).map(message => message.text) })}` } });
    }
  }
  if (process.env.FAKE_CALLBACK === '1' && role !== 'orchestrator') {
    // A role agent may leave a note, but must not be able to read the user's feedback.
    await call('note', { summary: `Working on ${role}` });
    write({ type: 'item.completed', item: { id: 'text-note', type: 'agent_message', text: prompt.includes(`"role": "${role}"`) ? 'role note received' : 'no role note' } });
    // Codex reports its own sub-agent tools as collab_tool_call items; the runner records the attempt.
    write({ type: 'item.started', item: { id: 'collab-1', type: 'collab_tool_call', tool: 'spawn_agent', status: 'in_progress' } });
    const feedback = await call('feedback');
    write({ type: 'item.completed', item: { id: 'text-fb', type: 'agent_message', text: feedback.ok ? 'FEEDBACK LEAKED' : 'feedback refused' } });
    write({ type: 'item.completed', item: { id: 'fc-1', type: 'file_change', status: 'completed', changes: [{ kind: 'add', path: 'jobs/fixture/shots/' + (/build-(\w+)/.exec(prompt)?.[1] || 'x') + '.json' }] } });
  }
  if (process.env.FAKE_DELAY_MS && role !== 'orchestrator') await new Promise(resolve => setTimeout(resolve, Number(process.env.FAKE_DELAY_MS)));
  write({ type: 'item.completed', item: { id: 'text-1', type: 'agent_message', text: 'Fixture agent says done, but did not qualify any outputs.' } });
  write({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } });
}
if (process.env.FAKE_BEHAVIOR === 'hold') setInterval(() => {}, 1000);
