// Only used by runner integration tests. No provider requests are made.
const write = value => process.stdout.write(JSON.stringify(value) + '\n');
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
write({ type: 'thread.started', thread_id: 'fixture-session-' + process.env.VIDEO_AGENT_ID });
write({ type: 'item.started', item: { id: 'tool-1', type: 'command_execution', command: 'fixture check', status: 'in_progress' } });
write({ type: 'item.completed', item: { id: 'tool-1', type: 'command_execution', command: 'fixture check', status: 'completed', exit_code: 0, aggregated_output: 'Fixture check passed' } });
if (process.env.FAKE_BEHAVIOR === 'error') write({ type: 'turn.failed', error: { message: 'Fixture authentication error' } });
else {
  if (process.env.FAKE_CALLBACK === '1') {
    const response = await fetch(`${process.env.VIDEO_RUNNER_URL}/api/internal/tool`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.VIDEO_RUNNER_TOKEN}` }, body: JSON.stringify({ thread: process.env.VIDEO_THREAD_ID, agentId: process.env.VIDEO_AGENT_ID, name: 'progress', arguments: { stage: 2, summary: 'Fixture creative direction' } }) });
    if (!response.ok) throw new Error(await response.text());
  }
  write({ type: 'item.completed', item: { id: 'text-1', type: 'agent_message', text: 'Fixture agent says done, but did not qualify any outputs.' } });
  write({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } });
}
if (process.env.FAKE_BEHAVIOR === 'hold') setInterval(() => {}, 1000);
