// A stdio MCP bridge. Only protocol JSON is written to stdout.
import { createInterface } from 'node:readline';
const url = process.env.VIDEO_RUNNER_URL;
const token = process.env.VIDEO_RUNNER_TOKEN;
const thread = process.env.VIDEO_THREAD_ID;
const agentId = process.env.VIDEO_AGENT_ID;
const tools = [
  { name: 'delegate', description: 'Run an isolated role-specific CLI sub-agent. Use fresh reviewers; optionally resume a previous director or writer by its actual agentId. Returns the actual runtime identity and result. Calls may run concurrently.', inputSchema: { type: 'object', properties: { role: { type: 'string', enum: ['director', 'builder', 'reviewer', 'script-writer', 'script-reviewer', 'thumbnail-maker', 'thumbnail-reviewer'] }, prompt: { type: 'string' }, agentId: { type: 'string' } }, required: ['role', 'prompt'], additionalProperties: false } },
  { name: 'progress', description: 'Report the current pipeline stage. This is labeled agent-reported, separate from observed file events.', inputSchema: { type: 'object', properties: { stage: { type: 'integer', minimum: 0, maximum: 7 }, summary: { type: 'string' }, file: { type: 'string' } }, required: ['stage', 'summary'], additionalProperties: false } },
  { name: 'feedback', description: 'Read pending user feedback and checkpoint decisions for this thread.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'checkpoint', description: 'Honor an optional human review checkpoint. If paused=true, STOP this turn; the user will resume it.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['script', 'prototype'] }, summary: { type: 'string' }, file: { type: 'string' } }, required: ['kind', 'summary'], additionalProperties: false } },
  { name: 'complete', description: 'Independently verify pipeline qualification and the finished, reviewed, archived thumbnail before marking the thread delivered.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];
function send(id, result, error) { process.stdout.write(JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }) + '\n'); }
async function handle(message) {
  if (message.id === undefined) return;
  try {
    if (message.method === 'initialize') return send(message.id, { protocolVersion: message.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'video-runner', version: '1.0.0' }, instructions: `Your actual runner agent ID is ${agentId}. Thread: ${thread}. Use this identity in production/review records. Reviewer sessions are isolated from producer context.` });
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
