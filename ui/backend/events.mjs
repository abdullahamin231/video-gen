import path from 'node:path';

export function redact(text) {
  return String(text ?? '').replace(/\b(sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]{16,})/g, '[redacted]').replace(/((?:api[_-]?key|access[_-]?token|authorization|password)\s*[=:]\s*)[^\s,}"']+/gi, '$1[redacted]').slice(0, 32000);
}
function toolEvent(name, input, status, output = '', key = '') {
  const file = input?.file_path || input?.filePath || input?.path || input?.filename || '';
  const command = input?.command || input?.cmd || '';
  const operation = /write|edit|patch/i.test(name) ? 'editing' : /read|view|open/i.test(name) ? 'reading' : '';
  return { type: status === 'failed' ? 'error' : 'tool', name, text: redact(command || name), file: typeof file === 'string' ? file : '', operation, status, output: redact(output), toolId: key };
}

export function normalize(provider, raw) {
  const result = [];
  if (provider === 'Codex') {
    if (raw.type === 'thread.started') result.push({ type: 'session', sessionId: raw.thread_id });
    const item = raw.item;
    if (item) {
      const status = raw.type === 'item.completed' ? item.status === 'failed' || item.exit_code ? 'failed' : 'completed' : 'running';
      if (item.type === 'agent_message' && raw.type === 'item.completed') result.push({ type: 'message', text: redact(item.text), messageId: item.id });
      else if (item.type === 'command_execution') result.push(toolEvent('Shell', { command: item.command }, status, item.aggregated_output, item.id));
      else if (item.type === 'file_change') for (const change of item.changes || []) result.push(toolEvent('File ' + change.kind, { path: change.path }, status, '', item.id));
      else if (item.type === 'mcp_tool_call') result.push(toolEvent(`${item.server}.${item.tool}`, item.arguments, status, JSON.stringify(item.result ?? item.error ?? ''), item.id));
      else if (item.type === 'web_search') result.push(toolEvent('Web search', { command: item.query }, status, '', item.id));
      else if (item.type === 'reasoning' && item.text) result.push({ type: 'reasoning', text: redact(item.text) });
    }
    if (raw.type === 'turn.failed' || raw.type === 'error') result.push({ type: 'error', fatal: true, text: redact(raw.error?.message || raw.message || 'Provider error'), status: 'failed' });
    if (raw.type === 'turn.completed' && raw.usage) result.push({ type: 'usage', usage: raw.usage, text: 'Turn token usage reported' });
    const info = raw.type === 'token_count' ? raw.info : raw.payload?.type === 'token_count' ? raw.payload.info : null;
    if (info?.model_context_window) result.push({ type: 'context', contextWindow: info.model_context_window, text: 'Context limit reported' });
  } else if (provider === 'Claude') {
    if (raw.type === 'system' && raw.session_id) result.push({ type: 'session', sessionId: raw.session_id });
    if (raw.type === 'assistant' && raw.message?.usage && !raw.parent_tool_use_id) result.push({ type: 'usage', usage: raw.message.usage, usageKey: `message:${raw.message.id || raw.uuid}`, fromAssistant: true, model: raw.message.model, text: 'API message token usage reported' });
    if (raw.type === 'assistant') for (const block of raw.message?.content || []) {
      if (block.type === 'text' && block.text) result.push({ type: 'message', text: redact(block.text), messageId: raw.uuid });
      if (block.type === 'tool_use') result.push(toolEvent(block.name, block.input, 'running', '', block.id));
    }
    if (raw.type === 'user') for (const block of raw.message?.content || []) {
      if (block.type === 'tool_result') result.push({ type: block.is_error ? 'error' : 'tool', text: block.is_error ? 'Tool failed' : 'Tool completed', toolId: block.tool_use_id, status: block.is_error ? 'failed' : 'completed', output: redact(typeof block.content === 'string' ? block.content : JSON.stringify(block.content)) });
    }
    if (raw.type === 'result') {
      if (raw.session_id) result.push({ type: 'session', sessionId: raw.session_id });
      if (raw.is_error) result.push({ type: 'error', fatal: true, text: redact(raw.result || raw.errors?.join('\n') || raw.subtype), status: 'failed' });
      result.push({ type: 'usage', usage: raw.usage, fallbackOnly: true, cost: raw.total_cost_usd, contextLimits: raw.modelUsage, text: raw.subtype || 'Turn finished' });
    }
  } else {
    const part = raw.part || raw.properties?.part;
    const sessionId = raw.sessionID || raw.session_id || part?.sessionID;
    if (sessionId) result.push({ type: 'session', sessionId });
    if (raw.type === 'text' && part?.text) result.push({ type: 'message', text: redact(part.text), messageId: part.id });
    if ((raw.type === 'tool_use' || part?.type === 'tool') && part) result.push(toolEvent(part.tool || 'Tool', part.state?.input, part.state?.status === 'error' ? 'failed' : part.state?.status === 'completed' ? 'completed' : 'running', part.state?.output || part.state?.error, part.callID || part.id));
    if (raw.type === 'error') result.push({ type: 'error', fatal: true, text: redact(raw.error?.data?.message || raw.error?.message || JSON.stringify(raw.error || raw)), status: 'failed' });
    if (raw.type === 'step_finish') result.push({ type: 'usage', usage: part?.tokens, cost: part?.cost, usageKey: part?.id ? `step:${part.id}` : undefined, text: 'Step token usage reported' });
  }
  if (raw.type === 'rate_limit_event') {
    const info = raw.rate_limit_info || raw.rateLimitInfo || {};
    const remaining = info.remainingPercent ?? info.remaining_percent ?? (typeof info.utilization === 'number' && info.utilization >= 0 && info.utilization <= 1 ? 100 * (1 - info.utilization) : undefined);
    result.push({ type: 'quota', text: 'Provider rate-limit status reported', detail: `${info.rateLimitType || info.rate_limit_type || 'Account'}: ${info.status || 'reported'}`, windows: typeof remaining === 'number' ? [{ label: info.rateLimitType || 'Account', kind: info.rateLimitType || 'account', remainingPercent: remaining, resetsAt: info.resetsAt ? new Date(info.resetsAt * 1000).toISOString() : null }] : [] });
  }
  return result;
}

export function normalizeFile(root, file) {
  if (!file) return '';
  return path.isAbsolute(file) ? path.relative(root, file).split(path.sep).join('/') : file.replace(/^\.\//, '');
}
