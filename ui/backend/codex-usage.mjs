// Codex usage from its own session logs (rollouts), not from the JSON stream.
// The stream reports usage only on `turn.completed`, so a cancelled or interrupted turn reports nothing, and helper
// agents a session spawns itself never appear in the stream at all. Each rollout's last `token_count` event holds the
// session's cumulative usage; child sessions name their parent in `session_meta.parent_thread_id`.
import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const TAIL = 512 * 1024;
const day = date => [String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')];

async function firstLine(file) {
  const handle = await open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(64 * 1024), 0, 64 * 1024, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const end = text.indexOf('\n');
    return end < 0 ? text : text.slice(0, end);
  } finally { await handle.close(); }
}

// The cumulative usage in the last token_count event: read the tail first, the whole file only if needed.
async function lastTotals(file, size) {
  const handle = await open(file, 'r');
  try {
    for (const start of size > TAIL ? [size - TAIL, 0] : [0]) {
      const length = size - start;
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(length), 0, length, start);
      const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"token_count"')) continue;
        try {
          const usage = JSON.parse(lines[i]).payload?.info?.total_token_usage;
          if (usage) return usage;
        } catch { /* A partial first line of the tail. */ }
      }
    }
    return null;
  } finally { await handle.close(); }
}

export class CodexRollouts {
  constructor(home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
    this.root = path.join(home, 'sessions');
    this.meta = new Map(); // file → { id, parent }
    this.totals = new Map(); // file → { size, usage }
  }
  // Rollout files written on the days from `since` to today.
  async files(since) {
    const result = [];
    const from = new Date(since || Date.now()); from.setHours(0, 0, 0, 0);
    for (let date = from; date <= new Date(); date = new Date(date.getTime() + 86400000)) {
      const folder = path.join(this.root, ...day(date));
      for (const name of await readdir(folder).catch(() => [])) if (name.endsWith('.jsonl')) result.push(path.join(folder, name));
    }
    return result;
  }
  async session(file) {
    if (!this.meta.has(file)) {
      try {
        const payload = JSON.parse(await firstLine(file)).payload || {};
        this.meta.set(file, { id: payload.id || payload.session_id || '', parent: payload.parent_thread_id || payload.source?.subagent?.thread_spawn?.parent_thread_id || '' });
      } catch { return { id: '', parent: '' }; }
    }
    return this.meta.get(file);
  }
  async usage(file) {
    const { size } = await stat(file);
    const cached = this.totals.get(file);
    if (cached?.size === size) return cached.usage;
    const usage = await lastTotals(file, size);
    this.totals.set(file, { size, usage });
    return usage;
  }
  // Usage of one Codex session and every session it spawned, at any depth.
  async sessionUsage(sessionId, since) {
    if (!sessionId) return null;
    const files = await this.files(since);
    const sessions = await Promise.all(files.map(async file => ({ file, ...await this.session(file) })));
    const own = sessions.filter(item => item.id === sessionId);
    if (!own.length) return null;
    const ids = new Set([sessionId]);
    for (let grew = true; grew;) {
      grew = false;
      for (const item of sessions) if (item.parent && ids.has(item.parent) && !ids.has(item.id)) { ids.add(item.id); grew = true; }
    }
    const total = { input: 0, cached: 0, output: 0, reasoning: 0, helperAgents: ids.size - 1, helperInput: 0 };
    for (const item of sessions.filter(entry => ids.has(entry.id))) {
      const usage = await this.usage(item.file).catch(() => null);
      if (!usage) continue;
      total.input += usage.input_tokens || 0; total.cached += usage.cached_input_tokens || 0;
      total.output += usage.output_tokens || 0; total.reasoning += usage.reasoning_output_tokens || 0;
      if (item.id !== sessionId) total.helperInput += usage.input_tokens || 0;
    }
    return total;
  }
}

// Replace an agent's stream-reported counts with the rollout's, which are complete. Cost stays as reported.
export function applyRolloutUsage(agent, total) {
  if (!total) return false;
  const usage = agent.usage || {};
  const next = { ...usage, input: total.input, cached: total.cached, cacheWrite: 0, output: total.output, reasoning: total.reasoning,
    total: total.input + total.output, helperAgents: total.helperAgents, helperInput: total.helperInput, source: 'codex-rollout' };
  if (['input', 'cached', 'output', 'helperAgents'].every(key => next[key] === usage[key])) return false;
  agent.usage = { reports: 0, reportedCostUSD: 0, costReported: false, ...next, updatedAt: new Date().toISOString() };
  return true;
}
