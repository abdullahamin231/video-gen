// A stdio MCP bridge. Only protocol JSON is written to stdout.
import { createInterface } from 'node:readline';
const url = process.env.VIDEO_RUNNER_URL;
const token = process.env.VIDEO_RUNNER_TOKEN;
const thread = process.env.VIDEO_THREAD_ID;
const agentId = process.env.VIDEO_AGENT_ID;
const role = process.env.VIDEO_AGENT_ROLE || 'orchestrator';
const roles = ['director', 'builder', 'reviewer', 'script-writer', 'script-reviewer', 'thumbnail-maker', 'thumbnail-reviewer'];
const task = { type: 'object', properties: { role: { type: 'string', enum: roles }, prompt: { type: 'string' }, agentId: { type: 'string', description: 'Resume this earlier director or writer session' } }, required: ['role', 'prompt'], additionalProperties: false };
const orchestratorTools = [
  { name: 'delegate', description: 'Run one isolated role-specific CLI sub-agent and wait for it. Use fresh reviewers; optionally resume a previous director or writer by its actual agentId. Returns the actual runtime identity and result.', inputSchema: task },
  { name: 'delegate_parallel', description: 'Run several independent sub-agents at the same time and wait for all of them (e.g. the three reviewers). Returns one result per task, in order.', inputSchema: { type: 'object', properties: { tasks: { type: 'array', items: task, minItems: 1, maxItems: 8 } }, required: ['tasks'], additionalProperties: false } },
  { name: 'feedback', description: 'Read new user messages for this thread. Call before every next iteration.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'progress', description: 'Optional one-line narration of what you are doing, shown in the thread. Pipeline stages are tracked automatically.', inputSchema: { type: 'object', properties: { summary: { type: 'string' }, file: { type: 'string' }, stage: { type: 'integer' } }, required: ['summary'], additionalProperties: false } },
  { name: 'checkpoint', description: 'Human review checkpoint after an independent review passes. Waits for the user. Returns decision "approve", "revise" (with feedback) or "continue" when the checkpoint is off.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['script', 'prototype'] }, summary: { type: 'string' }, file: { type: 'string' } }, required: ['kind', 'summary'], additionalProperties: false } },
  { name: 'ask', description: 'Ask the user one genuinely open question and wait for the answer. Not for routine approvals.', inputSchema: { type: 'object', properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' }, maxItems: 6 }, file: { type: 'string' } }, required: ['question'], additionalProperties: false } },
  { name: 'complete', description: 'Independently verify pipeline qualification and the finished, reviewed, archived thumbnail before marking the thread delivered.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];
// Sub-agents can only leave a note on their own card: no user feedback, delegation or delivery.
const roleTools = [{ name: 'note', description: 'Optional: a one-line note about what you are doing now, shown on your card in the job UI.', inputSchema: { type: 'object', properties: { summary: { type: 'string' }, file: { type: 'string' } }, required: ['summary'], additionalProperties: false } }];
const tools = role === 'orchestrator' ? orchestratorTools : roleTools;

function send(id, result, error) { process.stdout.write(JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }) + '\n'); }
async function handle(message) {
  if (message.id === undefined) return;
  try {
    if (message.method === 'initialize') return send(message.id, { protocolVersion: message.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'video-runner', version: '2.0.0' }, instructions: `Your actual runner agent ID is ${agentId} (role: ${role}). Thread: ${thread}. Use this identity in production/review records.${role === 'orchestrator' ? '' : ' You are an isolated role agent: follow your brief.'}` });
    if (message.method === 'ping') return send(message.id, {});
    if (message.method === 'tools/list') return send(message.id, { tools });
    if (message.method !== 'tools/call') return send(message.id, null, { code: -32601, message: 'Method not found' });
    if (!tools.some(tool => tool.name === message.params?.name)) throw new Error('Unknown runner tool');
    const response = await fetch(`${url}/api/internal/tool`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ thread, agentId, name: message.params.name, arguments: message.params.arguments || {} }), signal: AbortSignal.timeout(24 * 60 * 60 * 1000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Runner request failed');
    send(message.id, { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false });
  } catch (error) { send(message.id, { content: [{ type: 'text', text: error.message }], isError: true }); }
}
createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', line => {
  try { void handle(JSON.parse(line)); } catch { send(null, null, { code: -32700, message: 'Parse error' }); }
});
